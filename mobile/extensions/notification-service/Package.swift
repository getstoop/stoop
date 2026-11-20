// swift-tools-version:5.9
import PackageDescription

// The notification service extension's pure logic (Sources/StoopPush) as
// a package of its own, for `swift test` on a Mac with no simulator: the
// decryption, the payload, the mirror and the words import Foundation and
// CryptoKit only. The extension target the config plugin makes
// (mobile/plugins/withNotificationService.js) compiles the same files
// beside Extension/; this package is for the tests alone.
let package = Package(
  name: "StoopPush",
  platforms: [.macOS(.v13)],
  targets: [
    .target(name: "StoopPush", path: "Sources/StoopPush"),
    .testTarget(name: "StoopPushTests", dependencies: ["StoopPush"], path: "Tests/StoopPushTests"),
  ]
)
