// swift-tools-version:5.9
import PackageDescription

// The editor's document and features (ios/Editor) as a package of their
// own, for `swift test` on a Mac: they import Foundation only, so the
// rules about marks, links, pills, blocks and typing shortcuts run
// without a simulator. The app builds the same files through the podspec
// beside them; this package is for the tests alone.
let package = Package(
  name: "StoopEditor",
  platforms: [.macOS(.v13)],
  targets: [
    .target(name: "StoopEditor", path: "ios/Editor"),
    .testTarget(name: "StoopEditorTests", dependencies: ["StoopEditor"], path: "tests/ios"),
  ]
)
