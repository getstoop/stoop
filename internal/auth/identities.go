package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/protobuf/types/known/timestamppb"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Linked sign-in identities: which login providers (by the id from the
// instance's settings) can sign in to the caller's account. The rows live
// in user_identities, owned by auth; no provider tokens are ever stored.

func (s *Service) ListIdentities(ctx context.Context, _ *connect.Request[authv1.ListIdentitiesRequest]) (*connect.Response[authv1.ListIdentitiesResponse], error) {
	rows, err := s.q.ListUserIdentities(ctx, authctx.UserID(ctx))
	if err != nil {
		return nil, fmt.Errorf("list identities: %w", err)
	}
	out := make([]*authv1.Identity, len(rows))
	for i, r := range rows {
		out[i] = &authv1.Identity{
			Provider:  r.Provider,
			Email:     r.Email,
			CreatedAt: timestamppb.New(r.CreatedAt),
		}
	}
	return connect.NewResponse(&authv1.ListIdentitiesResponse{Identities: out}), nil
}

func (s *Service) UnlinkIdentity(ctx context.Context, req *connect.Request[authv1.UnlinkIdentityRequest]) (*connect.Response[authv1.UnlinkIdentityResponse], error) {
	provider := strings.TrimSpace(req.Msg.Provider)
	if provider == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("provider is required"))
	}
	// The count and delete share a transaction so two concurrent unlinks
	// can't strip a passwordless account of its last way to sign in.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op

	qtx := s.q.WithTx(tx)
	user, err := qtx.GetUserByID(ctx, authctx.UserID(ctx))
	if err != nil {
		return nil, fmt.Errorf("look up user: %w", err)
	}
	if user.PasswordHash == nil {
		n, err := qtx.CountUserIdentities(ctx, user.ID)
		if err != nil {
			return nil, fmt.Errorf("count identities: %w", err)
		}
		if n <= 1 {
			return nil, connect.NewError(connect.CodeFailedPrecondition,
				errors.New("set a password first: this is the account's only way to sign in"))
		}
	}
	deleted, err := qtx.DeleteUserIdentity(ctx, dbgen.DeleteUserIdentityParams{
		UserID: user.ID, Provider: provider,
	})
	if err != nil {
		return nil, fmt.Errorf("unlink identity: %w", err)
	}
	if deleted == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("identity not found"))
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return connect.NewResponse(&authv1.UnlinkIdentityResponse{}), nil
}

// flowErr is a callback failure the browser should hear about: a code
// for /login?error=... or, for link failures, /profile?error=...
type flowErr struct {
	code      string
	toProfile bool
}

type flowResult struct {
	// userID is who to mint a session for; empty when the existing
	// session stands (a link).
	userID string
	// target is where the browser goes next.
	target string
}

// finishSocial is the callback decision tree: the identity logs in,
// attaches to the linking account, or registers a new account under the
// instance's registration policy.
func (s *Service) finishSocial(r *http.Request, providerID string, claims Claims, st loginState) (flowResult, *flowErr) {
	ctx := r.Context()
	user, err := s.q.GetUserByIdentity(ctx, dbgen.GetUserByIdentityParams{
		Provider: providerID, Subject: claims.Subject,
	})
	switch {
	case err == nil:
		if user.DeactivatedAt != nil {
			return flowResult{}, &flowErr{code: "deactivated"}
		}
		if st.LinkUserID != "" && st.LinkUserID != user.ID {
			return flowResult{}, &flowErr{code: "identity_taken", toProfile: true}
		}
		target := st.Redirect
		if target == "" {
			target = "/"
		}
		return flowResult{userID: user.ID, target: target}, nil
	case !errors.Is(err, pgx.ErrNoRows):
		slog.Error("look up identity", "err", err)
		return flowResult{}, &flowErr{code: "provider_error"}
	}

	if st.LinkUserID != "" {
		return s.linkIdentity(r, providerID, claims, st)
	}
	return s.registerSocial(ctx, providerID, claims, st)
}

// linkIdentity attaches the identity to the account that started the
// link, after re-verifying that the same session is still live.
func (s *Service) linkIdentity(r *http.Request, providerID string, claims Claims, st loginState) (flowResult, *flowErr) {
	ctx := r.Context()
	ident, err := s.VerifyToken(ctx, TokenFromHeader(r.Header))
	if err != nil || ident.UserID != st.LinkUserID || ident.SessionID != st.SessionID {
		return flowResult{}, &flowErr{code: "login_state"}
	}
	if _, err := s.q.CreateIdentity(ctx, dbgen.CreateIdentityParams{
		Provider: providerID, Subject: claims.Subject,
		UserID: ident.UserID, Email: claims.Email,
	}); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			// The same account already has this provider; the identity
			// itself was checked above, so the conflict is (user, provider).
			return flowResult{}, &flowErr{code: "already_linked", toProfile: true}
		}
		slog.Error("link identity", "err", err)
		return flowResult{}, &flowErr{code: "provider_error"}
	}
	return flowResult{target: "/profile?linked=" + providerID}, nil
}

