package push

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"sync"
	"testing"

	"connectrpc.com/connect"

	pushv1 "github.com/getstoop/stoop/gen/stoop/push/v1"
	"github.com/getstoop/stoop/internal/apierr/apierrtest"
)

// The signing key is made once and every server sharing the database
// hands out the same one, even when several make it at the same moment.
func TestSigningKeyIsMadeOnceAndShared(t *testing.T) {
	fix := setup(t)
	ctx, _ := fix.session(t)

	const racers = 8
	keys := make([][]byte, racers)
	var wg sync.WaitGroup
	for i := range racers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// A Service each, as separate processes would have.
			got, err := New(fix.pool).GetPushConfig(ctx, connect.NewRequest(&pushv1.GetPushConfigRequest{}))
			if err != nil {
				t.Errorf("GetPushConfig: %v", err)
				return
			}
			if !got.Msg.Enabled {
				t.Error("enabled = false")
			}
			keys[i] = got.Msg.ApplicationServerKey
		}()
	}
	wg.Wait()
	if _, err := ecdh.P256().NewPublicKey(keys[0]); err != nil || len(keys[0]) != 65 {
		t.Fatalf("key %x is not an uncompressed P-256 point: %v", keys[0], err)
	}
	for i, key := range keys {
		if !bytes.Equal(key, keys[0]) {
			t.Errorf("racer %d got a different key", i)
		}
	}
	var rows int
	if err := fix.pool.QueryRow(context.Background(), `SELECT count(*) FROM push_keys`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Errorf("%d key rows, want 1", rows)
	}
}

func TestStoredKeyMustHold(t *testing.T) {
	private, public, err := newSigningKey()
	if err != nil {
		t.Fatal(err)
	}
	if err := checkSigningKey(private, public); err != nil {
		t.Fatalf("a fresh pair: %v", err)
	}
	_, other, err := newSigningKey()
	if err != nil {
		t.Fatal(err)
	}
	if err := checkSigningKey(private, other); err == nil {
		t.Error("a mismatched public key was accepted")
	}
	if err := checkSigningKey([]byte("not a key"), public); err == nil {
		t.Error("an unreadable private key was accepted")
	}
}

func TestPushConfigNeedsASession(t *testing.T) {
	fix := setup(t)
	_, err := fix.svc.GetPushConfig(fix.token(), connect.NewRequest(&pushv1.GetPushConfigRequest{}))
	apierrtest.ExpectCode(t, err, connect.CodePermissionDenied, "GetPushConfig with a token")
	_, err = fix.svc.GetPushConfig(context.Background(), connect.NewRequest(&pushv1.GetPushConfigRequest{}))
	apierrtest.ExpectCode(t, err, connect.CodeUnauthenticated, "GetPushConfig signed out")
}
