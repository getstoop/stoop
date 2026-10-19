package auth_test

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"testing"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

// reauthAccount is a provider account (identity "sub-<name>" on sso) with
// a session older than counts as recent, as someone coming back to their
// settings has.
func reauthAccount(t *testing.T, svc *auth.Service, pool *pgxpool.Pool, name string) string {
	t.Helper()
	_, userID := socialUser(t, svc, pool, name, "sso")
	token, err := svc.SessionFor(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	ageSession(t, pool, asSession(t, svc, token))
	return token
}

// browserWith is a browser holding a session cookie.
func browserWith(t *testing.T, rig *socialRig, token string) *http.Client {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	if token != "" {
		u, _ := url.Parse(rig.app.URL)
		jar.SetCookies(u, []*http.Cookie{{Name: auth.SessionCookieName, Value: token}})
	}
	return &http.Client{Jar: jar}
}

// isRecent reports whether a session counts as a recent sign-in, by trying
// a change that needs one.
func isRecent(t *testing.T, svc *auth.Service, token string) bool {
	t.Helper()
	_, err := svc.ChangePassword(asSession(t, svc, token),
		connect.NewRequest(&authv1.ChangePasswordRequest{NewPassword: "a brand new password"}))
	return err == nil
}

func TestProviderReauth(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	rig := newSocialRig(t, svc)
	old := reauthAccount(t, svc, pool, "sasha")
	browser := browserWith(t, rig, old)
	rig.idp.sub = "sub-sasha"

	if loc := rig.run(t, browser, "/auth/oidc/sso/start?reauth=1&redirect=/profile"); loc != "/profile" {
		t.Fatalf("reauth landed on %q", loc)
	}
	if q := rig.idp.authorize; q.Get("prompt") != "login" || q.Get("max_age") != "0" {
		t.Errorf("the provider wasn't asked for a fresh sign-in: %v", q)
	}
	fresh := rig.sessionToken(t, browser)
	if fresh == "" || fresh == old {
		t.Fatal("the session wasn't replaced")
	}
	if _, err := svc.VerifyToken(context.Background(), old); err == nil {
		t.Error("the replaced session still works")
	}
	if !isRecent(t, svc, fresh) {
		t.Error("the new session isn't a recent sign-in")
	}
}

// Whatever goes wrong, the person lands back on the confirm page with the
// same generic code, and nothing changes: no session is replaced, no
// account is made, no other account is signed in to.
func TestProviderReauthRefusals(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	svc.UseRegistrationPorts(&fakePolicy{policy: auth.PolicyOpen}, nil)
	rig := newSocialRig(t, svc)
	old := reauthAccount(t, svc, pool, "sasha")
	reauthAccount(t, svc, pool, "quinn")
	const refused = "/confirm?error=reauth_failed&next=%2Fprofile"

	for name, sub := range map[string]string{
		"someone else's identity": "sub-quinn",
		"no one's identity":       "sub-nobody",
	} {
		rig.idp.sub = sub
		browser := browserWith(t, rig, old)
		if loc := rig.run(t, browser, "/auth/oidc/sso/start?reauth=1&redirect=/profile"); loc != refused {
			t.Errorf("%s: landed on %q", name, loc)
		}
		if got := rig.sessionToken(t, browser); got != old {
			t.Errorf("%s: the browser's session changed", name)
		}
	}
	if _, err := svc.VerifyToken(context.Background(), old); err != nil {
		t.Errorf("a refused reauth ended the session: %v", err)
	}
	var users int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM users`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 2 {
		t.Errorf("users = %d: a reauth registered an account", users)
	}

	// No session to confirm: refused before the provider is asked.
	rig.idp.sub = "sub-sasha"
	if loc := rig.run(t, browserWith(t, rig, ""), "/auth/oidc/sso/start?reauth=1&redirect=/profile"); loc != refused {
		t.Errorf("no session: landed on %q", loc)
	}
	// Somewhere off the site: back to the profile instead.
	if loc := rig.run(t, browserWith(t, rig, old), "/auth/oidc/sso/start?reauth=1&redirect=//elsewhere.example"); loc != "/profile" {
		t.Errorf("an off-site next: landed on %q", loc)
	}
}

func TestDesktopReauth(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	rig := newSocialRig(t, svc)
	old := reauthAccount(t, svc, pool, "sasha")
	other := reauthAccount(t, svc, pool, "quinn")
	rig.idp.sub = "sub-sasha"
	const verifier = "desktop-verifier-0123456789abcdefghijklmnop"

	start := func(token string) string {
		t.Helper()
		status, body := rig.postAs(t, token, "/auth/desktop/start", map[string]any{
			"provider": "sso", "attemptChallenge": s256(verifier),
			"attemptMethod": "S256", "reauth": true,
		})
		id, _ := body["attempt"].(string)
		if status != http.StatusOK || id == "" {
			t.Fatalf("desktop/start = %d, %v", status, body)
		}
		return id
	}

	// A reauth attempt is a reauth attempt: a start URL that says link
	// is refused, back to the app's confirm page.
	if back := handBack(t, rig.run(t, &http.Client{}, "/auth/oidc/sso/start?link=1&attempt="+start(old))); back.Get("error") != "login_state" || back.Get("reauth") != "1" {
		t.Errorf("a reauth attempt started as a link handed back %v", back)
	}

	// The browser leg confirms nothing and gets no session.
	browser := &http.Client{}
	back := handBack(t, rig.run(t, browser, "/auth/oidc/sso/start?reauth=1&attempt="+start(old)))
	if back.Get("reauth") != "1" || back.Get("code") == "" {
		t.Fatalf("hand-back = %v", back)
	}
	if tok := rig.sessionToken(t, browser); tok != "" {
		t.Error("the system browser was signed in by a reauth hand-off")
	}

	// Redeemed from another session: refused, and the code is spent.
	code := back.Get("code")
	if status, body := rig.postAs(t, other, "/auth/desktop/complete", map[string]any{
		"code": code, "attemptVerifier": verifier,
	}); status != http.StatusUnauthorized || body["error"] != "reauth_failed" {
		t.Errorf("another session redeemed it: %d, %v", status, body)
	}
	if status, body := rig.postAs(t, old, "/auth/desktop/complete", map[string]any{
		"code": code, "attemptVerifier": verifier,
	}); status != http.StatusUnauthorized || body["error"] != "code_invalid" {
		t.Errorf("the refused code redeemed afterwards from the right session: %d, %v", status, body)
	}

	// From the view that started it: the session is replaced.
	back = handBack(t, rig.run(t, &http.Client{}, "/auth/oidc/sso/start?reauth=1&attempt="+start(old)))
	status, body := rig.postAs(t, old, "/auth/desktop/complete", map[string]any{
		"code": back.Get("code"), "attemptVerifier": verifier,
	})
	fresh, _ := body["token"].(string)
	if status != http.StatusOK || fresh == "" {
		t.Fatalf("complete = %d, %v", status, body)
	}
	if _, err := svc.VerifyToken(context.Background(), old); err == nil {
		t.Error("the replaced session still works")
	}
	if !isRecent(t, svc, fresh) {
		t.Error("the new session isn't a recent sign-in")
	}
}
