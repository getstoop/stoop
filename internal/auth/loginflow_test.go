package auth_test

import (
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

	authv1 "github.com/Jhut89/stoop/gen/stoop/auth/v1"
	"github.com/Jhut89/stoop/internal/auth"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/db/dbtest"
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
		if req.URL.Host == appHost && !strings.HasPrefix(req.URL.Path, "/auth/") {
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
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
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
