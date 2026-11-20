package expo.modules.audiorouting

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class CaptureOptions : Record {
  @Field var inputDeviceId: String? = null
  @Field var voiceProcessing: Boolean = true
}

class SpeakOptions : Record {
  @Field var text: String = ""
  @Field var locale: String = "en-US"
  @Field var outputDeviceId: String? = null
  @Field var rate: Double = 1.0
}

private const val SAMPLE_RATE = 16000
private const val CHUNK_BYTES = 3200 // 100 ms of 16 kHz mono s16le

class AudioRoutingModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("NO_CONTEXT", "React context unavailable", null)
  private val audioManager: AudioManager
    get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val main = Handler(Looper.getMainLooper())

  // Capture state
  @Volatile private var record: AudioRecord? = null
  @Volatile private var capturing = false
  @Volatile private var muted = false
  private var captureThread: Thread? = null
  private var captureOptions = CaptureOptions()

  // Speech output state
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private val ttsWaiting = mutableListOf<() -> Unit>()
  private val pendingSpeech = ConcurrentHashMap<String, Pair<SpeakOptions, Promise>>()
  private var player: MediaPlayer? = null
  private var playingPromise: Promise? = null

  private val deviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) = emitDevices()
    override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) = emitDevices()
  }

  override fun definition() = ModuleDefinition {
    Name("AudioRouting")
    Events("onAudio", "onDevicesChanged", "onRouteError")

    OnCreate {
      audioManager.registerAudioDeviceCallback(deviceCallback, main)
      initTts()
    }

    OnDestroy {
      runCatching { audioManager.unregisterAudioDeviceCallback(deviceCallback) }
      stopCaptureInternal()
      resetRouting()
      tts?.shutdown()
      player?.release()
    }

    // Runtime permissions are requested from JS (PermissionsAndroid); this only reports the result.
    AsyncFunction("requestPermissions") {
      val mic = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
      val bt = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
      mic && bt
    }

    Function("getDevices") { devicesMap() }

    AsyncFunction("startCapture") { options: CaptureOptions ->
      startCaptureInternal(options)
    }

    AsyncFunction("setInputDevice") { inputDeviceId: String? ->
      val opts = CaptureOptions().apply {
        this.inputDeviceId = inputDeviceId
        this.voiceProcessing = captureOptions.voiceProcessing
      }
      if (capturing) startCaptureInternal(opts) else captureOptions = opts
    }

    AsyncFunction("stopCapture") {
      stopCaptureInternal()
      resetRouting()
    }

    Function("setCaptureMuted") { value: Boolean -> muted = value }

    AsyncFunction("speak") { options: SpeakOptions, promise: Promise ->
      whenTtsReady { synthesize(options, promise) }
    }

    Function("stopSpeaking") {
      tts?.stop()
      main.post { finishPlayback(null) }
      pendingSpeech.values.forEach { it.second.resolve(null) }
      pendingSpeech.clear()
    }

    AsyncFunction("availableVoices") { promise: Promise ->
      whenTtsReady {
        val locales = runCatching { tts?.availableLanguages?.map { it.toLanguageTag() } }.getOrNull() ?: emptyList()
        promise.resolve(locales.sorted())
      }
    }
  }

  // ---------------------------------------------------------------- devices

  private fun kindOf(d: AudioDeviceInfo): String? = when (d.type) {
    AudioDeviceInfo.TYPE_BUILTIN_MIC -> "builtin_mic"
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "builtin_speaker"
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth_headset"
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "bluetooth_a2dp"
    AudioDeviceInfo.TYPE_HEARING_AID -> "bluetooth_le"
    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired"
    AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET -> "usb"
    else -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      (d.type == AudioDeviceInfo.TYPE_BLE_HEADSET || d.type == AudioDeviceInfo.TYPE_BLE_SPEAKER)) "bluetooth_le" else null
  }

  private fun labelOf(d: AudioDeviceInfo, kind: String): String = when (kind) {
    "builtin_mic" -> "Phone microphone"
    "builtin_speaker" -> "Phone speaker"
    "earpiece" -> "Phone earpiece"
    else -> {
      val name = d.productName?.toString()?.takeIf { it.isNotBlank() } ?: "Audio device"
      when (kind) {
        "bluetooth_headset" -> "$name (headset)"
        "bluetooth_a2dp" -> "$name (media)"
        "bluetooth_le" -> "$name (LE audio)"
        else -> name
      }
    }
  }

  private fun addressOf(d: AudioDeviceInfo): String? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) d.address.takeIf { it.isNotBlank() } else null

  private fun deviceMap(d: AudioDeviceInfo, kind: String) = mapOf(
    "id" to d.id.toString(),
    "name" to labelOf(d, kind),
    "kind" to kind,
    "isBluetooth" to kind.startsWith("bluetooth"),
    "address" to addressOf(d),
  )

  private fun list(flag: Int): List<Pair<AudioDeviceInfo, String>> =
    audioManager.getDevices(flag).mapNotNull { d -> kindOf(d)?.let { d to it } }
      // Only one built-in mic entry (phones expose several: top, bottom, back).
      .distinctBy { (d, k) -> if (k == "builtin_mic") "builtin_mic" else d.id.toString() }

  private fun devicesMap(): Map<String, Any?> = mapOf(
    "inputs" to list(AudioManager.GET_DEVICES_INPUTS).map { (d, k) -> deviceMap(d, k) },
    "outputs" to list(AudioManager.GET_DEVICES_OUTPUTS).map { (d, k) -> deviceMap(d, k) },
    "activeInputId" to captureOptions.inputDeviceId,
  )

  private fun emitDevices() = sendEvent("onDevicesChanged", devicesMap())

  private fun find(id: String?, flag: Int): AudioDeviceInfo? =
    id?.let { audioManager.getDevices(flag).firstOrNull { d -> d.id.toString() == it } }

  private fun isHeadsetLink(d: AudioDeviceInfo?): Boolean = d != null && (
    d.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
      (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && d.type == AudioDeviceInfo.TYPE_BLE_HEADSET))

  // ---------------------------------------------------------------- routing

  /**
   * Routes the communication path (mic + voice playback) to [device].
   * Android keeps exactly one communication device at a time, so a Bluetooth headset's
   * mic and earpiece are always selected together.
   */
  @Suppress("DEPRECATION")
  private fun routeCommunication(device: AudioDeviceInfo?) {
    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (device == null) {
        audioManager.clearCommunicationDevice()
        return
      }
      val target = audioManager.availableCommunicationDevices.firstOrNull { c ->
        c.id == device.id || (c.type == device.type && addressOf(c) != null && addressOf(c) == addressOf(device))
      } ?: audioManager.availableCommunicationDevices.firstOrNull { c ->
        // An input device (e.g. SCO mic) maps to its output counterpart with the same address.
        addressOf(c) != null && addressOf(c) == addressOf(device) && isHeadsetLink(c)
      }
      if (target == null || !audioManager.setCommunicationDevice(target)) {
        sendEvent("onRouteError", mapOf("message" to "Could not switch audio to ${device.productName}"))
      }
    } else {
      when {
        isHeadsetLink(device) -> {
          audioManager.isSpeakerphoneOn = false
          audioManager.startBluetoothSco()
          audioManager.isBluetoothScoOn = true
        }
        device?.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> {
          audioManager.stopBluetoothSco()
          audioManager.isBluetoothScoOn = false
          audioManager.isSpeakerphoneOn = true
        }
        else -> {
          audioManager.stopBluetoothSco()
          audioManager.isBluetoothScoOn = false
          audioManager.isSpeakerphoneOn = false
        }
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun resetRouting() {
    runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) audioManager.clearCommunicationDevice()
      else {
        audioManager.stopBluetoothSco()
        audioManager.isBluetoothScoOn = false
        audioManager.isSpeakerphoneOn = false
      }
      audioManager.mode = AudioManager.MODE_NORMAL
    }
  }

  /** Puts the communication route back on the capture device after something else was played. */
  private fun restoreCaptureRoute() {
    if (!capturing) return
    val input = find(captureOptions.inputDeviceId, AudioManager.GET_DEVICES_INPUTS)
    if (isHeadsetLink(input)) routeCommunication(input)
    else routeCommunication(audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      .firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER })
  }

  // ---------------------------------------------------------------- capture

  @SuppressLint("MissingPermission")
  private fun startCaptureInternal(options: CaptureOptions) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      throw CodedException("NO_PERMISSION", "Microphone permission not granted", null)
    }
    stopCaptureInternal()
    captureOptions = options
    val input = find(options.inputDeviceId, AudioManager.GET_DEVICES_INPUTS)
    if (isHeadsetLink(input)) routeCommunication(input) else restoreCaptureRoute()

    val source = if (options.voiceProcessing) MediaRecorder.AudioSource.VOICE_COMMUNICATION
    else MediaRecorder.AudioSource.VOICE_RECOGNITION
    val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val rec = AudioRecord(source, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(minBuf, CHUNK_BYTES * 4))
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      throw CodedException("CAPTURE_FAILED", "Could not open the microphone", null)
    }
    input?.let { rec.setPreferredDevice(it) }
    rec.startRecording()
    record = rec
    capturing = true
    captureThread = thread(name = "AudioRoutingCapture", priority = Thread.MAX_PRIORITY) {
      val buf = ByteArray(CHUNK_BYTES)
      while (capturing) {
        var filled = 0
        while (filled < CHUNK_BYTES && capturing) {
          val n = rec.read(buf, filled, CHUNK_BYTES - filled)
          if (n <= 0) break
          filled += n
        }
        if (filled <= 0 || muted) continue
        sendEvent("onAudio", mapOf(
          "data" to Base64.encodeToString(buf, 0, filled, Base64.NO_WRAP),
          "level" to rms(buf, filled),
        ))
      }
    }
  }

  private fun rms(buf: ByteArray, len: Int): Double {
    var sum = 0.0
    var i = 0
    while (i + 1 < len) {
      val s = ((buf[i + 1].toInt() shl 8) or (buf[i].toInt() and 0xff)).toShort().toDouble()
      sum += s * s
      i += 2
    }
    return min(1.0, sqrt(sum / max(1, len / 2)) / 8000.0)
  }

  private fun stopCaptureInternal() {
    capturing = false
    captureThread?.join(500)
    captureThread = null
    record?.let { runCatching { it.stop() }; it.release() }
    record = null
  }

  // ---------------------------------------------------------------- speech output

  private fun initTts() {
    tts = TextToSpeech(context) { status ->
      main.post {
        ttsReady = status == TextToSpeech.SUCCESS
        val waiting = ttsWaiting.toList()
        ttsWaiting.clear()
        waiting.forEach { it() }
      }
    }.apply {
      setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {}
        override fun onDone(utteranceId: String?) {
          val (opts, promise) = pendingSpeech.remove(utteranceId ?: return) ?: return
          main.post { play(File(context.cacheDir, "$utteranceId.wav"), opts, promise) }
        }
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) {
          pendingSpeech.remove(utteranceId ?: return)?.second?.reject(CodedException("TTS_FAILED", "Speech synthesis failed", null))
        }
      })
    }
  }

  private fun whenTtsReady(block: () -> Unit) = main.post {
    if (ttsReady) block() else ttsWaiting.add(block)
  }

  private fun synthesize(options: SpeakOptions, promise: Promise) {
    val engine = tts
    if (engine == null || !ttsReady) {
      promise.reject(CodedException("TTS_UNAVAILABLE", "No text-to-speech engine on this device", null))
      return
    }
    val result = engine.setLanguage(Locale.forLanguageTag(options.locale))
    if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
      promise.reject(CodedException("VOICE_MISSING", "No voice installed for ${options.locale}. Install it in Android Settings → Text-to-speech.", null))
      return
    }
    engine.setSpeechRate(options.rate.toFloat().coerceIn(0.5f, 2.0f))
    val id = UUID.randomUUID().toString()
    pendingSpeech[id] = options to promise
    val file = File(context.cacheDir, "$id.wav")
    if (engine.synthesizeToFile(options.text, Bundle(), file, id) != TextToSpeech.SUCCESS) {
      pendingSpeech.remove(id)
      promise.reject(CodedException("TTS_FAILED", "Speech synthesis failed", null))
    }
  }

  /** Plays a synthesized file on the requested output device, then restores the mic route. */
  private fun play(file: File, options: SpeakOptions, promise: Promise) {
    finishPlayback(null)
    val target = find(options.outputDeviceId, AudioManager.GET_DEVICES_OUTPUTS)
    val viaCommunication = target == null || target.type != AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
    // Headsets, speaker and earpiece go through the communication path (keeps echo cancellation
    // working and avoids profile switches). A2DP-only devices play as media.
    if (viaCommunication && target != null) routeCommunication(target)
    val attrs = AudioAttributes.Builder()
      .setUsage(if (viaCommunication) AudioAttributes.USAGE_VOICE_COMMUNICATION else AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    try {
      val mp = MediaPlayer()
      mp.setAudioAttributes(attrs)
      mp.setDataSource(file.path)
      mp.prepare()
      if (target != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) mp.setPreferredDevice(target)
      mp.setOnCompletionListener { finishPlayback(file) }
      mp.setOnErrorListener { _, _, _ -> finishPlayback(file); true }
      player = mp
      playingPromise = promise
      mp.start()
    } catch (e: Exception) {
      file.delete()
      restoreCaptureRoute()
      promise.reject(CodedException("PLAYBACK_FAILED", e.message ?: "Playback failed", e))
    }
  }

  private fun finishPlayback(file: File?) {
    player?.let { runCatching { it.stop() }; it.release() }
    player = null
    file?.delete()
    val p = playingPromise
    playingPromise = null
    if (p != null) {
      restoreCaptureRoute()
      p.resolve(null)
    }
  }
}
