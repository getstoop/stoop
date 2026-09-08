package auth_test

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"context"

	"connectrpc.com/connect"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

// fakeIdP is a minimal OIDC issuer: discovery, JWKS, authorize (redirects
// straight back with a code), token (signs a real RS256 ID token), and
// userinfo. Just enough for go-oidc to accept it.
type fakeIdP struct {
	srv      *httptest.Server
	key      *rsa.PrivateKey
	clientID string

	// What the last /authorize saw, echoed into the token.
	nonce, challenge, redirectURI string
	// Claims for the next sign-in.
	sub    string
	claims map[string]any
	// forceNonce, when set, is issued instead of the real one.
	forceNonce string
}

func newFakeIdP(t *testing.T, clientID string) *fakeIdP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeIdP{key: key, clientID: clientID, sub: "sub-1", claims: map[string]any{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                f.srv.URL,
			"authorization_endpoint":                f.srv.URL + "/authorize",
			"token_endpoint":                        f.srv.URL + "/token",
			"jwks_uri":                              f.srv.URL + "/jwks",
			"userinfo_endpoint":                     f.srv.URL + "/userinfo",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		pub := f.key.Public().(*rsa.PublicKey)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]any{{
				"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "k1",
				"n": base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
				"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
			}},
		})
	})
	mux.HandleFunc("/authorize", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		f.nonce, f.challenge, f.redirectURI = q.Get("nonce"), q.Get("code_challenge"), q.Get("redirect_uri")
		u, _ := url.Parse(q.Get("redirect_uri"))
		v := url.Values{"code": {"code-1"}, "state": {q.Get("state")}}
		u.RawQuery = v.Encode()
		http.Redirect(w, r, u.String(), http.StatusFound)
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
		if base64.RawURLEncoding.EncodeToString(sum[:]) != f.challenge {
			http.Error(w, "bad pkce verifier", http.StatusBadRequest)
			return
		}
		if r.Form.Get("code") != "code-1" {
			http.Error(w, "bad code", http.StatusBadRequest)
			return
		}
		nonce := f.nonce
		if f.forceNonce != "" {
			nonce = f.forceNonce
		}
		claims := map[string]any{
			"iss": f.srv.URL, "sub": f.sub, "aud": f.clientID,
			"exp": 4102444800, "iat": 946684800, "nonce": nonce,
		}
		for k, v := range f.claims {
			claims[k] = v
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "at-1", "token_type": "Bearer",
			"id_token": f.signJWT(claims),
		})
	})
	mux.HandleFunc("/userinfo", func(w http.ResponseWriter, _ *http.Request) {
		out := map[string]any{"sub": f.sub}
		for k, v := range f.claims {
			out[k] = v
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeIdP) signJWT(claims map[string]any) string {
	b64 := func(v any) string {
		raw, _ := json.Marshal(v)
		return base64.RawURLEncoding.EncodeToString(raw)
	}
	signing := b64(map[string]string{"alg": "RS256", "typ": "JWT", "kid": "k1"}) + "." + b64(claims)
	sum := sha256.Sum256([]byte(signing))
	sig, _ := rsa.SignPKCS1v15(rand.Reader, f.key, crypto.SHA256, sum[:])
	return signing + "." + base64.RawURLEncoding.EncodeToString(sig)
}

// fakeProviders backs auth.ProviderSource for tests.
type fakeProviders struct {
	cfgs     map[string]auth.ProviderConfig
	callback string // the app test server's base URL
}

func (f *fakeProviders) LoginProvider(_ context.Context, id string) (auth.ProviderConfig, error) {
	cfg, ok := f.cfgs[id]
	if !ok {
		return auth.ProviderConfig{}, connect.NewError(connect.CodeNotFound, errors.New("no such provider"))
	}
	return cfg, nil
}

func (f *fakeProviders) CallbackURL(_ context.Context, id string) (string, error) {
	if f.callback == "" {
		return "", nil
	}
	return f.callback + "/auth/callback/" + id, nil
}

// social spins up the whole rig: a fake IdP, the auth service, and its
// LoginHandler on a test server.
type socialRig struct {
	svc *auth.Service
	idp *fakeIdP
	app *httptest.Server
}

func newSocialRig(t *testing.T, svc *auth.Service) *socialRig {
	t.Helper()
	idp := newFakeIdP(t, "client-1")
	app := httptest.NewServer(svc.LoginHandler())
	t.Cleanup(app.Close)
	svc.UseProviders(&fakeProviders{
		callback: app.URL,
		cfgs: map[string]auth.ProviderConfig{
			"sso": {ID: "sso", Kind: auth.KindOIDC, DisplayName: "SSO",
				Issuer: idp.srv.URL, ClientID: "client-1", ClientSecret: "secret-1"},
		},
	})
	return &socialRig{svc: svc, idp: idp, app: app}
}

// run drives the browser side: start → IdP → callback, stopping at the
// app's final redirect. Returns the final path and the client (its jar
// holds any session cookie).
func (rig *socialRig) run(t *testing.T, client *http.Client, startPath string) string {
	t.Helper()
	if client.Jar == nil {
		jar, _ := cookiejar.New(nil)
		client.Jar = jar
	}
	appHost := strings.TrimPrefix(rig.app.URL, "http://")
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) > 10 {
			return errors.New("too many redirects")
		}
		// Client routes end the flow: the app's own pages, and the desktop
		// return page, which lives under /auth/ but is served by the web app.
		if req.URL.Host == appHost &&
			(!strings.HasPrefix(req.URL.Path, "/auth/") || req.URL.Path == desktopReturnPath) {
			return http.ErrUseLastResponse
		}
		return nil
	}
	resp, err := client.Get(rig.app.URL + startPath)
	if err != nil {
		t.Fatalf("flow: %v", err)
	}
	defer resp.Body.Close() //nolint:errcheck // test teardown
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("flow ended with status %d, want 302", resp.StatusCode)
	}
	return resp.Header.Get("Location")
}

