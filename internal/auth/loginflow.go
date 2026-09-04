package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"golang.org/x/oauth2"

	"github.com/Jhut89/stoop/internal/authctx"
)

// The browser side of provider sign-in: /auth/oidc/{provider}/start sends
// the person to the issuer; /auth/callback/{provider} redeems what comes
// back and ends in the same opaque session cookie as a password login.
//
// Round-trip state (state, nonce, PKCE verifier, invite code, link
// intent, redirect) rides in a short-lived HMAC-signed cookie: the cookie
// is simultaneously the browser binding that defeats login-CSRF. The key
// is per-process; a restart mid-login just means "sign-in expired".

const (
	loginCookieName = "stoop_login"
	loginStateTTL   = 10 * time.Minute
)

type loginState struct {
	V        int    `json:"v"`
	Provider string `json:"p"`
	State    string `json:"st"`
	Nonce    string `json:"n"`
	Verifier string `json:"cv"`
	Invite   string `json:"inv,omitempty"`
	// LinkUserID + SessionID: attach the identity to this signed-in
	// account instead of logging in; both are re-verified at callback.
	LinkUserID string `json:"link,omitempty"`
	SessionID  string `json:"sid,omitempty"`
	Redirect   string `json:"r,omitempty"`
	Exp        int64  `json:"exp"`
}

// LoginHandler serves the provider sign-in routes. Mounted once in
// internal/app under /auth/, behind the auth rate limiter.
func (s *Service) LoginHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /auth/oidc/{provider}/start", s.oidcStart)
	mux.HandleFunc("GET /auth/callback/{provider}", s.oidcCallback)
	return mux
}

func (s *Service) oidcStart(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("provider")
	if s.providers == nil {
		loginError(w, r, "provider_unknown")
		return
	}
	cfg, err := s.providers.LoginProvider(ctx, id)
	if err != nil {
		loginError(w, r, "provider_unknown")
		return
	}
	redirectURI, err := s.providers.CallbackURL(ctx, id)
	if err != nil || redirectURI == "" {
		slog.Warn("oidc start without a public URL", "provider", id, "err", err)
		loginError(w, r, "provider_error")
		return
	}

	st := loginState{
		V:        1,
		Provider: id,
		State:    randomToken(),
		Nonce:    randomToken(),
		Verifier: oauth2.GenerateVerifier(),
		Invite:   strings.TrimSpace(r.URL.Query().Get("invite")),
		Redirect: safeRedirectPath(r.URL.Query().Get("redirect")),
		Exp:      time.Now().Add(loginStateTTL).Unix(),
	}
	// Link intent requires a live session now; the callback checks the
	// same session again so a cookie planted on someone else can't attach
	// an attacker's identity to their account.
	if r.URL.Query().Get("link") == "1" {
		ident, err := s.VerifyToken(ctx, TokenFromHeader(r.Header))
		if err != nil {
			loginError(w, r, "login_state")
			return
		}
		st.LinkUserID, st.SessionID = ident.UserID, ident.SessionID
	}

	p, err := s.providerFor(ctx, cfg)
	if err != nil {
		slog.Warn("oidc discovery failed", "provider", id, "err", err)
		loginError(w, r, "provider_error")
		return
	}
	http.SetCookie(w, s.loginCookie(r, s.encodeLoginState(st), loginStateTTL))
	http.Redirect(w, r, p.authURL(st.State, st.Nonce, st.Verifier, redirectURI), http.StatusFound)
}

