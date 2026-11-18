Pod::Spec.new do |s|
  s.name           = 'StoopPushKeys'
  s.version        = '0.0.1'
  s.summary        = 'The keys a push is encrypted to, and a store shared with the notification extension'
  s.description    = 'The keys a push is encrypted to, and a store shared with the notification extension'
  s.license        = 'AGPL-3.0'
  s.author         = 'Stoop'
  s.homepage       = 'https://getstoop.org'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
