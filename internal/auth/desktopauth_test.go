package auth

import (
	"context"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/kv"
)

func TestDesktopStoreBounded(t *testing.T) {
	ctx := context.Background()
	store := newDesktopStore(kv.NewMemory(nil))
	for range desktopStoreCap + 10 {
		if _, err := store.begin(ctx, desktopAttempt{provider: "oidc"}); err != nil {
			t.Fatal(err)
		}
	}
	count, err := store.attempts.Len(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if count > desktopStoreCap {
		t.Fatalf("attempts = %d, exceeds cap %d", count, desktopStoreCap)
	}
}

func TestDesktopStoreClaimOnce(t *testing.T) {
	ctx := context.Background()
	store := newDesktopStore(kv.NewMemory(nil))
	id, err := store.begin(ctx, desktopAttempt{provider: "oidc"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := store.claim(ctx, id, "other"); ok {
		t.Fatal("a claim for another provider must fail")
	}
	if _, ok, _ := store.claim(ctx, id, "oidc"); !ok {
		t.Fatal("the first claim should succeed")
	}
	if _, ok, _ := store.claim(ctx, id, "oidc"); ok {
		t.Fatal("a second claim is a replay")
	}
	if _, ok, _ := store.mint(ctx, id, "oidc", desktopCode{userID: "u1"}); !ok {
		t.Fatal("a claimed attempt still mints a code")
	}
	if _, ok, _ := store.mint(ctx, id, "oidc", desktopCode{userID: "u1"}); ok {
		t.Fatal("minting consumes the attempt")
	}
}

// clockedDesktopStore is a store whose clock the test moves.
func clockedDesktopStore() (*desktopStore, *time.Time) {
	at := time.Unix(1_700_000_000, 0)
	return newDesktopStore(kv.NewMemory(func() time.Time { return at })), &at
}

func TestDesktopAttemptExpiresFromItsStart(t *testing.T) {
	ctx := context.Background()
	store, now := clockedDesktopStore()
	id, err := store.begin(ctx, desktopAttempt{provider: "oidc"})
	if err != nil {
		t.Fatal(err)
	}
	// A claim near the end of the attempt's life does not extend it.
	*now = now.Add(desktopAttemptTTL - time.Minute)
	if _, ok, _ := store.claim(ctx, id, "oidc"); !ok {
		t.Fatal("the attempt is still live")
	}
	*now = now.Add(2 * time.Minute)
	if _, ok, _ := store.mint(ctx, id, "oidc", desktopCode{userID: "u1"}); ok {
		t.Fatal("an attempt must expire at its start plus the ttl, claimed or not")
	}
}

func TestDesktopLinkCodeExpiresFromItsMint(t *testing.T) {
	ctx := context.Background()
	store, now := clockedDesktopStore()
	const verifier = "desktop-verifier-0123456789abcdefghijklmnop"
	id, err := store.begin(ctx, desktopAttempt{
		provider: "oidc", challenge: verifier, method: desktopMethodPlain, linkUserID: "u1", sessionID: "s1",
	})
	if err != nil {
		t.Fatal(err)
	}
	code, ok, err := store.mint(ctx, id, "oidc", desktopCode{})
	if err != nil || !ok {
		t.Fatalf("mint: %v, %v", ok, err)
	}
	// A link's preview leaves the code for the confirming call, and does
	// not extend it.
	*now = now.Add(desktopCodeTTL - 5*time.Second)
	if _, ok, _ := store.redeem(ctx, code, verifier, false); !ok {
		t.Fatal("the preview should find the code")
	}
	*now = now.Add(10 * time.Second)
	if _, ok, _ := store.redeem(ctx, code, verifier, true); ok {
		t.Fatal("a previewed code must still expire at its mint plus the ttl")
	}
}