const desktopReturnPath = "/auth/desktop/return"

// handBack reads what the browser was sent back to the app with: the
// query of the desktop return page.
func handBack(t *testing.T, location string) url.Values {
	t.Helper()
	u, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	if u.Path != desktopReturnPath {
		t.Fatalf("flow ended on %q, want the desktop return page", location)
	}
	return u.Query()
}

// postJSON posts to one of the desktop routes and decodes what comes
// back.
func (rig *socialRig) postJSON(t *testing.T, path string, body any) (int, map[string]any) {
	t.Helper()
	return rig.postAs(t, "", path, body)
}

// postAs is postJSON with a session cookie, as the app's own fetch has.
func (rig *socialRig) postAs(t *testing.T, token, path string, body any) (int, map[string]any) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, rig.app.URL+path, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post %s: %v", path, err)
	}
	defer resp.Body.Close() //nolint:errcheck // test teardown
	out := map[string]any{}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
	return resp.StatusCode, out
}

// attempt opens a desktop sign-in attempt and returns its id.
func (rig *socialRig) attempt(t *testing.T, challenge, method string) string {
	t.Helper()
	status, body := rig.postJSON(t, "/auth/desktop/start", map[string]any{
		"provider": "sso", "attemptChallenge": challenge, "attemptMethod": method,
	})
	if status != http.StatusOK {
		t.Fatalf("desktop/start = %d, %v", status, body)
	}
	id, _ := body["attempt"].(string)
	if id == "" {
		t.Fatalf("desktop/start returned no attempt: %v", body)
	}
	return id
}

// preview is the link completion that names the identity and attaches
// nothing; confirm is the one that attaches it.
func (rig *socialRig) preview(t *testing.T, token, code, verifier string) (int, map[string]any) {
	t.Helper()
	return rig.postAs(t, token, "/auth/desktop/complete", map[string]any{
		"code": code, "attemptVerifier": verifier,
	})
}

func (rig *socialRig) confirm(t *testing.T, token, code, verifier string) (int, map[string]any) {
	t.Helper()
	return rig.postAs(t, token, "/auth/desktop/complete", map[string]any{
		"code": code, "attemptVerifier": verifier, "confirm": true,
	})
}

