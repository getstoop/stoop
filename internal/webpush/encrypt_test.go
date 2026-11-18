package webpush

import (
	"bytes"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"testing"
)

func b64(t *testing.T, encoded string) []byte {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode %q: %v", encoded, err)
	}
	return raw
}

// openRecord undoes sealRecord: it reads the header and opens the record.
func openRecord(t *testing.T, ikm func(keyID []byte) []byte, body []byte) []byte {
	t.Helper()
	if len(body) < saltBytes+5 {
		t.Fatalf("body is %d bytes, shorter than a header", len(body))
	}
	salt := body[:saltBytes]
	if size := binary.BigEndian.Uint32(body[saltBytes:]); size != recordSize {
		t.Fatalf("record size = %d, want %d", size, recordSize)
	}
	idLen := int(body[saltBytes+4])
	keyID := body[saltBytes+5 : saltBytes+5+idLen]
	aead, nonce, err := recordCipher(ikm(keyID), salt)
	if err != nil {
		t.Fatal(err)
	}
	record, err := aead.Open(nil, nonce, body[saltBytes+5+idLen:], nil)
	if err != nil {
		t.Fatalf("open record: %v", err)
	}
	return record
}

// decrypt is the receiving side of RFC 8291: the padded record of a body
// sent to this key pair and auth secret.
func decrypt(t *testing.T, receiver *ecdh.PrivateKey, auth, body []byte) []byte {
	t.Helper()
	return openRecord(t, func(keyID []byte) []byte {
		sender, err := ecdh.P256().NewPublicKey(keyID)
		if err != nil {
			t.Fatalf("sender key: %v", err)
		}
		shared, err := receiver.ECDH(sender)
		if err != nil {
			t.Fatal(err)
		}
		info := "WebPush: info\x00" + string(receiver.PublicKey().Bytes()) + string(keyID)
		ikm, err := hkdf.Key(sha256.New, shared, auth, info, 32)
		if err != nil {
			t.Fatal(err)
		}
		return ikm
	}, body)
}

// unpad strips the delimiter and zeros pad added.
func unpad(t *testing.T, record []byte) []byte {
	t.Helper()
	trimmed := bytes.TrimRight(record, "\x00")
	if len(trimmed) == 0 || trimmed[len(trimmed)-1] != lastRecord {
		t.Fatalf("record does not end in the last-record delimiter")
	}
	return trimmed[:len(trimmed)-1]
}

func newReceiver(t *testing.T) (*ecdh.PrivateKey, []byte) {
	t.Helper()
	receiver, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, authBytes)
	_, _ = rand.Read(auth)
	return receiver, auth
}

