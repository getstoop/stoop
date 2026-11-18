import XCTest

@testable import StoopPush

final class PushReaderTests: XCTestCase {
  // The mention fixture, addressed to the server the phone calls "k3x9pq".
  private func mention() throws -> Data { try Repo.fixture("payload-mention.json") }

  func testFindsTheKeyThatOpensItAmongSeveral() throws {
    let ours = TestSubscription()
    let keys = [
      TestSubscription().candidate("dev-check"),
      PushReader.Candidate(id: "broken", stored: Data(count: 5)),
      ours.candidate("k3x9pq"),
      TestSubscription().candidate("zzz"),
    ]
    let payload = try XCTUnwrap(PushReader.read(body: ours.body(mention()), keys: keys))
    XCTAssertEqual(payload.serverId, "k3x9pq")
    XCTAssertEqual(payload.messageId, "0193a5b2-7c1e-7000-8000-0000000000e1")
  }

  func testNoKeyOpensAPushFromAServerSinceRemoved() throws {
    let removed = TestSubscription()
    let keys = [TestSubscription().candidate("k3x9pq"), TestSubscription().candidate("dev-check")]
    XCTAssertNil(PushReader.read(body: try removed.body(mention()), keys: keys))
    XCTAssertNil(PushReader.read(body: try removed.body(mention()), keys: []))
  }

  func testRefusesAPayloadNamingAnotherServerThanItsKey() throws {
    let ours = TestSubscription()
    XCTAssertNil(PushReader.read(body: try ours.body(mention()), keys: [ours.candidate("other")]))
  }

  func testRefusesWhatIsNotAPayloadInside() throws {
    let ours = TestSubscription()
    let keys = [ours.candidate("k3x9pq")]
    XCTAssertNil(PushReader.read(body: try ours.body(Data("hello".utf8)), keys: keys))
    let laterVersion = String(decoding: try mention(), as: UTF8.self).replacingOccurrences(of: "\"v\":1", with: "\"v\":2")
    XCTAssertNil(PushReader.read(body: try ours.body(Data(laterVersion.utf8)), keys: keys))
  }

  func testRefusesABodyThatIsNotBase64OrNotAMessage() throws {
    let keys = [TestSubscription().candidate("k3x9pq")]
    XCTAssertNil(PushReader.read(body: "not base64!", keys: keys))
    XCTAssertNil(PushReader.read(body: Data("too short".utf8).base64EncodedString(), keys: keys))
  }
}
