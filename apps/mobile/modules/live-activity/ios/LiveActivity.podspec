Pod::Spec.new do |s|
  s.name           = 'LiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Live Activities of followed trains and the commute widget data'
  s.description    = 'Starts, updates and ends the ActivityKit activity of a followed train and writes the commute widget data to the App Group.'
  s.author         = 'MHaV'
  s.homepage       = 'https://megisholavonat.info'
  s.license        = { type: 'MIT' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ActivityKit', 'WidgetKit', 'Security'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.swift'
end
