package auth

import (
	"context"
	"testing"

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