func (s *Service) oidcCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("provider")
	// The cookie is single-use: cleared on every outcome.
	http.SetCookie(w, s.loginCookie(r, "", -time.Second))

	st, err := s.readLoginState(r)
	if err != nil {
		loginError(w, r, "login_expired")
		return
	}
	if st.Provider != id || r.URL.Query().Get("state") != st.State {
		loginError(w, r, "login_state")
		return
	}
	if e := r.URL.Query().Get("error"); e != "" {
		slog.Warn("provider returned an error", "provider", id, "error", e)
		loginError(w, r, "provider_error")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" || s.providers == nil {
		loginError(w, r, "provider_error")
		return
	}
	cfg, err := s.providers.LoginProvider(ctx, id)
	if err != nil {
		loginError(w, r, "provider_unknown")
		return
	}
	redirectURI, err := s.providers.CallbackURL(ctx, id)
	if err != nil || redirectURI == "" {
		loginError(w, r, "provider_error")
		return
	}
	p, err := s.providerFor(ctx, cfg)
	if err != nil {
		slog.Warn("oidc discovery failed", "provider", id, "err", err)
		loginError(w, r, "provider_error")
		return
	}
	claims, err := p.exchange(ctx, code, st.Verifier, st.Nonce, redirectURI)
	if err != nil {
		slog.Warn("oidc exchange failed", "provider", id, "err", err)
		loginError(w, r, "provider_error")
		return
	}
	if claims.Subject == "" {
		loginError(w, r, "provider_error")
		return
	}

	res, ferr := s.finishSocial(r, id, claims, st)
	if ferr != nil {
		if ferr.toProfile {
			http.Redirect(w, r, "/profile?error="+ferr.code, http.StatusFound)
		} else {
			loginError(w, r, ferr.code)
		}
		return
	}
	// A link kept the existing session; a login or registration mints one.
	if res.userID != "" {
		token, err := s.createSession(ctx, res.userID)
		if err != nil {
			slog.Error("create session after provider login", "err", err)
			loginError(w, r, "provider_error")
			return
		}
		http.SetCookie(w, s.sessionCookie(ctx, token, sessionTTL))
	}
	http.Redirect(w, r, res.target, http.StatusFound)
}

func loginError(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, "/login?error="+code, http.StatusFound)
}

// loginCookie is the short-lived signed state cookie. Lax, not Strict:
// the redirect back from the issuer is a cross-site navigation and must
// carry it.
func (s *Service) loginCookie(r *http.Request, value string, ttl time.Duration) *http.Cookie {
	return &http.Cookie{
		Name:     loginCookieName,
		Value:    value,
		Path:     "/auth/",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		Secure:   s.opts.SecureCookies || authctx.SecureTransport(r.Context()),
		SameSite: http.SameSiteLaxMode,
	}
}

func (s *Service) encodeLoginState(st loginState) string {
	payload, _ := json.Marshal(st)
	mac := hmac.New(sha256.New, s.stateKey)
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Service) readLoginState(r *http.Request) (loginState, error) {
	c, err := r.Cookie(loginCookieName)
	if err != nil {
		return loginState{}, err
	}
	raw, sig, ok := strings.Cut(c.Value, ".")
	if !ok {
		return loginState{}, errors.New("malformed state cookie")
	}
	payload, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return loginState{}, err
	}
	want, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		return loginState{}, err
	}
	mac := hmac.New(sha256.New, s.stateKey)
	mac.Write(payload)
	if !hmac.Equal(mac.Sum(nil), want) {
		return loginState{}, errors.New("state cookie signature mismatch")
	}
	var st loginState
	if err := json.Unmarshal(payload, &st); err != nil {
		return loginState{}, err
	}
	if st.V != 1 || time.Now().Unix() > st.Exp {
		return loginState{}, errors.New("state cookie expired")
	}
	return st, nil
}

func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("auth: read random: %v", err))
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// safeRedirectPath mirrors the client's safeRedirect: same-origin
// absolute paths only, never back onto /login.
func safeRedirectPath(p string) string {
	if len(p) < 2 || p[0] != '/' || p[1] == '/' || p[1] == '\\' {
		return ""
	}
	if p == "/login" || strings.HasPrefix(p, "/login?") || strings.HasPrefix(p, "/login/") {
		return ""
	}
	return p
}
