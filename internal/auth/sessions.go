package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/alexedwards/argon2id"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Sessions: signing in and out, the opaque token behind the cookie, and
// the single place it is verified. Lockout policy lives in lockout.go.

const (
	SessionCookieName = "stoop_session"
	// defaultSessionLifetime applies without a SessionPolicy.
	defaultSessionLifetime = 30 * 24 * time.Hour
	// maxUserAgent bounds what is kept of a sign-in's User-Agent.
	maxUserAgent = 512
)

// SessionPolicy is auth's port for how long a sign-in lasts; backed by
// instance.
type SessionPolicy interface {
	SessionLifetime(ctx context.Context) (time.Duration, error)
}

// UseSessionPolicy wires the port.
func (s *Service) UseSessionPolicy(p SessionPolicy) { s.sessions = p }

func (s *Service) sessionLifetime(ctx context.Context) (time.Duration, error) {
	if s.sessions == nil {
		return defaultSessionLifetime, nil
	}
	return s.sessions.SessionLifetime(ctx)
}

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
	// A bot never signs in, whatever its row holds: it takes the same
	// path as an unknown handle.
	hash := s.dummyHash
	person := err == nil && user.Kind != string(authctx.KindBot)
	if person && user.PasswordHash != nil {
		hash = *user.PasswordHash
	}
	match, cmpErr := argon2id.ComparePasswordAndHash(req.Msg.Password, hash)
	if cmpErr != nil {
		return nil, fmt.Errorf("verify password: %w", cmpErr)
	}
	if !person || user.PasswordHash == nil || !match {
		s.guard.failure(handle)
		return nil, errInvalidCredentials()
	}
	s.guard.success(handle)
	// A deleted account has no password, so it never gets this far: it
	// reads as a wrong password, and says nothing about having existed.
	if user.DeactivatedAt != nil {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("this account has been deactivated"))
	}
	// Checked after the password so a wrong password never learns whether
	// the handle exists; admins are always let through (break-glass).
	if err := s.passwordSignInAllowed(ctx, authctx.Role(user.Role)); err != nil {
		return nil, err
	}

	token, ttl, err := s.createSession(ctx, user.ID, req.Header().Get("User-Agent"))
	if err != nil {
		return nil, err
	}

	resp := connect.NewResponse(&authv1.LoginResponse{User: toProtoUser(user), Token: token})
	resp.Header().Add("Set-Cookie", s.sessionCookie(ctx, token, ttl).String())
	return resp, nil
}

func (s *Service) Logout(ctx context.Context, _ *connect.Request[authv1.LogoutRequest]) (*connect.Response[authv1.LogoutResponse], error) {
	id, ok := authctx.From(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("not logged in"))
	}
	if id.SessionID != "" {
		rows, err := s.q.DeleteCredential(ctx, id.SessionID)
		if err != nil {
			return nil, fmt.Errorf("delete session: %w", err)
		}
		for _, r := range rows {
			s.announceRevoked(r.ID, r.HolderID)
		}
	}
	resp := connect.NewResponse(&authv1.LogoutResponse{})
	resp.Header().Add("Set-Cookie", s.sessionCookie(ctx, "", -time.Second).String())
	return resp, nil
}

// VerifyToken validates an opaque credential token. It is the single
// verification path shared by the Connect interceptor and the WebSocket
// upgrade handler.
func (s *Service) VerifyToken(ctx context.Context, token string) (authctx.Identity, error) {
	return s.verify(ctx, token, false)
}

// verify resolves any credential. A hook token is refused unless allowHook:
// it belongs in a hook URL and nowhere else.
func (s *Service) verify(ctx context.Context, token string, allowHook bool) (authctx.Identity, error) {
	if token == "" {
		return authctx.Identity{}, errors.New("missing token")
	}
	hash := sha256.Sum256([]byte(token))
	c, err := s.q.GetCredentialByTokenHash(ctx, hash[:])
	if err != nil {
		return authctx.Identity{}, errors.New("invalid or expired session")
	}
	if c.Kind == string(authctx.CredentialIncomingHook) && !allowHook {
		return authctx.Identity{}, errors.New("a hook token is not a bearer token")
	}
	id := authctx.Identity{
		UserID: c.HolderID, Role: authctx.Role(c.HolderRole), Kind: authctx.IdentityKind(c.HolderKind),
		Credential: authctx.Credential{
			ID: c.ID, Kind: authctx.CredentialKind(c.Kind), Grants: toActions(c.Grants),
			Bounded: c.Bounded, Spaces: c.BoundSpaces, Channels: c.BoundChannels,
		},
	}
	if id.Credential.Kind == authctx.CredentialSession {
		id.SessionID = c.ID
	}
	// The server's personal-token setting is checked at every use, so
	// turning it down stops tokens that already exist.
	if id.Credential.Kind == authctx.CredentialPersonalToken {
		reason, err := s.tokenBlock(ctx, id.Role)
		if err != nil {
			return authctx.Identity{}, err
		}
		if reason != "" {
			return authctx.Identity{}, errors.New(reason)
		}
	}
	// At most once a minute, so a busy client doesn't make every read a write.
	if c.LastUsedAt == nil || time.Since(*c.LastUsedAt) > time.Minute {
		if err := s.q.TouchCredential(ctx, c.ID); err != nil {
			slog.Default().Warn("record credential use", "err", err)
		}
	}
	return id, nil
}

// toActions keeps nil as nil: a session's grant, which covers everything.
func toActions(grants []string) []authctx.Action {
	if grants == nil {
		return nil
	}
	out := make([]authctx.Action, len(grants))
	for i, g := range grants {
		out[i] = authctx.Action(g)
	}
	return out
}

// createSession mints a session for the lifetime in force now, and returns
// that lifetime for the cookie.
func (s *Service) createSession(ctx context.Context, userID, userAgent string) (string, time.Duration, error) {
	ttl, err := s.sessionLifetime(ctx)
	if err != nil {
		return "", 0, err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", 0, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	hash := sha256.Sum256([]byte(token))

	id, err := uuid.NewV7()
	if err != nil {
		return "", 0, err
	}
	if len(userAgent) > maxUserAgent {
		userAgent = strings.ToValidUTF8(userAgent[:maxUserAgent], "")
	}
	_, err = s.q.CreateSession(ctx, dbgen.CreateSessionParams{
		ID:        id.String(),
		HolderID:  userID,
		TokenHash: hash[:],
		ExpiresAt: time.Now().Add(ttl),
		UserAgent: userAgent,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", 0, errors.New("only a person can have a session")
	}
	if err != nil {
		return "", 0, fmt.Errorf("create session: %w", err)
	}
	return token, ttl, nil
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
