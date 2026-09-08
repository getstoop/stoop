package auth

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// The desktop app's leg of provider sign-in. The browser half runs in the
// system browser (providers refuse an embedded view), and the session
// comes back to the app as a stoop://auth deep link.
// docs/architecture/desktop.md → Deep links.
//
// Two hops, one store entry each: an attempt id, made at
// /auth/desktop/start and carried through the provider round trip in the
// login-state cookie, and a code, minted at the callback and redeemed at
// /auth/desktop/complete. The PKCE pair here binds the app that started
// the attempt; loginState.Verifier is the unrelated server↔provider one.

// desktopReturnPath is a client route (web/src/routes/DesktopAuthReturn.tsx):
// it builds the link from its own origin and fires it.
const desktopReturnPath = "/auth/desktop/return"

const (
	desktopAttemptTTL = 5 * time.Minute
	desktopCodeTTL    = time.Minute
	// A verifier and its challenge are 32 random bytes, base64url.
	desktopSecretMin = 43
	desktopSecretMax = 128
	// plain is for a page with no crypto.subtle, which a browser withholds
	// from a plain-HTTP origin (a LAN or tailnet server reached by address).
	desktopMethodS256  = "S256"
	desktopMethodPlain = "plain"
)

type desktopAttempt struct {
	provider  string
	challenge string
	method    string
	expires   time.Time
}

type desktopCode struct {
	attempt desktopAttempt
	userID  string
	expires time.Time
}

// desktopStore holds attempts and the codes they become. In memory and
// per process, like the login-state key: a restart mid-sign-in expires
// the attempt.
type desktopStore struct {
	mu       sync.Mutex
	attempts map[string]desktopAttempt
	codes    map[string]desktopCode
}

func newDesktopStore() *desktopStore {
	return &desktopStore{
		attempts: map[string]desktopAttempt{},
		codes:    map[string]desktopCode{},
	}
}

func (d *desktopStore) begin(a desktopAttempt) string {
	id := randomToken()
	d.mu.Lock()
	defer d.mu.Unlock()
	d.sweep()
	d.attempts[id] = a
	return id
}

// open reports whether the attempt is live and was started for provider.
func (d *desktopStore) open(id, provider string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	a, ok := d.attempts[id]
	return ok && a.provider == provider && time.Now().Before(a.expires)
}

// mint consumes the attempt and returns the code the app redeems for it.
func (d *desktopStore) mint(id, provider, userID string) (string, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	a, ok := d.attempts[id]
	delete(d.attempts, id)
	if !ok || a.provider != provider || time.Now().After(a.expires) {
		return "", false
	}
	code := randomToken()
	d.codes[code] = desktopCode{attempt: a, userID: userID, expires: time.Now().Add(desktopCodeTTL)}
	return code, true
}

// redeem consumes the code and checks the verifier against the challenge
// the attempt carried. Single use: the code is spent either way.
func (d *desktopStore) redeem(code, verifier string) (string, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	c, ok := d.codes[code]
	delete(d.codes, code)
	if !ok || time.Now().After(c.expires) || !c.attempt.matches(verifier) {
		return "", false
	}
	return c.userID, true
}

// drop discards an attempt that will never be redeemed.
func (d *desktopStore) drop(id string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.attempts, id)
}

func (d *desktopStore) sweep() {
	now := time.Now()
	for id, a := range d.attempts {
		if now.After(a.expires) {
			delete(d.attempts, id)
		}
	}
	for code, c := range d.codes {
		if now.After(c.expires) {
			delete(d.codes, code)
		}
	}
}

func (a desktopAttempt) matches(verifier string) bool {
	if !validDesktopSecret(verifier) {
		return false
	}
	got := verifier
	if a.method == desktopMethodS256 {
		sum := sha256.Sum256([]byte(verifier))
		got = base64.RawURLEncoding.EncodeToString(sum[:])
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(a.challenge)) == 1
}

func validDesktopSecret(v string) bool {
	if len(v) < desktopSecretMin || len(v) > desktopSecretMax {
		return false
	}
	for _, c := range []byte(v) {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == '-' || c == '_':
		default:
			return false
		}
	}
	return true
}