// linkAttempt opens a link attempt as the holder of token.
func (rig *socialRig) linkAttempt(t *testing.T, token, challenge string) (int, string) {
	t.Helper()
	status, body := rig.postAs(t, token, "/auth/desktop/start", map[string]any{
		"provider": "sso", "attemptChallenge": challenge,
		"attemptMethod": "S256", "link": true,
	})
	id, _ := body["attempt"].(string)
	return status, id
}

func s256(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func (rig *socialRig) sessionToken(t *testing.T, client *http.Client) string {
	t.Helper()
	u, _ := url.Parse(rig.app.URL)
	for _, c := range client.Jar.Cookies(u) {
		if c.Name == auth.SessionCookieName {
			return c.Value
		}
	}
	return ""
}

func TestSocialRegisterThenLogin(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	svc.UseRegistrationPorts(&fakePolicy{policy: auth.PolicyOpen}, nil)
	rig := newSocialRig(t, svc)
	rig.idp.claims = map[string]any{
		"preferred_username": "Sasha.Lee", "email": "sasha@example.com",
		"name": "Sasha Lee",
	}

	// First visit: an account is created.
	c1 := &http.Client{}
	if loc := rig.run(t, c1, "/auth/oidc/sso/start"); loc != "/?welcome=1" {
		t.Fatalf("register landed on %q", loc)
	}
	tok := rig.sessionToken(t, c1)
	if tok == "" {
		t.Fatal("no session cookie after provider registration")
	}
	ident, err := svc.VerifyToken(context.Background(), tok)
	if err != nil {
		t.Fatal(err)
	}
	ctx := authctx.WithIdentity(context.Background(), ident)
	me, err := svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	u := me.Msg.User
	if u.Username != "sasha_lee" || !u.UsernamePending || u.HasPassword || u.DisplayName != "Sasha Lee" {
		t.Errorf("provider-created user = %+v", u)
	}
	ids, _ := svc.ListIdentities(ctx, connect.NewRequest(&authv1.ListIdentitiesRequest{}))
	if len(ids.Msg.Identities) != 1 || ids.Msg.Identities[0].Provider != "sso" || ids.Msg.Identities[0].Email != "sasha@example.com" {
		t.Errorf("identities = %v", ids.Msg.Identities)
	}

	// Same subject again: a login, honouring the redirect.
	c2 := &http.Client{}
	if loc := rig.run(t, c2, "/auth/oidc/sso/start?redirect=%2Factivity"); loc != "/activity" {
		t.Errorf("second sign-in landed on %q", loc)
	}
	ident2, err := svc.VerifyToken(context.Background(), rig.sessionToken(t, c2))
	if err != nil || ident2.UserID != ident.UserID {
		t.Errorf("second sign-in user = %+v, %v", ident2, err)
	}

	// An email-shaped preferred_username (Microsoft's UPN) contributes
	// only its local part.
	rig.idp.sub, rig.idp.claims = "sub-upn", map[string]any{
		"preferred_username": "Robin.Q@contoso.com", "name": "Robin Q",
	}
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start"); loc != "/?welcome=1" {
		t.Fatalf("UPN registration landed on %q", loc)
	}
	if _, err := svc.Login(context.Background(), connect.NewRequest(&authv1.LoginRequest{Username: "robin_q", Password: "x"})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("expected robin_q to exist (passwordless): %v", err)
	}

	// A username collision picks the next free handle.
	rig.idp.sub, rig.idp.claims = "sub-2", map[string]any{"preferred_username": "sasha_lee"}
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start"); loc != "/?welcome=1" {
		t.Fatalf("collision registration landed on %q", loc)
	}
	if _, err := svc.Login(context.Background(), connect.NewRequest(&authv1.LoginRequest{Username: "sasha_lee2", Password: "x"})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("expected sasha_lee2 to exist (passwordless): %v", err)
	}
}

