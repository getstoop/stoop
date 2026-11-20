import CryptoKit
import Foundation

@testable import StoopPush

// Files the tests read where the repo keeps them.
enum Repo {
  // mobile/extensions/notification-service
  static let package = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  static let root = package.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

  // One of the server's payload fixtures (internal/push/testdata).
  static func fixture(_ name: String) throws -> Data {
    try Data(contentsOf: root.appendingPathComponent("internal/push/testdata").appendingPathComponent(name))
  }
}

func base64url(_ text: String) -> Data {
  var padded = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
  while padded.count % 4 != 0 { padded += "=" }
  return Data(base64Encoded: padded)!
}

// A subscription as the phone holds it, and the sender's side of RFC
// 8291 for it, padded as the server pads (internal/webpush): the
// delimiter, then zeros to a multiple of 256.
struct TestSubscription {
  let privateKey = P256.KeyAgreement.PrivateKey()
  let auth = Data((0..<16).map { _ in UInt8.random(in: 0...255) })

  var stored: Data { privateKey.rawRepresentation + auth }

  func candidate(_ id: String) -> PushReader.Candidate {
    PushReader.Candidate(id: id, stored: stored)
  }

  func seal(_ plain: Data) throws -> Data {
    let sender = P256.KeyAgreement.PrivateKey()
    let senderPublic = sender.publicKey.x963Representation
    let salt = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
    let shared = try sender.sharedSecretFromKeyAgreement(with: privateKey.publicKey)
    let inputKey = shared.hkdfDerivedSymmetricKey(
      using: SHA256.self, salt: auth,
      sharedInfo: Data("WebPush: info\0".utf8) + privateKey.publicKey.x963Representation + senderPublic,
      outputByteCount: 32)
    let contentKey = HKDF<SHA256>.deriveKey(
      inputKeyMaterial: inputKey, salt: salt, info: Data("Content-Encoding: aes128gcm\0".utf8), outputByteCount: 16)
    let nonce = HKDF<SHA256>.deriveKey(
      inputKeyMaterial: inputKey, salt: salt, info: Data("Content-Encoding: nonce\0".utf8), outputByteCount: 12)
    var record = plain + [0x02]
    record += Data(count: (256 - record.count % 256) % 256)
    let box = try AES.GCM.seal(
      record, using: contentKey, nonce: AES.GCM.Nonce(data: nonce.withUnsafeBytes { Data($0) }))
    return salt + Data([0, 0, 0x10, 0, 65]) + senderPublic + box.ciphertext + box.tag
  }

  // What the relay puts in "c": the body in standard base64.
  func body(_ plain: Data) throws -> String {
    try seal(plain).base64EncodedString()
  }
}
