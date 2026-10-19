package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Confirm it's you: the changes that could keep an account after a session
// is stolen need a recent sign-in, and the way to get one without signing
// out is to reauthenticate, which replaces the session. See
// docs/architecture/identity.md → Confirm it's you.

// recentSignIn is how old a session may be and still count as the person
// being here, long enough to sign in again and come back to press Save.
const recentSignIn = 5 * time.Minute

// confirmPath is the client route that asks the person to confirm it's
// them (web/src/routes/Confirm.tsx).
const confirmPath = "/confirm"

// errNotConfirmed is every reauth refusal, whatever went wrong: a wrong
// password, or a provider identity that isn't this account's. Saying which
// would tell someone holding the session what the account's identities are.
var errNotConfirmed = errors.New("Couldn't confirm it's you. Try again.")

// requireRecentSignIn refuses unless the session making the change is
// under recentSignIn old. sessionID is the caller's session, "" for a
// token: a token is never a sign-in, however new. what finishes "sign in
// again first, then …".
func (s *Service) requireRecentSignIn(ctx context.Context, sessionID, what string) error {
	recent := false
	if sessionID != "" { // credentials.id is a uuid: "" would be a query error
		signedIn, err := s.q.GetCredentialCreatedAt(ctx, sessionID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("look up session: %w", err)
		}
		recent = err == nil && time.Since(signedIn) <= recentSignIn
	}
	if !recent {
		return connect.NewError(connect.CodeFailedPrecondition,
			errors.New("sign in again first, then "+what))
	}
	return nil
}

// Reauthenticate is confirming with the password.
func (s *Service) Reauthenticate(ctx context.Context, req *connect.Request[authv1.ReauthenticateRequest]) (*connect.Response[authv1.ReauthenticateResponse], error) {
	id, ok := authctx.From(ctx)
	if !ok || id.SessionID == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("not logged in"))
	}
	user, err := s.q.GetUserByID(ctx, id.UserID)
	if err != nil {
		return nil, fmt.Errorf("look up user: %w", err)
	}
	if user.PasswordHash == nil {
		return nil, apierr.Field(connect.CodeInvalidArgument, "password", errNotConfirmed)
	}
	match, err := s.accountPasswordMatches(ctx, user, req.Msg.Password)
	if err != nil {
		return nil, err
	}
	if !match {
		return nil, apierr.Field(connect.CodeInvalidArgument, "password", errNotConfirmed)
	}
	token, ttl, err := s.replaceSession(ctx, id.UserID, id.SessionID, req.Header().Get("User-Agent"))
	if err != nil {
		return nil, err
	}
	resp := connect.NewResponse(&authv1.ReauthenticateResponse{Token: token})
	resp.Header().Add("Set-Cookie", s.sessionCookie(ctx, token, ttl).String())
	return resp, nil
}

// replaceSession signs userID in afresh and ends oldSessionID. The new
// session is the recent sign-in; ending the old one ends every copy of it,
// a stolen one included. The person's other devices hold sessions of their
// own and are untouched.
func (s *Service) replaceSession(ctx context.Context, userID, oldSessionID, userAgent string) (string, time.Duration, error) {
	token, ttl, err := s.createSession(ctx, userID, userAgent)
	if err != nil {
		return "", 0, err
	}
	rows, err := s.q.DeleteCredential(ctx, oldSessionID)
	if err != nil {
		return "", 0, fmt.Errorf("end the replaced session: %w", err)
	}
	for _, r := range rows {
		s.announceRevoked(r.ID, r.HolderID)
	}
	return token, ttl, nil
}

// reauthOwner checks that a provider identity belongs to userID, which is
// all a provider reauth proves. An identity that is someone else's, or no
// one's, is refused like a wrong password.
func (s *Service) reauthOwner(ctx context.Context, provider string, claims Claims, userID string) (bool, error) {
	user, err := s.q.GetUserByIdentity(ctx, dbgen.GetUserByIdentityParams{
		Provider: provider, Subject: claims.Subject,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("look up identity: %w", err)
	}
	return user.ID == userID && user.DeactivatedAt == nil, nil
}

// finishReauth ends a browser reauth: the session that started it must
// still be the one this browser holds, and the identity must be this
// account's. Then the session is replaced and the person goes back to
// where they were.
func (s *Service) finishReauth(w http.ResponseWriter, r *http.Request, st loginState, claims Claims) {
	ctx := r.Context()
	ident, err := s.verifySession(ctx, r.Header)
	if err != nil && !errors.Is(err, authctx.ErrNoSession) {
		slog.Error("verify session for a reauth", "err", err)
		reauthError(w, r, st.Redirect, "server_error")
		return
	}
	if err != nil || ident.UserID != st.ReauthUserID || ident.SessionID != st.SessionID {
		reauthError(w, r, st.Redirect, "reauth_failed")
		return
	}
	owned, err := s.reauthOwner(ctx, st.Provider, claims, ident.UserID)
	if err != nil {
		slog.Error("check a reauth identity", "err", err)
		reauthError(w, r, st.Redirect, "server_error")
		return
	}
	if !owned {
		reauthError(w, r, st.Redirect, "reauth_failed")
		return
	}
	token, ttl, err := s.replaceSession(ctx, ident.UserID, ident.SessionID, r.UserAgent())
	if err != nil {
		slog.Error("replace session after reauth", "err", err)
		reauthError(w, r, st.Redirect, "server_error")
		return
	}
	http.SetCookie(w, s.sessionCookie(ctx, token, ttl))
	target := st.Redirect
	if target == "" {
		target = "/profile"
	}
	http.Redirect(w, r, target, http.StatusFound)
}

// reauthError sends a failed reauth back to the confirm page, which says
// only that it didn't work.
func reauthError(w http.ResponseWriter, r *http.Request, next, code string) {
	query := url.Values{"error": {code}}
	if next != "" {
		query.Set("next", next)
	}
	http.Redirect(w, r, confirmPath+"?"+query.Encode(), http.StatusFound)
}

// desktopReauth ends a reauth the desktop app started: as for a link, the
// view redeeming the code must hold the session that opened the attempt,
// and the browser leg only carried the provider's claims back.
func (s *Service) desktopReauth(w http.ResponseWriter, r *http.Request, redeemed desktopCode) {
	ctx := r.Context()
	ident, err := s.verifySession(ctx, r.Header)
	if err != nil && !errors.Is(err, authctx.ErrNoSession) {
		slog.Error("verify session for a desktop reauth", "err", err)
		desktopError(w, http.StatusServiceUnavailable, "server_error")
		return
	}
	if err != nil || ident.UserID != redeemed.attempt.userID || ident.SessionID != redeemed.attempt.sessionID {
		desktopError(w, http.StatusUnauthorized, "reauth_failed")
		return
	}
	owned, err := s.reauthOwner(ctx, redeemed.attempt.provider, redeemed.claims, ident.UserID)
	if err != nil {
		slog.Error("check a desktop reauth identity", "err", err)
		desktopError(w, http.StatusInternalServerError, "server_error")
		return
	}
	if !owned {
		desktopError(w, http.StatusUnauthorized, "reauth_failed")
		return
	}
	token, ttl, err := s.replaceSession(ctx, ident.UserID, ident.SessionID, r.UserAgent())
	if err != nil {
		slog.Error("replace session after desktop reauth", "err", err)
		desktopError(w, http.StatusInternalServerError, "server_error")
		return
	}
	http.SetCookie(w, s.sessionCookie(ctx, token, ttl))
	writeDesktopJSON(w, http.StatusOK, map[string]string{"token": token, "reauthed": redeemed.attempt.provider})
}
