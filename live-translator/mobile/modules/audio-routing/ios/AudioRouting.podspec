Pod::Spec.new do |s|
  s.name           = 'AudioRouting'
  s.version        = '0.1.0'
  s.summary        = 'Bluetooth-aware audio capture, routing and speech output'
  s.author         = ''
  s.homepage       = 'https://github.com/aminost/neu-ulm-abfall-calander'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