// RFC 8291 §5 and Appendix A.
func TestSealRFC8291Vector(t *testing.T) {
	const want = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
	plaintext := []byte("When I grow up, I want to be a watermelon")
	sender, err := ecdh.P256().NewPrivateKey(b64(t, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	receiver, err := ecdh.P256().NewPrivateKey(b64(t, "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"))
	if err != nil {
		t.Fatal(err)
	}
	auth := b64(t, "BTBZMqHH6r4Tts7J_aSIgg")
	salt := b64(t, "DGv6ra1nlYgDCS1FRnbzlw")
	p256dh := b64(t, "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
	if !bytes.Equal(receiver.PublicKey().Bytes(), p256dh) {
		t.Fatal("the vector's receiver keys do not match")
	}
	if got := base64.RawURLEncoding.EncodeToString(sender.PublicKey().Bytes()); got != "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8" {
		t.Fatalf("sender public key = %s", got)
	}

	// The vector's record carries the delimiter and no further padding.
	body, err := seal(append(plaintext, lastRecord), p256dh, auth, sender, salt)
	if err != nil {
		t.Fatal(err)
	}
	if got := base64.RawURLEncoding.EncodeToString(body); got != want {
		t.Fatalf("body =\n%s\nwant\n%s", got, want)
	}
	if got := unpad(t, decrypt(t, receiver, auth, b64(t, want))); !bytes.Equal(got, plaintext) {
		t.Fatalf("decrypted %q", got)
	}
}

// RFC 8188 §3.1: one record, no key id, the key given directly.
func TestSealRecordRFC8188Vector(t *testing.T) {
	const want = "I1BsxtFttlv3u_Oo94xnmwAAEAAA-NAVub2qFgBEuQKRapoZu-IxkIva3MEB1PD-ly8Thjg"
	ikm := b64(t, "yqdlZ-tYemfogSmv7Ws5PQ")
	body, err := sealRecord(ikm, b64(t, "I1BsxtFttlv3u_Oo94xnmw"), nil, append([]byte("I am the walrus"), lastRecord))
	if err != nil {
		t.Fatal(err)
	}
	if got := base64.RawURLEncoding.EncodeToString(body); got != want {
		t.Fatalf("body = %s, want %s", got, want)
	}
	record := openRecord(t, func([]byte) []byte { return ikm }, b64(t, want))
	if got := unpad(t, record); string(got) != "I am the walrus" {
		t.Fatalf("decrypted %q", got)
	}
}

func TestEncryptRoundTrip(t *testing.T) {
	receiver, auth := newReceiver(t)
	payload := []byte(`{"title":"a message","body":"héllo"}`)
	body, err := encrypt(payload, receiver.PublicKey().Bytes(), auth)
	if err != nil {
		t.Fatal(err)
	}
	if got := unpad(t, decrypt(t, receiver, auth, body)); !bytes.Equal(got, payload) {
		t.Fatalf("decrypted %q, want %q", got, payload)
	}

	// Every message has its own key pair and salt.
	again, err := encrypt(payload, receiver.PublicKey().Bytes(), auth)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(body[:saltBytes], again[:saltBytes]) || bytes.Equal(body[saltBytes+5:headerBytes], again[saltBytes+5:headerBytes]) {
		t.Fatal("two messages share a salt or a sender key")
	}
}

func TestEncryptPadsToBlocks(t *testing.T) {
	receiver, auth := newReceiver(t)
	cases := []struct{ payload, record int }{
		{0, 256}, {1, 256}, {255, 256}, {256, 512}, {257, 512}, {511, 512}, {512, 768},
		{MaxPayloadBytes, 2560},
	}
	for _, tc := range cases {
		payload := bytes.Repeat([]byte{'x'}, tc.payload)
		body, err := encrypt(payload, receiver.PublicKey().Bytes(), auth)
		if err != nil {
			t.Fatalf("%d bytes: %v", tc.payload, err)
		}
		if want := headerBytes + tc.record + tagBytes; len(body) != want {
			t.Errorf("%d bytes: body is %d bytes, want %d", tc.payload, len(body), want)
		}
		if len(body) > MaxBodyBytes {
			t.Errorf("%d bytes: body is %d bytes, over the limit", tc.payload, len(body))
		}
		record := decrypt(t, receiver, auth, body)
		if len(record) != tc.record || !bytes.Equal(unpad(t, record), payload) {
			t.Errorf("%d bytes: record is %d bytes or does not hold the payload", tc.payload, len(record))
		}
	}
}

func TestEncryptRefusesOversizedPayload(t *testing.T) {
	receiver, auth := newReceiver(t)
	if MaxPayloadBytes != 2559 {
		t.Fatalf("MaxPayloadBytes = %d, want 2559", MaxPayloadBytes)
	}
	_, err := encrypt(make([]byte, MaxPayloadBytes+1), receiver.PublicKey().Bytes(), auth)
	if !errors.Is(err, ErrPayloadTooLarge) {
		t.Fatalf("err = %v, want ErrPayloadTooLarge", err)
	}
}

func TestEncryptRefusesBadKeys(t *testing.T) {
	receiver, auth := newReceiver(t)
	point := receiver.PublicKey().Bytes()
	offCurve := bytes.Clone(point)
	offCurve[len(offCurve)-1] ^= 1
	cases := map[string]struct{ p256dh, auth []byte }{
		"short auth":      {point, auth[:15]},
		"no auth":         {point, nil},
		"short point":     {point[:64], auth},
		"point off curve": {offCurve, auth},
		"no point":        {nil, auth},
	}
	for name, tc := range cases {
		if _, err := encrypt([]byte("hi"), tc.p256dh, tc.auth); !errors.Is(err, ErrBadSubscription) {
			t.Errorf("%s: err = %v, want ErrBadSubscription", name, err)
		}
	}
}
