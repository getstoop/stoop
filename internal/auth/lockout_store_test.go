package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/alexedwards/argon2id"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/kv"
)

// flakyStore fails the operations the test names and passes the rest to
// a healthy store.
type flakyStore struct {
	kv.Store[loginEntry]
	failGet, failUpdate, failDelete bool
	err                             error
}

func (s *flakyStore) Get(ctx context.Context, key string) (loginEntry, bool, error) {
	if s.failGet {
		return loginEntry{}, false, s.err
	}
	return s.Store.Get(ctx, key)
}

func (s *flakyStore) Update(ctx context.Context, key string, change func(loginEntry, bool) (loginEntry, time.Duration, bool)) error {
	if s.failUpdate {
		return s.err
	}
	return s.Store.Update(ctx, key, change)
}

func (s *flakyStore) Delete(ctx context.Context, key string) error {
	if s.failDelete {
		return s.err
	}
	return s.Store.Delete(ctx, key)
}

// A sign-in the guard cannot account for is refused, whichever call
// failed, and never reaches the point of minting a session.
func TestLoginRefusesWhenGuardStoreFails(t *testing.T) {
	pool := dbtest.New(t)
	svc := New(pool, Options{Argon2Params: &argon2id.Params{
		Memory: 8 * 1024, Iterations: 1, Parallelism: 1, SaltLength: 16, KeyLength: 32,
	}})
	ctx := context.Background()
	const password = "correct horse battery"
	if _, err := svc.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{Username: "ada", Password: password})); err != nil {
		t.Fatal(err)
	}
	sessions := func() int {
		t.Helper()
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM credentials WHERE kind = 'session'`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count
	}
	before := sessions()
	healthy := svc.guard.entries
	cases := []struct {
		name     string
		store    *flakyStore
		password string
	}{
		{"the check fails", &flakyStore{failGet: true}, password},
		{"recording a failure fails", &flakyStore{failUpdate: true}, "wrong"},
		{"clearing on success fails", &flakyStore{failDelete: true}, password},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			testCase.store.Store, testCase.store.err = healthy, errors.New("store down")
			svc.guard.entries = testCase.store
			defer func() { svc.guard.entries = healthy }()
			res, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: "ada", Password: testCase.password}))
			var connectErr *connect.Error
			if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeUnavailable {
				t.Fatalf("err = %v, want Unavailable", err)
			}
			if res != nil {
				t.Fatal("a refused sign-in returned a response")
			}
			if sessions() != before {
				t.Fatal("a refused sign-in minted a session")
			}
		})
	}
	// With the store back, the same password signs in.
	if _, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: "ada", Password: password})); err != nil {
		t.Fatalf("healthy store: %v", err)
	}
}
