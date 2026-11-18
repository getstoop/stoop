import XCTest

@testable import StoopPush

// The cases the app's notificationContent runs too
// (mobile/src/notifications/content.cases.test.ts), so a push says what
// the app's own notification would.
final class ContentCasesTests: XCTestCase {
  func testSaysWhatTheAppSays() throws {
    let file = try Data(contentsOf: Repo.package.appendingPathComponent("cases/content.json"))
    let cases = try XCTUnwrap((JSONSerialization.jsonObject(with: file) as? [String: Any])?["cases"] as? [[String: Any]])
    XCTAssertFalse(cases.isEmpty)

    for entry in cases {
      let name = try XCTUnwrap(entry["name"] as? String)
      var object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: Repo.fixture(XCTUnwrap(entry["fixture"] as? String))) as? [String: Any], name)
      for (key, value) in entry["change"] as? [String: Any] ?? [:] { object[key] = value }
      let payload = try XCTUnwrap(PushPayload(json: JSONSerialization.data(withJSONObject: object)), name)

      let given = try XCTUnwrap(entry["settings"] as? [String: Any], name)
      let settings = PushSettings(
        showText: try XCTUnwrap(given["showText"] as? Bool, name),
        serverName: try XCTUnwrap(given["serverName"] as? String, name),
        manyServers: try XCTUnwrap(given["manyServers"] as? Bool, name),
        manySpaces: try XCTUnwrap(given["manySpaces"] as? Bool, name))

      let expected = try XCTUnwrap(entry["expect"] as? [String: String], name)
      let words = PushWords(payload, settings)
      XCTAssertEqual(words.title, expected["title"], name)
      XCTAssertEqual(words.subtitle, expected["subtitle"], name)
      XCTAssertEqual(words.body, expected["body"], name)
    }
  }
}
