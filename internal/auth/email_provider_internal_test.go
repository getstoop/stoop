package auth

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/alexedwards/argon2id"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

func TestProviderSignUpTakesAVerifiedAddress(t *testing.T) {
	ctx := context.Background()
	svc := New(dbtest.New(t), Options{Argon2Params: &argon2id.Params{Memory: 8 * 1024, Iterations: 1, Parallelism: 1, SaltLength: 16, KeyLength: 32}})
	signUp := func(subject, address string, verified bool) *string {
		t.Helper()
		res, ferr := svc.registerSocial(ctx, "pocket-id", Claims{
			Subject: subject, Email: address, EmailVerified: verified, PreferredUsername: subject,
		}, loginState{})
		if ferr != nil {
			t.Fatalf("sign up %s: %v", subject, ferr.code)
		}
		user, err := svc.q.GetUserByID(ctx, res.userID)
		if err != nil {
			t.Fatal(err)
		}
		if (user.Email == nil) != (user.EmailConfirmedAt == nil) {
			t.Errorf("%s: email %v confirmed at %v", subject, user.Email, user.EmailConfirmedAt)
		}
		return user.Email
	}
	if got := signUp("casey", "casey@example.com", true); got == nil || *got != "casey@example.com" {
		t.Errorf("verified: %v", got)
	}
	if got := signUp("ada", "ada@example.com", false); got != nil {
		t.Errorf("unverified: %v", *got)
	}
	if got := signUp("bea", "Casey@example.com", true); got != nil {
		t.Errorf("taken: %v", *got)
	}
}

func TestClaimBool(t *testing.T) {
	for raw, want := range map[string]bool{
		`{"v":true}`: true, `{"v":"true"}`: true, `{"v":false}`: false, `{"v":"false"}`: false, `{}`: false, `{"v":1}`: false,
	} {
		var claims struct {
			V claimBool `json:"v"`
		}
		if err := json.Unmarshal([]byte(raw), &claims); err != nil || bool(claims.V) != want {
			t.Errorf("%s: %v %v", raw, claims.V, err)
		}
	}
}