type desktopStartRequest struct {
	Provider  string `json:"provider"`
	Challenge string `json:"attemptChallenge"`
	Method    string `json:"attemptMethod"`
}

type desktopCompleteRequest struct {
	Code     string `json:"code"`
	Verifier string `json:"attemptVerifier"`
}

// desktopStart opens an attempt. The page keeps the verifier in its
// session storage; the challenge waits here for the code the callback
// mints.
func (s *Service) desktopStart(w http.ResponseWriter, r *http.Request) {
	var req desktopStartRequest
	if !readDesktopJSON(w, r, &req) {
		return
	}
	if req.Method == "" {
		req.Method = desktopMethodS256
	}
	if !validDesktopSecret(req.Challenge) ||
		(req.Method != desktopMethodS256 && req.Method != desktopMethodPlain) {
		desktopError(w, http.StatusBadRequest, "attempt_invalid")
		return
	}
	if s.providers == nil {
		desktopError(w, http.StatusNotFound, "provider_unknown")
		return
	}
	if _, err := s.providers.LoginProvider(r.Context(), req.Provider); err != nil {
		desktopError(w, http.StatusNotFound, "provider_unknown")
		return
	}
	id := s.desktop.begin(desktopAttempt{
		provider:  req.Provider,
		challenge: req.Challenge,
		method:    req.Method,
		expires:   time.Now().Add(desktopAttemptTTL),
	})
	writeDesktopJSON(w, http.StatusOK, map[string]any{
		"attempt": id, "expiresIn": int(desktopAttemptTTL.Seconds()),
	})
}

// desktopHandOff ends the browser leg of a desktop sign-in: the browser
// is sent to the page that fires the deep link, and gets no session — it
// is not where the person is signing in.
func (s *Service) desktopHandOff(w http.ResponseWriter, r *http.Request, st loginState, res flowResult) {
	if res.userID == "" {
		loginError(w, r, "login_state")
		return
	}
	code, ok := s.desktop.mint(st.Attempt, st.Provider, res.userID)
	if !ok {
		loginError(w, r, "login_expired")
		return
	}
	desktopReturn(w, r, url.Values{"code": {code}, "provider": {st.Provider}})
}

// loginFail ends a failed sign-in. One that belongs to a desktop attempt
// carries the error back to the app, since the browser is not where the
// person is; everything else is the usual /login redirect.
func (s *Service) loginFail(w http.ResponseWriter, r *http.Request, attempt, provider, code string) {
	if attempt == "" {
		loginError(w, r, code)
		return
	}
	s.desktop.drop(attempt)
	desktopReturn(w, r, url.Values{"error": {code}, "provider": {provider}})
}

// desktopReturn hands the browser to the client route that fires the deep
// link. A same-origin redirect, never one to stoop:// itself: a redirect
// to a custom scheme is handled inconsistently and leaves an empty tab.
// The provider rides along so that page can offer to carry on here
// instead.
func desktopReturn(w http.ResponseWriter, r *http.Request, q url.Values) {
	http.Redirect(w, r, desktopReturnPath+"?"+q.Encode(), http.StatusFound)
}

// desktopComplete redeems the code the app carried back, in the view that
// started the attempt: the session cookie lands where the person is.
func (s *Service) desktopComplete(w http.ResponseWriter, r *http.Request) {
	var req desktopCompleteRequest
	if !readDesktopJSON(w, r, &req) {
		return
	}
	userID, ok := s.desktop.redeem(req.Code, req.Verifier)
	if !ok {
		desktopError(w, http.StatusUnauthorized, "code_invalid")
		return
	}
	token, err := s.createSession(r.Context(), userID)
	if err != nil {
		slog.Error("create session after desktop sign-in", "err", err)
		desktopError(w, http.StatusInternalServerError, "server_error")
		return
	}
	http.SetCookie(w, s.sessionCookie(r.Context(), token, sessionTTL))
	writeDesktopJSON(w, http.StatusOK, map[string]string{"token": token})
}

func readDesktopJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<10)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		desktopError(w, http.StatusBadRequest, "bad_request")
		return false
	}
	return true
}

func writeDesktopJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func desktopError(w http.ResponseWriter, status int, code string) {
	writeDesktopJSON(w, status, map[string]string{"error": code})
}
