package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/kv"
)

// The desktop app's leg of provider sign-in and account linking. The
// browser half runs in the system browser (providers refuse an embedded
// view), and the outcome comes back to the app as a stoop://auth deep
// link. docs/architecture/desktop.md → Deep links.
//
// Two hops, one store entry each: an attempt id, made at
// /auth/desktop/start and carried through the provider round trip in the
// login-state cookie, and a code, minted at the callback and redeemed at
// /auth/desktop/complete. The PKCE pair here binds the app that started
// the attempt; loginState.Verifier is the unrelated server↔provider one.
//
// An attempt is a sign-in or a link. A link records the caller's session
// at the start, links nothing at the callback, and attaches the identity
// at /auth/desktop/complete, where that session is on the request.
//
// The attempt id travels in an address bar, and the verifier only proves
// which window started the attempt — not whose identity came back. So an
// attempt is claimed by its first start, and a link is previewed to the
// person before it attaches anything.
// docs/architecture/identity.md → What a stolen attempt id can do.

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
	// linkUserID and sessionID mark a link attempt and name the session
	// that opened it; both are checked again when the code is redeemed.
	linkUserID string
	sessionID  string
	// claimed by the start that used it: an id is only ever visible
	// because a browser carried it, so a second start is a replay.
	claimed bool
}

func (a desktopAttempt) isLink() bool { return a.linkUserID != "" }

type desktopCode struct {
	attempt desktopAttempt
	// target is where the app lands afterwards, decided by the same
	// finishSocial the browser flow obeys.
	target string
	// userID is who to sign in; claims are what the provider returned,
	// held for a link attempt. One or the other, never both.
	userID string
	claims Claims
}

// desktopStoreCap bounds each store. Anyone can open an attempt, so the
// cap is what keeps a flood of starts from growing memory without end.
const desktopStoreCap = 10_000

// desktopStore holds attempts and the codes they become. In memory and
// per process, like the login-state key: a restart mid-sign-in expires
// the attempt.
type desktopStore struct {
	attempts kv.Store[desktopAttempt]
	codes    kv.Store[desktopCode]
}

func newDesktopStore(backend kv.Backend) *desktopStore {
	return &desktopStore{
		attempts: kv.Open[desktopAttempt](backend, "desktop_attempts", desktopStoreCap),
		codes:    kv.Open[desktopCode](backend, "desktop_codes", desktopStoreCap),
	}
}

func (d *desktopStore) begin(ctx context.Context, a desktopAttempt) (string, error) {
	id := randomToken()
	return id, d.attempts.Set(ctx, id, a, desktopAttemptTTL)
}

// claim marks the attempt started and returns it. One start per attempt:
// whoever reads the id out of the browser afterwards finds it spent, so
// only a live race is left to an attacker who has it.
func (d *desktopStore) claim(ctx context.Context, id, provider string) (desktopAttempt, bool, error) {
	var claimed desktopAttempt
	ok := false
	err := d.attempts.Update(ctx, id, func(a desktopAttempt, found bool) (desktopAttempt, time.Duration, bool) {
		if !found || a.claimed || a.provider != provider {
			return a, 0, found
		}
		a.claimed = true
		claimed, ok = a, true
		return a, 0, true
	})
	return claimed, ok, err
}

// mint consumes the attempt and returns the code the app redeems for it.
// out carries what the callback learned: a user id for a sign-in, the
// provider's claims for a link.
func (d *desktopStore) mint(ctx context.Context, id, provider string, out desktopCode) (string, bool, error) {
	var a desktopAttempt
	ok := false
	err := d.attempts.Update(ctx, id, func(current desktopAttempt, found bool) (desktopAttempt, time.Duration, bool) {
		if found && current.provider == provider {
			a, ok = current, true
		}
		return current, 0, false
	})
	if err != nil || !ok {
		return "", false, err
	}
	code := randomToken()
	out.attempt = a
	if err := d.codes.Set(ctx, code, out, desktopCodeTTL); err != nil {
		return "", false, err
	}
	return code, true, nil
}

// redeem checks the verifier against the challenge the attempt carried
// and consumes the code. Single use, spent on a failed check too — with
// one exception: a link's preview call leaves it for the confirming one.
func (d *desktopStore) redeem(ctx context.Context, code, verifier string, confirm bool) (desktopCode, bool, error) {
	var redeemed desktopCode
	ok := false
	err := d.codes.Update(ctx, code, func(c desktopCode, found bool) (desktopCode, time.Duration, bool) {
		if !found || !c.attempt.matches(verifier) {
			return c, 0, false
		}
		redeemed, ok = c, true
		return c, 0, !confirm && c.attempt.isLink()
	})
	return redeemed, ok, err
}

// drop discards an attempt that will never be redeemed, and reports
// whether it was a link.
func (d *desktopStore) drop(ctx context.Context, id string) (bool, error) {
	wasLink := false
	err := d.attempts.Update(ctx, id, func(a desktopAttempt, found bool) (desktopAttempt, time.Duration, bool) {
		wasLink = found && a.isLink()
		return a, 0, false
	})
	return wasLink, err
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
	// Link opens a link attempt rather than a sign-in one; it requires a
	// session on this request.
	Link bool `json:"link"`
}

