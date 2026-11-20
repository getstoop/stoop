import Foundation

// Where Apple delivers this build's pushes, which the relay must be told
// when the app subscribes: a token from one environment is refused by the
// other. It follows how the build was signed, not how it was compiled: a
// Release build signed with a development profile still gets sandbox
// tokens.
//
// The signing is read from the provisioning profile the build carries
// (embedded.mobileprovision, a signed plist), whose entitlements say
// aps-environment. A build from the App Store or TestFlight carries no
// profile, and is always production. The simulator carries none either,
// and uses the sandbox.
enum PushTarget {
  // "sandbox", "production", or "none" when the profile grants no push.
  static func environment() -> String {
    #if targetEnvironment(simulator)
      return "sandbox"
    #else
      guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision") else {
        return "production"
      }
      guard let profile = profile(at: url),
        let entitlements = profile["Entitlements"] as? [String: Any],
        let aps = entitlements["aps-environment"] as? String
      else {
        return "none"
      }
      switch aps {
      case "development": return "sandbox"
      case "production": return "production"
      default: return "none"
      }
    #endif
  }

  static func appId() -> String {
    Bundle.main.bundleIdentifier ?? ""
  }

  // The plist inside the profile's signature, which wraps it unchanged.
  private static func profile(at url: URL) -> [String: Any]? {
    guard let data = try? Data(contentsOf: url),
      let start = data.range(of: Data("<?xml".utf8)),
      let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex)
    else {
      return nil
    }
    let plist = data.subdata(in: start.lowerBound..<end.upperBound)
    return (try? PropertyListSerialization.propertyList(from: plist, format: nil)) as? [String: Any]
  }
}
