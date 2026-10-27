Pod::Spec.new do |s|
  s.name           = 'StoopRichText'
  s.version        = '0.0.1'
  s.summary        = 'Message paragraphs and the composer field, drawn with TextKit'
  s.description    = 'Message paragraphs and the composer field, drawn with TextKit'
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
