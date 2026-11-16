package webpush

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
)

const (
	// MaxBodyBytes is the largest encrypted body Send will post.
	MaxBodyBytes = 2800
	// MaxPayloadBytes is the largest payload that fits MaxBodyBytes once
	// padded: 2560 bytes of record, less the padding delimiter.
	MaxPayloadBytes = (MaxBodyBytes-headerBytes-tagBytes)/padBlock*padBlock - 1

	padBlock    = 256
	saltBytes   = 16
	authBytes   = 16
	keyBytes    = 16
	nonceBytes  = 12
	tagBytes    = 16
	pointBytes  = 65 // an uncompressed P-256 point
	headerBytes = saltBytes + 4 + 1 + pointBytes
	// recordSize is the rs every message declares. One record holds any
	// body up to MaxBodyBytes.
	recordSize = 4096
	// lastRecord is the padding delimiter of a final record (RFC 8188 §2).
	lastRecord = 0x02
)

var (
	// ErrPayloadTooLarge is a payload over MaxPayloadBytes.
	ErrPayloadTooLarge = errors.New("webpush: payload too large")
	// ErrBadSubscription is a subscription whose endpoint or keys cannot
	// be used.
	ErrBadSubscription = errors.New("webpush: bad subscription")
)

// encrypt is the aes128gcm body for payload (RFC 8291), under a fresh key
// pair and salt, padded so its length is a multiple of padBlock.
func encrypt(payload, p256dh, auth []byte) ([]byte, error) {
	if len(payload) > MaxPayloadBytes {
		return nil, fmt.Errorf("%w: %d bytes, limit %d", ErrPayloadTooLarge, len(payload), MaxPayloadBytes)
	}
	ephemeral, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	salt := make([]byte, saltBytes)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	return seal(pad(payload), p256dh, auth, ephemeral, salt)
}

// pad ends payload with the last-record delimiter and zeros up to the next
// multiple of padBlock.
func pad(payload []byte) []byte {
	record := make([]byte, (len(payload)/padBlock+1)*padBlock)
	copy(record, payload)
	record[len(payload)] = lastRecord
	return record
}

// seal encrypts one padded record to the subscription's keys with the
// given sender key and salt (RFC 8291 §3.3, §3.4).
func seal(record, p256dh, auth []byte, sender *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	if len(auth) != authBytes {
		return nil, fmt.Errorf("%w: auth secret is %d bytes, want %d", ErrBadSubscription, len(auth), authBytes)
	}
	receiver, err := ecdh.P256().NewPublicKey(p256dh)
	if err != nil || len(p256dh) != pointBytes {
		return nil, fmt.Errorf("%w: p256dh is not an uncompressed P-256 point", ErrBadSubscription)
	}
	shared, err := sender.ECDH(receiver)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBadSubscription, err)
	}
	senderPoint := sender.PublicKey().Bytes()
	info := "WebPush: info\x00" + string(p256dh) + string(senderPoint)
	ikm, err := hkdf.Key(sha256.New, shared, auth, info, 32)
	if err != nil {
		return nil, err
	}
	return sealRecord(ikm, salt, senderPoint, record)
}

// sealRecord is a single-record aes128gcm body (RFC 8188 §2): the header
// carrying salt, record size and keyID, then the sealed record.
func sealRecord(ikm, salt, keyID, record []byte) ([]byte, error) {
	if len(salt) != saltBytes {
		return nil, fmt.Errorf("webpush: salt is %d bytes, want %d", len(salt), saltBytes)
	}
	if len(keyID) > 255 || len(record)+tagBytes > recordSize {
		return nil, errors.New("webpush: record does not fit")
	}
	aead, nonce, err := recordCipher(ikm, salt)
	if err != nil {
		return nil, err
	}
	body := make([]byte, 0, saltBytes+4+1+len(keyID)+len(record)+tagBytes)
	body = append(body, salt...)
	body = binary.BigEndian.AppendUint32(body, recordSize)
	body = append(body, byte(len(keyID)))
	body = append(body, keyID...)
	return aead.Seal(body, nonce, record, nil), nil
}

// recordCipher derives the content key and the first record's nonce.
func recordCipher(ikm, salt []byte) (cipher.AEAD, []byte, error) {
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		return nil, nil, err
	}
	key, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", keyBytes)
	if err != nil {
		return nil, nil, err
	}
	nonce, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", nonceBytes)
	if err != nil {
		return nil, nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}
	aead, err := cipher.NewGCM(block)
	return aead, nonce, err
}
