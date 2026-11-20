import AVFoundation
import ExpoModulesCore

struct CaptureOptions: Record {
  @Field var inputDeviceId: String? = nil
  @Field var voiceProcessing: Bool = true
}

struct SpeakOptions: Record {
  @Field var text: String = ""
  @Field var locale: String = "en-US"
  @Field var outputDeviceId: String? = nil
  @Field var rate: Double = 1.0
}

private final class SpeechDelegate: NSObject, AVSpeechSynthesizerDelegate {
  var onFinish: (() -> Void)?
  func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { fire() }
  func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) { fire() }
  private func fire() {
    let f = onFinish
    onFinish = nil
    f?()
  }
}

public class AudioRoutingModule: Module {
  private let engine = AVAudioEngine()
  private let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
  private var converter: AVAudioConverter?
  private var pending = Data()
  private var capturing = false
  private var muted = false
  private var options = CaptureOptions()

  private let synth = AVSpeechSynthesizer()
  private let speechDelegate = SpeechDelegate()
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("AudioRouting")
    Events("onAudio", "onDevicesChanged", "onRouteError")

    OnCreate {
      self.synth.delegate = self.speechDelegate
      self.synth.usesApplicationAudioSession = true
      let nc = NotificationCenter.default
      self.observers.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
        guard let self else { return }
        self.sendEvent("onDevicesChanged", self.devices())
      })
      self.observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
        guard let self,
              let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .ended,
              self.capturing else { return }
        try? self.startCapture(self.options)
      })
      self.observers.append(nc.addObserver(forName: .AVAudioEngineConfigurationChange, object: self.engine, queue: .main) { [weak self] _ in
        // The hardware format changes when the route switches (e.g. to a Bluetooth headset).
        guard let self, self.capturing else { return }
        try? self.startCapture(self.options)
      })
    }

    OnDestroy {
      self.observers.forEach { NotificationCenter.default.removeObserver($0) }
      self.stopEngine()
    }

    AsyncFunction("requestPermissions") { (promise: Promise) in
      if #available(iOS 17.0, *) {
        AVAudioApplication.requestRecordPermission { promise.resolve($0) }
      } else {
        AVAudioSession.sharedInstance().requestRecordPermission { promise.resolve($0) }
      }
    }

    Function("getDevices") { self.devices() }

    AsyncFunction("startCapture") { (o: CaptureOptions) in
      try self.startCapture(o)
    }.runOnQueue(.main)

    AsyncFunction("setInputDevice") { (id: String?) in
      var o = CaptureOptions()
      o.inputDeviceId = id
      o.voiceProcessing = self.options.voiceProcessing
      if self.capturing { try self.startCapture(o) } else { self.options = o }
    }.runOnQueue(.main)

    AsyncFunction("stopCapture") {
      self.capturing = false
      self.stopEngine()
    }.runOnQueue(.main)

    Function("setCaptureMuted") { (value: Bool) in
      self.muted = value
    }

    AsyncFunction("speak") { (o: SpeakOptions, promise: Promise) in
      guard let voice = AVSpeechSynthesisVoice(language: o.locale) ?? AVSpeechSynthesisVoice(language: String(o.locale.prefix(2))) else {
        promise.reject("VOICE_MISSING", "No voice installed for \(o.locale). Add it in Settings → Accessibility → Spoken Content → Voices.")
        return
      }
      self.applyOutput(o.outputDeviceId)
      let u = AVSpeechUtterance(string: o.text)
      u.voice = voice
      let rate = AVSpeechUtteranceDefaultSpeechRate * Float(min(max(o.rate, 0.5), 2.0))
      u.rate = min(max(rate, AVSpeechUtteranceMinimumSpeechRate), AVSpeechUtteranceMaximumSpeechRate)
      self.speechDelegate.onFinish = { [weak self] in
        self?.applyInput(self?.options.inputDeviceId)
        promise.resolve(nil)
      }
      self.synth.speak(u)
    }.runOnQueue(.main)

    Function("stopSpeaking") {
      DispatchQueue.main.async { self.synth.stopSpeaking(at: .immediate) }
    }

    AsyncFunction("availableVoices") { () -> [String] in
      Array(Set(AVSpeechSynthesisVoice.speechVoices().map { $0.language })).sorted()
    }
  }

  // MARK: - Session & routing

  private func configureSession(voiceProcessing: Bool) throws {
    let s = AVAudioSession.sharedInstance()
    // .allowBluetooth = HFP (headset mic + earpiece). iOS routes one Bluetooth headset at a time.
    try s.setCategory(.playAndRecord,
                      mode: voiceProcessing ? .voiceChat : .default,
                      options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker])
    try s.setPreferredSampleRate(16000)
    try s.setPreferredIOBufferDuration(0.02)
    try s.setActive(true)
  }

  private func kind(_ t: AVAudioSession.Port) -> String {
    switch t {
    case .builtInMic: return "builtin_mic"
    case .builtInSpeaker: return "builtin_speaker"
    case .builtInReceiver: return "earpiece"
    case .bluetoothHFP: return "bluetooth_headset"
    case .bluetoothA2DP: return "bluetooth_a2dp"
    case .bluetoothLE: return "bluetooth_le"
    case .headsetMic, .headphones: return "wired"
    case .usbAudio: return "usb"
    default: return "other"
    }
  }

  private func entry(_ id: String, _ name: String, _ kind: String) -> [String: Any] {
    ["id": id, "name": name, "kind": kind, "isBluetooth": kind.hasPrefix("bluetooth"), "address": id]
  }

  private func devices() -> [String: Any] {
    let s = AVAudioSession.sharedInstance()
    let ins = s.availableInputs ?? []
    let inputs = ins.map { p -> [String: Any] in
      let k = kind(p.portType)
      return entry(p.uid, k == "builtin_mic" ? "Phone microphone" : p.portName, k)
    }
    var outputs: [[String: Any]] = [entry("speaker", "Phone speaker", "builtin_speaker")]
    // A Bluetooth headset's earpiece is selected through its mic port on iOS.
    for p in ins where [.bluetoothHFP, .bluetoothLE, .headsetMic, .usbAudio].contains(p.portType) {
      outputs.append(entry(p.uid, p.portName, kind(p.portType)))
    }
    for p in s.currentRoute.outputs where !outputs.contains(where: { ($0["id"] as? String) == p.uid }) {
      if p.portType == .builtInSpeaker || p.portType == .builtInReceiver { continue }
      outputs.append(entry(p.uid, p.portName, kind(p.portType)))
    }
    return ["inputs": inputs, "outputs": outputs, "activeInputId": s.currentRoute.inputs.first?.uid as Any]
  }

  private func applyInput(_ id: String?) {
    let s = AVAudioSession.sharedInstance()
    let ins = s.availableInputs ?? []
    let port = ins.first { $0.uid == id } ?? ins.first { $0.portType == .builtInMic }
    do {
      try s.overrideOutputAudioPort(.none)
      try s.setPreferredInput(port)
    } catch {
      sendEvent("onRouteError", ["message": "Could not switch microphone: \(error.localizedDescription)"])
    }
  }

  private func applyOutput(_ id: String?) {
    guard let id else { return }
    let s = AVAudioSession.sharedInstance()
    do {
      if id == "speaker" {
        try s.overrideOutputAudioPort(.speaker)
      } else if let port = s.availableInputs?.first(where: { $0.uid == id }) {
        try s.overrideOutputAudioPort(.none)
        try s.setPreferredInput(port)
      } else {
        try s.overrideOutputAudioPort(.none)
      }
    } catch {
      sendEvent("onRouteError", ["message": "Could not switch output: \(error.localizedDescription)"])
    }
  }

  // MARK: - Capture

  private func startCapture(_ o: CaptureOptions) throws {
    stopEngine()
    options = o
    try configureSession(voiceProcessing: o.voiceProcessing)
    applyInput(o.inputDeviceId)

    let input = engine.inputNode
    if o.voiceProcessing { try? input.setVoiceProcessingEnabled(true) }
    let inFormat = input.outputFormat(forBus: 0)
    guard inFormat.sampleRate > 0, let conv = AVAudioConverter(from: inFormat, to: targetFormat) else {
      throw Exception(name: "CAPTURE_FAILED", description: "Microphone is not available")
    }
    converter = conv
    pending.removeAll()
    input.installTap(onBus: 0, bufferSize: 2048, format: inFormat) { [weak self] buffer, _ in
      self?.handle(buffer)
    }
    engine.prepare()
    try engine.start()
    capturing = true
  }

  private func handle(_ buffer: AVAudioPCMBuffer) {
    guard let converter else { return }
    let ratio = targetFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
    guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }
    var consumed = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
      if consumed {
        status.pointee = .noDataNow
        return nil
      }
      consumed = true
      status.pointee = .haveData
      return buffer
    }
    guard error == nil, out.frameLength > 0, let ch = out.int16ChannelData else { return }
    pending.append(Data(bytes: ch[0], count: Int(out.frameLength) * 2))
    while pending.count >= 3200 { // 100 ms chunks
      let chunk = pending.prefix(3200)
      pending.removeFirst(3200)
      if muted { continue }
      sendEvent("onAudio", ["data": chunk.base64EncodedString(), "level": level(chunk)])
    }
  }

  private func level(_ d: Data) -> Double {
    d.withUnsafeBytes { raw -> Double in
      let samples = raw.bindMemory(to: Int16.self)
      guard !samples.isEmpty else { return 0 }
      var sum = 0.0
      for s in samples { sum += Double(s) * Double(s) }
      return min(1.0, (sum / Double(samples.count)).squareRoot() / 8000.0)
    }
  }

  private func stopEngine() {
    if engine.isRunning { engine.stop() }
    engine.inputNode.removeTap(onBus: 0)
    converter = nil
  }
}