func TestSocialRegistrationPolicy(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	policy := &fakePolicy{policy: auth.PolicyInvite}
	invites := &fakeInvites{code: "GOODCODE12", uses: 1}
	svc.UseRegistrationPorts(policy, invites)
	rig := newSocialRig(t, svc)

	// A fresh instance always admits the first account (bootstrap).
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start"); loc != "/?welcome=1" {
		t.Fatalf("bootstrap landed on %q", loc)
	}

	// Invite policy: no code, no account.
	rig.idp.sub = "sub-2"
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start"); loc != "/login?error=invite_required" {
		t.Errorf("invite-less registration landed on %q", loc)
	}
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start?invite=WRONG"); loc != "/login?error=invite_invalid" {
		t.Errorf("bad invite landed on %q", loc)
	}

	// With the code: registered, redeemed, and dropped into the space.
	c := &http.Client{}
	if loc := rig.run(t, c, "/auth/oidc/sso/start?invite=GOODCODE12"); loc != "/s/space-1?welcome=1" {
		t.Errorf("invited registration landed on %q", loc)
	}
	if len(invites.redeemed) != 1 {
		t.Errorf("redeemed = %v", invites.redeemed)
	}

	// Code spent between validation and redemption: no account is left
	// behind, and the login page says the invite was the problem.
	invites.uses, invites.failRedeem = 1, true
	rig.idp.sub = "sub-late"
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start?invite=GOODCODE12"); loc != "/login?error=invite_invalid" {
		t.Errorf("spent-invite registration landed on %q", loc)
	}
	var users int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM users").Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 2 {
		t.Errorf("users after spent invite = %d, want 2", users)
	}
	invites.failRedeem = false
	rig.idp.sub = "sub-2"

	// Closed: sign-in still works for existing identities, nothing new.
	policy.policy = auth.PolicyClosed
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start"); loc != "/" {
		t.Errorf("existing identity under closed landed on %q", loc)
	}
	rig.idp.sub = "sub-3"
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start"); loc != "/login?error=closed" {
		t.Errorf("new identity under closed landed on %q", loc)
	}
}

func TestSocialLink(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	svc.UseRegistrationPorts(&fakePolicy{policy: auth.PolicyOpen}, nil)
	rig := newSocialRig(t, svc)

	// A password account, signed in; its session cookie goes in the jar.
	_, token := signIn(t, svc, "ada", "correct horse battery")
	jar, _ := cookiejar.New(nil)
	appURL, _ := url.Parse(rig.app.URL)
	jar.SetCookies(appURL, []*http.Cookie{{Name: auth.SessionCookieName, Value: token}})
	c := &http.Client{Jar: jar}

	if loc := rig.run(t, c, "/auth/oidc/sso/start?link=1"); loc != "/profile?linked=sso" {
		t.Fatalf("link landed on %q", loc)
	}
	ident, _ := svc.VerifyToken(context.Background(), token)
	ctx := authctx.WithIdentity(context.Background(), ident)
	ids, _ := svc.ListIdentities(ctx, connect.NewRequest(&authv1.ListIdentitiesRequest{}))
	if len(ids.Msg.Identities) != 1 {
		t.Fatalf("identities after link = %v", ids.Msg.Identities)
	}

	// Linking the same provider again: refused.
	rig.idp.sub = "sub-other"
	if loc := rig.run(t, c, "/auth/oidc/sso/start?link=1"); loc != "/profile?error=already_linked" {
		t.Errorf("second link landed on %q", loc)
	}

	// Someone else's identity can't be captured by a link.
	rig.idp.sub = "sub-1"
	c2jar, _ := cookiejar.New(nil)
	_, token2 := signIn(t, svc, "quinn", "correct horse battery")
	c2jar.SetCookies(appURL, []*http.Cookie{{Name: auth.SessionCookieName, Value: token2}})
	if loc := rig.run(t, &http.Client{Jar: c2jar}, "/auth/oidc/sso/start?link=1"); loc != "/profile?error=identity_taken" {
		t.Errorf("linking someone else's identity landed on %q", loc)
	}

	// A link started without a session never gets off the ground.
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start?link=1"); loc != "/login?error=login_state" {
		t.Errorf("link without session landed on %q", loc)
	}
}

