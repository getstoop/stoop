import XCTest

@testable import StoopPush

final class PushMirrorTests: XCTestCase {
  private func mirror(_ json: String) -> PushMirror {
    PushMirror(json: Data(json.utf8))
  }

  func testReadsWhatTheAppWrote() {
    let read = mirror(
      #"{"showText":true,"servers":{"a":{"name":"Elm Street","spaces":3},"b":{"name":"Oak","spaces":1}}}"#)
    XCTAssertEqual(
      read.settings(serverId: "a"),
      PushSettings(showText: true, serverName: "Elm Street", manyServers: true, manySpaces: true))
    XCTAssertEqual(
      read.settings(serverId: "b"),
      PushSettings(showText: true, serverName: "Oak", manyServers: true, manySpaces: false))
  }

  func testHidesTheTextWhenTheSwitchIsOff() {
    XCTAssertFalse(mirror(#"{"showText":false,"servers":{}}"#).settings(serverId: "a").showText)
  }

  // After a reinstall the keys are still there and the store is empty.
  func testWithNothingMirroredHidesTheTextAndNamesTheSpaceButNoServer() {
    let careful = PushSettings(showText: false, serverName: "", manyServers: false, manySpaces: true)
    XCTAssertEqual(PushMirror(json: nil).settings(serverId: "a"), careful)
    XCTAssertEqual(mirror("{half").settings(serverId: "a"), careful)
    XCTAssertEqual(mirror("[]").settings(serverId: "a"), careful)
    XCTAssertEqual(mirror(#"{"showText":1,"servers":7}"#).settings(serverId: "a"), careful)
  }

  func testAServerNotMirroredHasNoNameAndItsSpaceIsNamed() {
    let read = mirror(#"{"showText":true,"servers":{"a":{"name":"Elm Street","spaces":1}}}"#)
    XCTAssertEqual(
      read.settings(serverId: "dev-check"),
      PushSettings(showText: true, serverName: "", manyServers: false, manySpaces: true))
  }

  func testASpaceCountNotKnownYetNamesTheSpace() {
    let read = mirror(#"{"showText":true,"servers":{"a":{"name":"Elm Street"}}}"#)
    XCTAssertTrue(read.settings(serverId: "a").manySpaces)
  }

  func testOnlyTheOneSavedServerOwnsTheBadge() {
    XCTAssertTrue(mirror(#"{"servers":{"a":{"name":"Elm"}}}"#).isOnlyServer("a"))
    XCTAssertFalse(mirror(#"{"servers":{"a":{"name":"Elm"}}}"#).isOnlyServer("b"))
    XCTAssertFalse(mirror(#"{"servers":{"a":{"name":"Elm"},"b":{"name":"Oak"}}}"#).isOnlyServer("a"))
    XCTAssertFalse(PushMirror(json: nil).isOnlyServer("a"))
  }
}