// registerSocial creates an account for a first-time identity, under the
// same policy Register enforces. The callback runs outside the Connect
// interceptor, so there is never an admin identity here: under a closed
// policy every social registration is refused.
func (s *Service) registerSocial(ctx context.Context, providerID string, claims Claims, st loginState) (flowResult, *flowErr) {
	existing, err := s.q.CountUsers(ctx)
	if err != nil {
		slog.Error("count users", "err", err)
		return flowResult{}, &flowErr{code: "provider_error"}
	}
	inviteRequired, err := s.checkRegistrationAllowed(ctx, st.Invite, existing)
	if err != nil {
		// Closed and missing-invite share an error code, so ask the
		// policy which story to tell the login page.
		code := "invite_invalid"
		if p, perr := s.policy.RegistrationPolicy(ctx); perr == nil && p == PolicyClosed {
			code = "closed"
		} else if st.Invite == "" {
			code = "invite_required"
		}
		return flowResult{}, &flowErr{code: code}
	}

	username, err := s.deriveUsername(ctx, claims)
	if err != nil {
		slog.Error("derive username", "err", err)
		return flowResult{}, &flowErr{code: "provider_error"}
	}
	displayName := claims.Name
	if displayName == "" {
		displayName = username
	}
	params := createAccountParams{
		Username: username, DisplayName: displayName, UsernamePending: true,
		Identity: &identitySeed{Provider: providerID, Subject: claims.Subject, Email: claims.Email},
	}
	user, err := s.createAccount(ctx, params)
	if connect.CodeOf(err) == connect.CodeAlreadyExists {
		// Lost a race for the handle: once more with a random suffix.
		params.Username = randomSuffix(username)
		user, err = s.createAccount(ctx, params)
	}
	if err != nil {
		slog.Error("create account from provider login", "err", err)
		return flowResult{}, &flowErr{code: "provider_error"}
	}

	target := "/?welcome=1"
	if st.Invite != "" && s.invites != nil {
		spaceID, err := s.redeemInvite(ctx, user, st.Invite, inviteRequired)
		if err != nil {
			return flowResult{}, &flowErr{code: "invite_invalid"}
		}
		if spaceID != "" {
			target = "/s/" + spaceID + "?welcome=1"
		}
	}
	return flowResult{userID: user.ID, target: target}, nil
}

// deriveUsername turns provider claims into a free handle:
// preferred_username, else the email local part, else the name —
// sanitized to the registration alphabet, then suffixed past conflicts.
func (s *Service) deriveUsername(ctx context.Context, claims Claims) (string, error) {
	// Microsoft's preferred_username is usually the email-shaped UPN;
	// an email-shaped claim contributes only its local part.
	base := sanitizeUsername(localPart(claims.PreferredUsername))
	if base == "" {
		base = sanitizeUsername(localPart(claims.Email))
	}
	if base == "" {
		base = sanitizeUsername(claims.Name)
	}
	if base == "" {
		base = "user"
	}
	for i := 1; i <= 20; i++ {
		candidate := base
		if i > 1 {
			candidate = fmt.Sprintf("%s%d", base, i)
			if len(candidate) > 32 {
				candidate = fmt.Sprintf("%s%d", base[:32-len(fmt.Sprint(i))], i)
			}
		}
		if reservedUsernames[candidate] {
			continue
		}
		taken, err := s.q.UsernameTaken(ctx, candidate)
		if err != nil {
			return "", err
		}
		if !taken {
			return candidate, nil
		}
	}
	return randomSuffix(base), nil
}

// localPart is everything before an "@", or the whole string without one.
func localPart(raw string) string {
	local, _, _ := strings.Cut(raw, "@")
	return local
}

func sanitizeUsername(raw string) string {
	lower := strings.ToLower(raw)
	var b strings.Builder
	for _, r := range lower {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_':
			b.WriteRune(r)
		case r == '.' || r == '-' || r == ' ':
			b.WriteRune('_')
		}
	}
	out := strings.Trim(b.String(), "_")
	for strings.Contains(out, "__") {
		out = strings.ReplaceAll(out, "__", "_")
	}
	if len(out) > 32 {
		out = out[:32]
	}
	if out != "" && len(out) < 3 {
		out = (out + "___")[:3]
	}
	return out
}

func randomSuffix(base string) string {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	suffix := "_" + hex.EncodeToString(b)
	if len(base)+len(suffix) > 32 {
		base = base[:32-len(suffix)]
	}
	return base + suffix
}
