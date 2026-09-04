package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/alexedwards/argon2id"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	authv1 "github.com/Jhut89/stoop/gen/stoop/auth/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/dbgen"
)

// Sessions: signing in and out, the opaque token behind the cookie, and
// the single place it is verified. Lockout policy lives in lockout.go.

const (
	SessionCookieName = "stoop_session"
	sessionTTL        = 30 * 24 * time.Hour
)

func (s *Service) Login(ctx context.Context, req *connect.Request[authv1.LoginRequest]) (*connect.Response[authv1.LoginResponse], error) {
	// The guard is keyed on the handle as typed, normalized the way
	// Register does, so "Ada" and "ada" share one budget.
	handle := strings.ToLower(strings.TrimSpace(req.Msg.Username))
	if wait := s.guard.check(handle); wait > 0 {
		return nil, errLockedOut(wait)
	}

	user, err := s.q.GetUserByUsername(ctx, req.Msg.Username)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("look up user: %w", err)
	}
	// Unknown user: still pay for a hash so the timing matches a wrong
	// password, and still count the failure so the lockout can't be used
	// to tell real handles from fake ones either.
	// A provider-created account with no password yet also gets the dummy
	// hash, so it can't be told apart from a wrong password either.
	hash := s.dummyHash
	if err == nil && user.PasswordHash != nil {
		hash = *user.PasswordHash
	}
	match, cmpErr := argon2id.ComparePasswordAndHash(req.Msg.Password, hash)
	if cmpErr != nil {
		return nil, fmt.Errorf("verify password: %w", cmpErr)
	}
	if err != nil || user.PasswordHash == nil || !match {
		s.guard.failure(handle)
		return nil, errInvalidCredentials()
	}
	s.guard.success(handle)
	if user.DeactivatedAt != nil {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("this account has been deactivated"))
	}
	// Checked after the password so a wrong password never learns whether
	// the handle exists; admins are always let through (break-glass).
	if err := s.passwordSignInAllowed(ctx, authctx.Role(user.Role)); err != nil {
		return nil, err
	}

	token, err := s.createSession(ctx, user.ID)
	if err != nil {
		return nil, err
	}

	resp := connect.NewResponse(&authv1.LoginResponse{User: toProtoUser(user), Token: token})
	resp.Header().Add("Set-Cookie", s.sessionCookie(ctx, token, sessionTTL).String())
	return resp, nil
}

func (s *Service) Logout(ctx context.Context, _ *connect.Request[authv1.LogoutRequest]) (*connect.Response[authv1.LogoutResponse], error) {
	id, ok := authctx.From(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("not logged in"))
	}
	if err := s.q.DeleteSession(ctx, id.SessionID); err != nil {
		return nil, fmt.Errorf("delete session: %w", err)
	}
	resp := connect.NewResponse(&authv1.LogoutResponse{})
	resp.Header().Add("Set-Cookie", s.sessionCookie(ctx, "", -time.Second).String())
	return resp, nil
}

// VerifyToken validates an opaque session token. It is the single
// verification path shared by the Connect interceptor and the WebSocket
// upgrade handler.
func (s *Service) VerifyToken(ctx context.Context, token string) (authctx.Identity, error) {
	if token == "" {
		return authctx.Identity{}, errors.New("missing token")
	}
	hash := sha256.Sum256([]byte(token))
	sess, err := s.q.GetSessionByTokenHash(ctx, hash[:])
	if err != nil {
		return authctx.Identity{}, errors.New("invalid or expired session")
	}
	return authctx.Identity{
		UserID: sess.UserID, SessionID: sess.ID, Role: authctx.Role(sess.UserRole),
	}, nil
}

func (s *Service) createSession(ctx context.Context, userID string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	hash := sha256.Sum256([]byte(token))

	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	_, err = s.q.CreateSession(ctx, dbgen.CreateSessionParams{
		ID:        id.String(),
		UserID:    userID,
		TokenHash: hash[:],
		ExpiresAt: time.Now().Add(sessionTTL),
	})
	if err != nil {
		return "", fmt.Errorf("create session: %w", err)
	}
	return token, nil
}

// sessionCookie is Secure when the deployment says so or when this
// particular request arrived over TLS (the embedded Tailscale listener),
// so a plain LAN listener and an HTTPS one can coexist.
func (s *Service) sessionCookie(ctx context.Context, token string, ttl time.Duration) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		Secure:   s.opts.SecureCookies || authctx.SecureTransport(ctx),
		SameSite: http.SameSiteLaxMode,
	}
}

func errInvalidCredentials() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid username or password"))
}

func errLockedOut(wait time.Duration) error {
	secs := int(wait.Round(time.Second).Seconds())
	if secs < 1 {
		secs = 1
	}
	err := connect.NewError(connect.CodeResourceExhausted,
		fmt.Errorf("too many failed sign-in attempts; try again in %ds", secs))
	err.Meta().Set("Retry-After", fmt.Sprint(secs))
	return err
}
