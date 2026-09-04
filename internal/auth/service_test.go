package auth_test

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"connectrpc.com/connect"
	"github.com/alexedwards/argon2id"

	authv1 "github.com/Jhut89/stoop/gen/stoop/auth/v1"
	"github.com/Jhut89/stoop/internal/auth"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/db/dbtest"
)

// Cheap hashing so the race test's concurrency isn't dominated by argon2.
var testArgon2 = &argon2id.Params{Memory: 8 * 1024, Iterations: 1, Parallelism: 1, SaltLength: 16, KeyLength: 32}

func TestRegisterFirstUserBecomesAdmin(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx := context.Background()

	// Race N registrations on an empty instance: exactly one may win admin.
	const n = 8
	var wg sync.WaitGroup
	users := make(chan *authv1.User, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := svc.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{
				Username: fmt.Sprintf("user%d", i), Password: "correct horse battery",
			}))
			if err != nil {
				t.Errorf("register user%d: %v", i, err)
				return
			}
			users <- res.Msg.User
		}()
	}
	wg.Wait()
	close(users)

	admins, members := 0, 0
	for u := range users {
		switch u.Role {
		case authv1.InstanceRole_INSTANCE_ROLE_ADMIN:
			admins++
		case authv1.InstanceRole_INSTANCE_ROLE_MEMBER:
			members++
		default:
			t.Errorf("user %s has unexpected role %v", u.Username, u.Role)
		}
	}
	if admins != 1 || members != n-1 {
		t.Fatalf("got %d admins and %d members, want 1 and %d", admins, members, n-1)
	}

	// A later registration is a plain member.
	res, err := svc.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{
		Username: "latecomer", Password: "correct horse battery",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.User.Role != authv1.InstanceRole_INSTANCE_ROLE_MEMBER {
		t.Errorf("latecomer role = %v, want member", res.Msg.User.Role)
	}
}

func TestIdentityCarriesRole(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx := context.Background()

	for i, want := range []authctx.Role{authctx.RoleAdmin, authctx.RoleMember} {
		name := fmt.Sprintf("person%d", i)
		if _, err := svc.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{
			Username: name, Password: "correct horse battery",
		})); err != nil {
			t.Fatal(err)
		}
		login, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{
			Username: name, Password: "correct horse battery",
		}))
		if err != nil {
			t.Fatal(err)
		}
		id, err := svc.VerifyToken(ctx, login.Msg.Token)
		if err != nil {
			t.Fatal(err)
		}
		if id.Role != want {
			t.Errorf("%s: identity role = %q, want %q", name, id.Role, want)
		}
		if got := authctx.IsAdmin(authctx.WithIdentity(ctx, id)); got != (want == authctx.RoleAdmin) {
			t.Errorf("%s: IsAdmin = %v", name, got)
		}
		me, err := svc.GetMe(authctx.WithIdentity(ctx, id), connect.NewRequest(&authv1.GetMeRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		if (me.Msg.User.Role == authv1.InstanceRole_INSTANCE_ROLE_ADMIN) != (want == authctx.RoleAdmin) {
			t.Errorf("%s: GetMe role = %v, want %q", name, me.Msg.User.Role, want)
		}
	}
}

func TestLoginLockoutAndUnknownUserParity(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx := context.Background()
	if _, err := svc.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{
		Username: "ada", Password: "correct horse battery",
	})); err != nil {
		t.Fatal(err)
	}
	login := func(user, pass string) error {
		_, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: user, Password: pass}))
		return err
	}
	wantCode := func(err error, code connect.Code) {
		t.Helper()
		if connect.CodeOf(err) != code {
			t.Fatalf("err = %v, want code %v", err, code)
		}
	}

	// Unknown and known users fail identically.
	wantCode(login("nobody", "whatever"), connect.CodeUnauthenticated)
	wantCode(login("ada", "wrong"), connect.CodeUnauthenticated)

	// Five consecutive failures lock the handle, case-insensitively, and
	// the right password is refused until the lock lifts.
	for range 4 {
		wantCode(login("Ada", "wrong"), connect.CodeUnauthenticated)
	}
	wantCode(login("ada", "correct horse battery"), connect.CodeResourceExhausted)

	// Unknown handles lock out the same way, so the lockout itself can't
	// be used to tell real accounts from fake ones.
	for range 4 {
		wantCode(login("nobody", "whatever"), connect.CodeUnauthenticated)
	}
	wantCode(login("nobody", "whatever"), connect.CodeResourceExhausted)

	// A different account is unaffected, and a success clears its slate.
	if _, err := svc.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{
		Username: "foobar", Password: "correct horse battery",
	})); err != nil {
		t.Fatal(err)
	}
	wantCode(login("foobar", "wrong"), connect.CodeUnauthenticated)
	if err := login("foobar", "correct horse battery"); err != nil {
		t.Fatalf("foobar login: %v", err)
	}
}
