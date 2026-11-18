import XCTest

@testable import StoopPush

final class PushPayloadTests: XCTestCase {
  private let fixtures = ["payload-mention.json", "payload-dm.json", "payload-thread-reply.json", "payload-cut.json"]

  // A fixture with fields replaced, or removed by NSNull.
  private func changed(_ name: String, _ change: [String: Any]) throws -> Data {
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Repo.fixture(name)) as? [String: Any])
    for (key, value) in change {
      if value is NSNull { object.removeValue(forKey: key) } else { object[key] = value }
    }
    return try JSONSerialization.data(withJSONObject: object)
  }

  func testReadsEveryFixtureTheServerWrites() throws {
    for name in fixtures {
      XCTAssertNotNil(PushPayload(json: try Repo.fixture(name)), name)
    }
    let mention = try XCTUnwrap(PushPayload(json: Repo.fixture("payload-mention.json")))
    XCTAssertEqual(mention.serverId, "k3x9pq")
    XCTAssertEqual(mention.kind, 1)
    XCTAssertEqual(mention.actorName, "Bea Marsh")
    XCTAssertEqual(mention.preview, "@ada can you look at the build? It says \"<no tests>\" & stops")
    XCTAssertEqual(mention.waiting, 3)
  }

  func testCarriesWhereATapGoesWithTheKindANumber() throws {
    let reply = try XCTUnwrap(PushPayload(json: Repo.fixture("payload-thread-reply.json")))
    let data = reply.data
    XCTAssertEqual(
      data as NSDictionary,
      [
        "serverId": "k3x9pq",
        "itemId": "0193a5b2-7c1e-7000-8000-000000000003",
        "kind": 4,
        "spaceId": "0193a5b2-7c1e-7000-8000-0000000000a1",
        "channelId": "0193a5b2-7c1e-7000-8000-0000000000c1",
        "threadRootId": "0193a5b2-7c1e-7000-8000-0000000000e0",
        "messageId": "0193a5b2-7c1e-7000-8000-0000000000e3",
      ] as NSDictionary)
    // As JSON the kind is a number, which the app's notificationData asks for.
    let json = String(decoding: try JSONSerialization.data(withJSONObject: data), as: UTF8.self)
    XCTAssertTrue(json.contains("\"kind\":4"), json)
  }

  func testRefusesAVersionItDoesNotKnow() throws {
    XCTAssertNil(PushPayload(json: try changed("payload-mention.json", ["v": 2])))
    XCTAssertNil(PushPayload(json: try changed("payload-mention.json", ["v": "1"])))
    XCTAssertNil(PushPayload(json: try changed("payload-mention.json", ["v": NSNull()])))
  }

  func testIgnoresFieldsItDoesNotKnow() throws {
    XCTAssertNotNil(PushPayload(json: try changed("payload-mention.json", ["later": ["a": 1]])))
  }

  func testRefusesAPayloadThatIsNotWhole() throws {
    for field in ["serverId", "itemId", "kind", "spaceId", "channelId", "threadRootId", "messageId", "actorName",
      "preview", "spaceName", "channelName", "waiting"]
    {
      XCTAssertNil(PushPayload(json: try changed("payload-mention.json", [field: NSNull()])), field)
    }
    for field in ["serverId", "itemId", "channelId", "messageId"] {
      XCTAssertNil(PushPayload(json: try changed("payload-mention.json", [field: ""])), field)
    }
    XCTAssertNil(PushPayload(json: try changed("payload-mention.json", ["kind": "mention"])))
    XCTAssertNil(PushPayload(json: try changed("payload-mention.json", ["kind": true])))
    XCTAssertNil(PushPayload(json: try changed("payload-mention.json", ["waiting": 1.5])))
    XCTAssertNil(PushPayload(json: Data("[1]".utf8)))
    XCTAssertNil(PushPayload(json: Data("not json".utf8)))
  }
}
