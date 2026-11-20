import CryptoKit
import Foundation

// Opening a Web Push message (RFC 8291) in the aes128gcm content coding
// (RFC 8188), one record:
//
//   salt (16) | record size (4) | key ID length (1) | key ID | record
//
// The key ID is the sender's ephemeral P-256 public key, 65 bytes
// uncompressed. The record is the ciphertext and its 16-byte tag; the
// plaintext ends with the last-record delimiter 0x02 and any padding
// zeros.
enum WebPush {
  enum Failure: Error, Equatable {
    // Not a message any key could open.
    case malformed
    // These keys did not open it; others might.
    case notOurs
  }

  // A subscription's keys as the app keeps them (PushKeychain.swift in
  // modules/stoop-push-keys): 48 bytes, the private key's raw scalar (32)
  // then the auth secret (16).
  struct Keys {
    static let storedLength = 48
    let privateKey: P256.KeyAgreement.PrivateKey
    let auth: Data

    init?(stored: Data) {
      let bytes = [UInt8](stored)
      guard bytes.count == Keys.storedLength,
        let privateKey = try? P256.KeyAgreement.PrivateKey(rawRepresentation: Data(bytes[0..<32]))
      else { return nil }
      self.privateKey = privateKey
      self.auth = Data(bytes[32...])
    }
  }

  private static let saltLength = 16
  private static let headerLength = 21
  private static let publicKeyLength = 65
  private static let tagLength = 16
  private static let lastRecord: UInt8 = 0x02

  // The message's plaintext, its delimiter and padding taken off.
  static func open(_ message: Data, with keys: Keys) throws -> Data {
    let bytes = [UInt8](message)
    // At least the header, the key and a record of one delimiter.
    guard bytes.count > headerLength + publicKeyLength + tagLength,
      Int(bytes[headerLength - 1]) == publicKeyLength
    else { throw Failure.malformed }
    let salt = Data(bytes[0..<saltLength])
    let recordSize = bytes[saltLength..<(headerLength - 1)].reduce(0) { ($0 << 8) | Int($1) }
    let senderBytes = Data(bytes[headerLength..<(headerLength + publicKeyLength)])
    let record = Data(bytes[(headerLength + publicKeyLength)...])
    // One record only: a longer body would be several.
    guard record.count <= recordSize,
      let sender = try? P256.KeyAgreement.PublicKey(x963Representation: senderBytes)
    else { throw Failure.malformed }

    guard let shared = try? keys.privateKey.sharedSecretFromKeyAgreement(with: sender) else {
      throw Failure.notOurs
    }
    let keyInfo = Data("WebPush: info\0".utf8) + keys.privateKey.publicKey.x963Representation + senderBytes
    let inputKey = shared.hkdfDerivedSymmetricKey(
      using: SHA256.self, salt: keys.auth, sharedInfo: keyInfo, outputByteCount: 32)
    let contentKey = HKDF<SHA256>.deriveKey(
      inputKeyMaterial: inputKey, salt: salt, info: Data("Content-Encoding: aes128gcm\0".utf8), outputByteCount: 16)
    let nonce = HKDF<SHA256>.deriveKey(
      inputKeyMaterial: inputKey, salt: salt, info: Data("Content-Encoding: nonce\0".utf8), outputByteCount: 12)

    // A wrong key fails here, on the tag.
    guard
      let box = try? AES.GCM.SealedBox(
        nonce: AES.GCM.Nonce(data: nonce.withUnsafeBytes { Data($0) }),
        ciphertext: record.dropLast(tagLength), tag: record.suffix(tagLength)),
      let padded = try? AES.GCM.open(box, using: contentKey)
    else { throw Failure.notOurs }

    var plain = [UInt8](padded)
    while plain.last == 0 { plain.removeLast() }
    guard plain.last == lastRecord else { throw Failure.malformed }
    plain.removeLast()
    return Data(plain)
  }
}