func TestSocialFlowFailures(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	svc.UseRegistrationPorts(&fakePolicy{policy: auth.PolicyOpen}, nil)
	rig := newSocialRig(t, svc)

	// Unknown provider.
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/nope/start"); loc != "/login?error=provider_unknown" {
		t.Errorf("unknown provider landed on %q", loc)
	}

	// Callback with no state cookie.
	c := &http.Client{}
	jar, _ := cookiejar.New(nil)
	c.Jar = jar
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := c.Get(rig.app.URL + "/auth/callback/sso?state=x&code=y")
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if loc := resp.Header.Get("Location"); loc != "/login?error=login_expired" {
		t.Errorf("cookie-less callback landed on %q", loc)
	}

	// Wrong nonce in the ID token: rejected at exchange.
	rig.idp.forceNonce = "not-the-nonce"
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start"); loc != "/login?error=provider_error" {
		t.Errorf("nonce mismatch landed on %q", loc)
	}
	rig.idp.forceNonce = ""

	// A deactivated account can't sign in with its identity.
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start"); loc != "/?welcome=1" {
		t.Fatalf("setup registration landed on %q", loc)
	}
	accounts, err := svc.ListAccounts(context.Background())
	if err != nil || len(accounts) == 0 {
		t.Fatalf("list accounts: %v", err)
	}
	if _, err := svc.SetAccountActive(context.Background(), accounts[0].ID, false); err != nil {
		t.Fatal(err)
	}
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start"); loc != "/login?error=deactivated" {
		t.Errorf("deactivated sign-in landed on %q", loc)
	}
}

func TestSocialDesktopSignIn(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	svc.UseRegistrationPorts(&fakePolicy{policy: auth.PolicyOpen}, nil)
	rig := newSocialRig(t, svc)

	const verifier = "desktop-verifier-0123456789abcdefghijklmnop"
	id := rig.attempt(t, s256(verifier), "S256")

	// The browser leg ends on the return page, and signs nobody in on the
	// way: the session belongs in the app.
	c := &http.Client{}
	back := handBack(t, rig.run(t, c, "/auth/oidc/sso/start?attempt="+id))
	if tok := rig.sessionToken(t, c); tok != "" {
		t.Error("the system browser must not be signed in by a desktop hand-off")
	}
	code := back.Get("code")
	if code == "" {
		t.Fatalf("hand-back carries no code: %v", back)
	}
	// The provider rides along so the return page can offer this browser
	// as an alternative.
	if back.Get("provider") != "sso" {
		t.Errorf("hand-back names provider %q", back.Get("provider"))
	}

	// The wrong verifier redeems nothing, and spends the code.
	if status, body := rig.postJSON(t, "/auth/desktop/complete", map[string]string{
		"code": code, "attemptVerifier": strings.Repeat("x", 43),
	}); status != http.StatusUnauthorized {
		t.Fatalf("complete with a wrong verifier = %d, %v", status, body)
	}
	if status, _ := rig.postJSON(t, "/auth/desktop/complete", map[string]string{
		"code": code, "attemptVerifier": verifier,
	}); status != http.StatusUnauthorized {
		t.Error("a code survived a failed redemption")
	}

	// A second attempt, redeemed properly: a session for the account the
	// provider identified.
	id = rig.attempt(t, s256(verifier), "S256")
	code = handBack(t, rig.run(t, &http.Client{}, "/auth/oidc/sso/start?attempt="+id)).Get("code")
	status, body := rig.postJSON(t, "/auth/desktop/complete", map[string]string{
		"code": code, "attemptVerifier": verifier,
	})
	token, _ := body["token"].(string)
	if status != http.StatusOK || token == "" {
		t.Fatalf("complete = %d, %v", status, body)
	}
	// Where the app lands is the server's business, exactly as it is for a
	// browser. The account was made by the first run's callback, so this
	// one is a returning identity: home, not the welcome.
	if got, _ := body["target"].(string); got != "/" {
		t.Errorf("target after a desktop sign-in = %q", got)
	}
	if _, err := svc.VerifyToken(context.Background(), token); err != nil {
		t.Fatalf("token from the hand-back: %v", err)
	}
	// Single use.
	if status, _ := rig.postJSON(t, "/auth/desktop/complete", map[string]string{
		"code": code, "attemptVerifier": verifier,
	}); status != http.StatusUnauthorized {
		t.Error("a redeemed code worked twice")
	}

	// A page with no crypto.subtle sends the verifier as the challenge.
	id = rig.attempt(t, verifier, "plain")
	plain := handBack(t, rig.run(t, &http.Client{}, "/auth/oidc/sso/start?attempt="+id))
	if status, body := rig.postJSON(t, "/auth/desktop/complete", map[string]string{
		"code": plain.Get("code"), "attemptVerifier": verifier,
	}); status != http.StatusOK {
		t.Errorf("plain-challenge complete = %d, %v", status, body)
	}
}