type desktopCompleteRequest struct {
	Code     string `json:"code"`
	Verifier string `json:"attemptVerifier"`
	// Confirm attaches the identity a link's preview call named. Ignored
	// by a sign-in, which has nothing to recognise.
	Confirm bool `json:"confirm"`
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
	a := desktopAttempt{
		provider:  req.Provider,
		challenge: req.Challenge,
		method:    req.Method,
	}
	// The app's fetch is same-origin, so a link start carries the session
	// cookie; the identity attaches to that account and nothing else.
	if req.Link {
		ident, err := s.verifySession(r.Context(), r.Header)
		if err != nil && !errors.Is(err, authctx.ErrNoSession) {
			slog.Error("verify session for a desktop link", "err", err)
			desktopError(w, http.StatusServiceUnavailable, "server_error")
			return
		}
		if err != nil {
			desktopError(w, http.StatusUnauthorized, "login_state")
			return
		}
		a.linkUserID, a.sessionID = ident.UserID, ident.SessionID
	}
	id, err := s.desktop.begin(r.Context(), a)
	if err != nil {
		slog.Error("store a desktop attempt", "err", err)
		desktopError(w, http.StatusInternalServerError, "server_error")
		return
	}
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
	code, ok, err := s.desktop.mint(r.Context(), st.Attempt, st.Provider,
		desktopCode{userID: res.userID, target: res.target})
	if err != nil {
		slog.Error("mint a desktop code", "err", err)
		loginError(w, r, "server_error")
		return
	}
	if !ok {
		loginError(w, r, "login_expired")
		return
	}
	desktopReturn(w, r, url.Values{"code": {code}, "provider": {st.Provider}})
}

// desktopLinkHandOff ends the browser leg of a desktop link. Nothing is
// linked here: linkIdentity re-verifies the session that started the
// link, and the system browser has none. The claims ride the code back
// to /auth/desktop/complete instead.
func (s *Service) desktopLinkHandOff(w http.ResponseWriter, r *http.Request, st loginState, claims Claims) {
	code, ok, err := s.desktop.mint(r.Context(), st.Attempt, st.Provider, desktopCode{claims: claims})
	if err != nil {
		slog.Error("mint a desktop link code", "err", err)
		loginError(w, r, "server_error")
		return
	}
	if !ok {
		loginError(w, r, "login_expired")
		return
	}
	desktopReturn(w, r, url.Values{
		"code": {code}, "provider": {st.Provider}, "link": {"1"},
	})
}

// loginFail ends a failed sign-in. One that belongs to a desktop attempt
// carries the error back to the app, since the browser is not where the
// person is; everything else is the usual /login redirect.
func (s *Service) loginFail(w http.ResponseWriter, r *http.Request, attempt, provider, code string) {
	if attempt == "" {
		loginError(w, r, code)
		return
	}
	q := url.Values{"error": {code}, "provider": {provider}}
	// The return page sends a link's failures to /profile, a sign-in's to
	// /login, so it is told which this was.
	wasLink, err := s.desktop.drop(r.Context(), attempt)
	if err != nil {
		slog.Error("drop a desktop attempt", "err", err)
	}
	if wasLink {
		q.Set("link", "1")
	}
	desktopReturn(w, r, q)
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
	c, ok, err := s.desktop.redeem(r.Context(), req.Code, req.Verifier, req.Confirm)
	if err != nil {
		slog.Error("redeem a desktop code", "err", err)
		desktopError(w, http.StatusInternalServerError, "server_error")
		return
	}
	if !ok {
		desktopError(w, http.StatusUnauthorized, "code_invalid")
		return
	}
	if c.attempt.isLink() {
		s.desktopLink(w, r, c, req.Confirm)
		return
	}
	token, err := s.startBrowserSession(w, r, c.userID)
	if err != nil {
		slog.Error("create session after desktop sign-in", "err", err)
		desktopError(w, http.StatusInternalServerError, "server_error")
		return
	}
	writeDesktopJSON(w, http.StatusOK, map[string]string{
		"token": token, "target": c.target,
	})
}

// desktopLink attaches the identity the callback saw. Both bindings the
// attempt carries are checked here: the shell↔server verifier, checked by
// redeem, and the session that opened the link, which is on this request
// because the app calls it from the view it started in. No session is
// minted — a link keeps the one it has.
//
// Two calls, both bound the same way. The first names the identity and
// attaches nothing, leaving the code live inside its TTL; the second
// confirms it. Neither binding tells the app whose identity came back,
// so a person does.
func (s *Service) desktopLink(w http.ResponseWriter, r *http.Request, c desktopCode, confirm bool) {
	ident, err := s.verifySession(r.Context(), r.Header)
	if err != nil && !errors.Is(err, authctx.ErrNoSession) {
		slog.Error("verify session for a desktop link", "err", err)
		desktopError(w, http.StatusServiceUnavailable, "server_error")
		return
	}
	if err != nil || ident.UserID != c.attempt.linkUserID || ident.SessionID != c.attempt.sessionID {
		desktopError(w, http.StatusUnauthorized, "login_state")
		return
	}
	if !confirm {
		writeDesktopJSON(w, http.StatusOK, map[string]string{
			"provider": c.attempt.provider, "email": c.claims.Email,
		})
		return
	}
	st := loginState{
		Provider:   c.attempt.provider,
		LinkUserID: c.attempt.linkUserID,
		SessionID:  c.attempt.sessionID,
	}
	if _, ferr := s.finishSocial(r, c.attempt.provider, c.claims, st); ferr != nil {
		desktopError(w, desktopLinkStatus(ferr.code), ferr.code)
		return
	}
	writeDesktopJSON(w, http.StatusOK, map[string]string{"linked": c.attempt.provider})
}

func desktopLinkStatus(code string) int {
	switch code {
	case "login_state":
		return http.StatusUnauthorized
	case "provider_error":
		return http.StatusInternalServerError
	default:
		return http.StatusConflict
	}
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
