import XCTest

@testable import StoopPush

final class WebPushTests: XCTestCase {
  // RFC 8291 section 5 and appendix A: the receiver's private key and
  // auth secret, and the whole message.
  private let rfcKeys = WebPush.Keys(
    stored: base64url("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94") + base64url("BTBZMqHH6r4Tts7J_aSIgg"))!
  private let rfcMessage = base64url(
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_"
      + "yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")

  func testOpensTheRFCsExample() throws {
    let plain = try WebPush.open(rfcMessage, with: rfcKeys)
    XCTAssertEqual(String(decoding: plain, as: UTF8.self), "When I grow up, I want to be a watermelon")
  }

  func testTakesOffTheServersPadding() throws {
    let subscription = TestSubscription()
    let keys = try XCTUnwrap(WebPush.Keys(stored: subscription.stored))
    let message = try subscription.seal(Data("{\"v\":1}".utf8))
    // Header, key, one 256-byte record and its tag.
    XCTAssertEqual(message.count, 21 + 65 + 256 + 16)
    XCTAssertEqual(try WebPush.open(message, with: keys), Data("{\"v\":1}".utf8))
  }

  func testAnotherKeyIsNotOurs() throws {
    let other = try XCTUnwrap(WebPush.Keys(stored: TestSubscription().stored))
    XCTAssertThrowsError(try WebPush.open(rfcMessage, with: other)) { error in
      XCTAssertEqual(error as? WebPush.Failure, .notOurs)
    }
  }

  func testTheRightKeyWithAnotherAuthSecretIsNotOurs() throws {
    let wrongAuth = try XCTUnwrap(
      WebPush.Keys(stored: base64url("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94") + Data(count: 16)))
    XCTAssertThrowsError(try WebPush.open(rfcMessage, with: wrongAuth)) { error in
      XCTAssertEqual(error as? WebPush.Failure, .notOurs)
    }
  }

  func testAChangedMessageIsNotOurs() throws {
    var changed = rfcMessage
    changed[changed.count - 20] ^= 1
    XCTAssertThrowsError(try WebPush.open(changed, with: rfcKeys)) { error in
      XCTAssertEqual(error as? WebPush.Failure, .notOurs)
    }
  }

  func testWhatIsNotAMessageIsMalformed() throws {
    var badKeyLength = rfcMessage
    badKeyLength[20] = 64
    var badPoint = rfcMessage
    badPoint[21] = 0x05
    var smallRecordSize = rfcMessage
    smallRecordSize.replaceSubrange(16..<20, with: [0, 0, 0, 18])
    for message in [Data(), rfcMessage.prefix(60), rfcMessage.prefix(21 + 65 + 16), badKeyLength, badPoint, smallRecordSize] {
      XCTAssertThrowsError(try WebPush.open(Data(message), with: rfcKeys)) { error in
        XCTAssertEqual(error as? WebPush.Failure, .malformed)
      }
    }
  }

  func testStoredKeysAreFortyEightBytes() {
    XCTAssertNil(WebPush.Keys(stored: Data(count: 47)))
    XCTAssertNil(WebPush.Keys(stored: Data(count: 49)))
    // An all-zero scalar is no private key.
    XCTAssertNil(WebPush.Keys(stored: Data(count: 48)))
    XCTAssertNotNil(WebPush.Keys(stored: TestSubscription().stored))
  }
}