func TestSocialDesktopRefusals(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	svc.UseRegistrationPorts(&fakePolicy{policy: auth.PolicyOpen}, nil)
	rig := newSocialRig(t, svc)

	// An attempt needs a challenge that could be a verifier, and a
	// provider this server has.
	if status, _ := rig.postJSON(t, "/auth/desktop/start", map[string]string{
		"provider": "sso", "attemptChallenge": "short",
	}); status != http.StatusBadRequest {
		t.Errorf("start with a short challenge = %d", status)
	}
	if status, _ := rig.postJSON(t, "/auth/desktop/start", map[string]string{
		"provider": "nope", "attemptChallenge": s256("v"),
	}); status != http.StatusNotFound {
		t.Errorf("start for an unknown provider = %d", status)
	}

	// An attempt id the server never issued.
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start?attempt=made-up"); loc != "/login?error=login_state" {
		t.Errorf("unknown attempt landed on %q", loc)
	}

	// A sign-in attempt hands the app a session, which a link must never
	// do: the start URL and the attempt have to agree on which this is.
	_, token := signIn(t, svc, "ada", "correct horse battery")
	jar, _ := cookiejar.New(nil)
	appURL, _ := url.Parse(rig.app.URL)
	jar.SetCookies(appURL, []*http.Cookie{{Name: auth.SessionCookieName, Value: token}})
	id := rig.attempt(t, s256("desktop-verifier-0123456789abcdefghijklmnop"), "S256")
	// Refused, and — the attempt being a real one — refused back into the
	// app rather than in the browser.
	back := handBack(t, rig.run(t, &http.Client{Jar: jar}, "/auth/oidc/sso/start?link=1&attempt="+id))
	if got := back.Get("error"); got != "login_state" {
		t.Errorf("link with an attempt bounced with %q", got)
	}

	// And the other way: a link attempt run as a sign-in.
	_, linkID := rig.linkAttempt(t, token, s256("desktop-verifier-0123456789abcdefghijklmnop"))
	back = handBack(t, rig.run(t, &http.Client{}, "/auth/oidc/sso/start?attempt="+linkID))
	if got := back.Get("error"); got != "login_state" {
		t.Errorf("link attempt run as a sign-in bounced with %q", got)
	}

	// A link attempt needs a session on the start request; the system
	// browser's is no use, because it is not the app's.
	if status, _ := rig.linkAttempt(t, "", s256("v")); status != http.StatusUnauthorized {
		t.Errorf("link start without a session = %d", status)
	}

	// An attempt is claimed by its first start: the id is only ever
	// visible because a browser carried it, so a second run is a replay.
	once := rig.attempt(t, s256("desktop-verifier-0123456789abcdefghijklmnop"), "S256")
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start?attempt="+once); loc == "/login?error=login_state" {
		t.Fatalf("the first start on an attempt was refused: %q", loc)
	}
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start?attempt="+once); loc != "/login?error=login_state" {
		t.Errorf("a second start on one attempt landed on %q", loc)
	}
	_, again := rig.linkAttempt(t, token, s256("desktop-verifier-0123456789abcdefghijklmnop"))
	handBack(t, rig.run(t, &http.Client{}, "/auth/oidc/sso/start?link=1&attempt="+again))
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start?link=1&attempt="+again); loc != "/login?error=login_state" {
		t.Errorf("a second start on one link attempt landed on %q", loc)
	}

	// Codes are minted at the callback only.
	if status, _ := rig.postJSON(t, "/auth/desktop/complete", map[string]string{
		"code": "made-up", "attemptVerifier": strings.Repeat("a", 43),
	}); status != http.StatusUnauthorized {
		t.Errorf("complete with an unknown code = %d", status)
	}
}

func TestSocialDesktopFailureBounce(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	svc.UseRegistrationPorts(&fakePolicy{policy: auth.PolicyInvite},
		&fakeInvites{code: "GOODCODE12", uses: 1})
	rig := newSocialRig(t, svc)

	// A fresh instance always admits the first account; spend that.
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start"); loc != "/?welcome=1" {
		t.Fatalf("bootstrap landed on %q", loc)
	}

	// From here an invite is required. The person is in their browser, so
	// the refusal has to travel back to the app rather than leave them on
	// a login form there.
	rig.idp.sub = "sub-2"
	const verifier = "desktop-verifier-0123456789abcdefghijklmnop"
	id := rig.attempt(t, s256(verifier), "S256")
	back := handBack(t, rig.run(t, &http.Client{}, "/auth/oidc/sso/start?attempt="+id))
	if back.Get("error") != "invite_required" {
		t.Errorf("bounce carried %v", back)
	}
	// A failed attempt is spent, so the same id cannot be run again.
	if loc := rig.run(t, &http.Client{}, "/auth/oidc/sso/start?attempt="+id); loc != "/login?error=login_state" {
		t.Errorf("re-using a failed attempt landed on %q", loc)
	}
}

func TestSocialDesktopLink(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	svc.UseRegistrationPorts(&fakePolicy{policy: auth.PolicyOpen}, nil)
	rig := newSocialRig(t, svc)

	const verifier = "desktop-verifier-0123456789abcdefghijklmnop"
	rig.idp.claims = map[string]any{"email": "sasha@example.com"}
	_, ada := signIn(t, svc, "ada", "correct horse battery")
	_, bea := signIn(t, svc, "bea", "correct horse battery")

	identities := func(t *testing.T, token string) []string {
		t.Helper()
		ident, err := svc.VerifyToken(context.Background(), token)
		if err != nil {
			t.Fatal(err)
		}
		ctx := authctx.WithIdentity(context.Background(), ident)
		res, err := svc.ListIdentities(ctx, connect.NewRequest(&authv1.ListIdentitiesRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		out := make([]string, len(res.Msg.Identities))
		for i, id := range res.Msg.Identities {
			out[i] = id.Provider
		}
		return out
	}

	// The browser leg carries the link intent on the attempt, so it needs
	// no session of its own — and it attaches nothing on the way.
	_, id := rig.linkAttempt(t, ada, s256(verifier))
	c := &http.Client{}
	back := handBack(t, rig.run(t, c, "/auth/oidc/sso/start?link=1&attempt="+id))
	if tok := rig.sessionToken(t, c); tok != "" {
		t.Error("the system browser must not be signed in by a link hand-off")
	}
	if back.Get("link") != "1" {
		t.Errorf("hand-back does not say it was a link: %v", back)
	}
	code := back.Get("code")
	if code == "" {
		t.Fatalf("hand-back carries no code: %v", back)
	}
	if got := identities(t, ada); len(got) != 0 {
		t.Fatalf("the callback linked %v; linking belongs at complete", got)
	}

	// The attempt id travelled in an address bar, so completing it takes
	// the session that opened it — someone else's will not do, even to
	// look.
	if status, body := rig.preview(t, bea, code, verifier); status != http.StatusUnauthorized {
		t.Fatalf("preview as another account = %d, %v", status, body)
	}

	// The preview names the identity and attaches nothing, leaving the
	// code for the confirming call.
	status, body := rig.preview(t, ada, code, verifier)
	if status != http.StatusOK || body["provider"] != "sso" || body["email"] != "sasha@example.com" {
		t.Fatalf("preview = %d, %v", status, body)
	}
	if got := identities(t, ada); len(got) != 0 {
		t.Fatalf("the preview linked %v", got)
	}

	// Confirming spends it: the identity attaches, and no session is
	// minted.
	status, body = rig.confirm(t, ada, code, verifier)
	if status != http.StatusOK || body["linked"] != "sso" {
		t.Fatalf("confirm a link = %d, %v", status, body)
	}
	if _, ok := body["token"]; ok {
		t.Error("a link handed the app a session")
	}
	if got := identities(t, ada); len(got) != 1 || got[0] != "sso" {
		t.Errorf("identities after the link = %v", got)
	}
	if status, _ := rig.preview(t, ada, code, verifier); status != http.StatusUnauthorized {
		t.Error("a confirmed code worked twice")
	}

	// The verifier is the other binding: a live session alone is not
	// enough, and a wrong one spends the code.
	_, id = rig.linkAttempt(t, ada, s256(verifier))
	code = handBack(t, rig.run(t, &http.Client{}, "/auth/oidc/sso/start?link=1&attempt="+id)).Get("code")
	if status, _ := rig.preview(t, ada, code, strings.Repeat("x", 43)); status != http.StatusUnauthorized {
		t.Error("a wrong verifier redeemed a link code")
	}
	if status, _ := rig.preview(t, ada, code, verifier); status != http.StatusUnauthorized {
		t.Error("a code survived a failed redemption")
	}

	// The same provider twice.
	rig.idp.sub = "sub-other"
	_, id = rig.linkAttempt(t, ada, s256(verifier))
	code = handBack(t, rig.run(t, &http.Client{}, "/auth/oidc/sso/start?link=1&attempt="+id)).Get("code")
	if status, body := rig.confirm(t, ada, code, verifier); status != http.StatusConflict ||
		body["error"] != "already_linked" {
		t.Errorf("linking sso twice = %d, %v", status, body)
	}

	// Someone else's identity cannot be captured this way either.
	rig.idp.sub = "sub-1"
	_, id = rig.linkAttempt(t, bea, s256(verifier))
	code = handBack(t, rig.run(t, &http.Client{}, "/auth/oidc/sso/start?link=1&attempt="+id)).Get("code")
	if status, body := rig.confirm(t, bea, code, verifier); status != http.StatusConflict ||
		body["error"] != "identity_taken" {
		t.Errorf("linking a taken identity = %d, %v", status, body)
	}
	if got := identities(t, bea); len(got) != 0 {
		t.Errorf("bea ended up with %v", got)
	}

	// A link failure in the browser bounces back to the app, and says it
	// was a link so the message lands on the profile page.
	rig.idp.forceNonce = "not-the-nonce"
	_, id = rig.linkAttempt(t, ada, s256(verifier))
	back = handBack(t, rig.run(t, &http.Client{}, "/auth/oidc/sso/start?link=1&attempt="+id))
	if back.Get("error") != "provider_error" || back.Get("link") != "1" {
		t.Errorf("a failed link bounced with %v", back)
	}
}

// The app and the browser end a sign-in in the same place, because they
// take the same answer from the server rather than each deciding.
func TestSocialDesktopTarget(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	svc.UseRegistrationPorts(&fakePolicy{policy: auth.PolicyOpen}, nil)
	rig := newSocialRig(t, svc)

	const verifier = "desktop-verifier-0123456789abcdefghijklmnop"
	target := func(t *testing.T, startQuery string) string {
		t.Helper()
		id := rig.attempt(t, s256(verifier), "S256")
		back := handBack(t, rig.run(t, &http.Client{},
			"/auth/oidc/sso/start?attempt="+id+startQuery))
		status, body := rig.postJSON(t, "/auth/desktop/complete", map[string]string{
			"code": back.Get("code"), "attemptVerifier": verifier,
		})
		if status != http.StatusOK {
			t.Fatalf("complete = %d, %v", status, body)
		}
		got, _ := body["target"].(string)
		return got
	}

	// The first sign-in registers the account, and lands where a browser
	// registration lands.
	if got := target(t, ""); got != "/?welcome=1" {
		t.Errorf("target after a desktop registration = %q, want the welcome", got)
	}

	for _, tc := range []struct{ name, start, want string }{
		{"a returning identity", "", "/"},
		{"one carrying a redirect", "&redirect=%2Factivity", "/activity"},
		// The setup card's own button carries this, and setup is finished
		// the moment the account it made exists. Landing there would bounce
		// a signed-in person onto the login form.
		{"one started from setup", "&redirect=%2Fsetup", "/"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := target(t, tc.start); got != tc.want {
				t.Errorf("target = %q, want %q", got, tc.want)
			}
		})
	}
}
