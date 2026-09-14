package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/protobuf/types/known/timestamppb"

	accessv1 "github.com/getstoop/stoop/gen/stoop/access/v1"
	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/accesswire"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Personal tokens: a person's own credentials for scripts, carrying only
// the permissions they were given (docs/proposals/access-model.md).
// Making, listing and revoking one needs account.security, which only a
// session holds, so no token can make another.

const (
	personalTokenPrefix  = "stp_pat_"
	maxTokenNameRunes    = 50
	maxTokenLifetimeDays = 365
	// expiredTokenKeep is how long an expired token stays listed, so a
	// script that stopped working has an explanation on the page.
	expiredTokenKeep = 30 * 24 * time.Hour
)

// The instance's personal_tokens setting.
const (
	TokensEveryone = "everyone"
	TokensAdmins   = "admins"
	TokensOff      = "off"
)

// TokenPolicy is auth's port for who may use personal tokens; backed by
// instance.
type TokenPolicy interface {
	PersonalTokens(ctx context.Context) (string, error)
}

// UseTokenPolicy wires the port. Without it everyone may.
func (s *Service) UseTokenPolicy(p TokenPolicy) { s.tokens = p }

// tokenBlock is why an account with this role may not make or use a
// personal token right now, or "" when it may.
func (s *Service) tokenBlock(ctx context.Context, role authctx.Role) (string, error) {
	if s.tokens == nil {
		return "", nil
	}
	v, err := s.tokens.PersonalTokens(ctx)
	if err != nil {
		return "", err
	}
	switch {
	case v == TokensOff:
		return "personal tokens are turned off on this server", nil
	case v == TokensAdmins && role != authctx.RoleAdmin:
		return "only server admins can use personal tokens on this server", nil
	}
	return "", nil
}

func requireAccountSecurity(ctx context.Context) (authctx.Identity, error) {
	id, ok := authctx.From(ctx)
	if !ok {
		return authctx.Identity{}, connect.NewError(connect.CodeUnauthenticated, errors.New("not logged in"))
	}
	if !authctx.Allows(ctx, authctx.AccountSecurity) {
		return authctx.Identity{}, connect.NewError(connect.CodePermissionDenied, authctx.Refusal(ctx, authctx.AccountSecurity))
	}
	return id, nil
}

func (s *Service) CreatePersonalToken(ctx context.Context, req *connect.Request[authv1.CreatePersonalTokenRequest]) (*connect.Response[authv1.CreatePersonalTokenResponse], error) {
	id, err := requireAccountSecurity(ctx)
	if err != nil {
		return nil, err
	}
	reason, err := s.tokenBlock(ctx, id.Role)
	if err != nil {
		return nil, err
	}
	if reason != "" {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New(reason))
	}

	name := strings.TrimSpace(req.Msg.Name)
	if name == "" || utf8.RuneCountInString(name) > maxTokenNameRunes {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("a token's name must be 1-%d characters", maxTokenNameRunes))
	}
	grants, err := tokenGrants(req.Msg.Permissions)
	if err != nil {
		return nil, err
	}
	days := req.Msg.ExpiresInDays
	if days < 0 || days > maxTokenLifetimeDays {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("expires_in_days must be 0 (never) or 1-%d", maxTokenLifetimeDays))
	}
	var expires *time.Time
	if days > 0 {
		t := time.Now().Add(time.Duration(days) * 24 * time.Hour)
		expires = &t
	}

	secret, hash, err := newPersonalToken()
	if err != nil {
		return nil, err
	}
	credID, err := uuid.NewV7()
	if err != nil {
		return nil, err
	}
	// A token reaches everything its holder does: no bounds, ever.
	row, err := s.q.CreatePersonalToken(ctx, dbgen.CreatePersonalTokenParams{
		ID: credID.String(), HolderID: id.UserID, TokenHash: hash, Name: name,
		Grants: grants, Bounded: false, ExpiresAt: expires, Hint: secret[len(secret)-4:],
	})
	if err != nil {
		return nil, fmt.Errorf("create token: %w", err)
	}

	token := toProtoToken(dbgen.ListPersonalTokensRow{
		ID: row.ID, Name: row.Name, Grants: row.Grants, Bounded: row.Bounded, CreatedAt: row.CreatedAt,
		LastUsedAt: row.LastUsedAt, ExpiresAt: row.ExpiresAt, Hint: row.Hint,
	}, false)
	return connect.NewResponse(&authv1.CreatePersonalTokenResponse{Token: token, Secret: secret}), nil
}

func (s *Service) ListPersonalTokens(ctx context.Context, _ *connect.Request[authv1.ListPersonalTokensRequest]) (*connect.Response[authv1.ListPersonalTokensResponse], error) {
	id, err := requireAccountSecurity(ctx)
	if err != nil {
		return nil, err
	}
	tokens, err := s.personalTokensOf(ctx, id.UserID, id.Role)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&authv1.ListPersonalTokensResponse{Tokens: tokens}), nil
}

func (s *Service) RevokePersonalToken(ctx context.Context, req *connect.Request[authv1.RevokePersonalTokenRequest]) (*connect.Response[authv1.RevokePersonalTokenResponse], error) {
	id, err := requireAccountSecurity(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.revokeToken(ctx, id.UserID, req.Msg.TokenId); err != nil {
		return nil, err
	}
	return connect.NewResponse(&authv1.RevokePersonalTokenResponse{}), nil
}

// ListTokensOf lists another account's personal tokens for the admin page.
// Authorisation is the caller's (instance) job.
func (s *Service) ListTokensOf(ctx context.Context, userID string) ([]*authv1.PersonalToken, error) {
	if _, err := uuid.Parse(userID); err != nil {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, notFoundOr(err, "user")
	}
	return s.personalTokensOf(ctx, u.ID, authctx.Role(u.Role))
}

// RevokeTokenOf revokes one of another account's personal tokens.
// Authorisation is the caller's (instance) job.
func (s *Service) RevokeTokenOf(ctx context.Context, userID, tokenID string) error {
	return s.revokeToken(ctx, userID, tokenID)
}

func (s *Service) personalTokensOf(ctx context.Context, userID string, role authctx.Role) ([]*authv1.PersonalToken, error) {
	reason, err := s.tokenBlock(ctx, role)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListPersonalTokens(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list tokens: %w", err)
	}
	out := make([]*authv1.PersonalToken, len(rows))
	for i, r := range rows {
		out[i] = toProtoToken(r, reason != "")
	}
	return out, nil
}

func (s *Service) revokeToken(ctx context.Context, holderID, tokenID string) error {
	notFound := connect.NewError(connect.CodeNotFound, errors.New("token not found"))
	if _, err := uuid.Parse(tokenID); err != nil {
		return notFound
	}
	rows, err := s.q.DeletePersonalToken(ctx, dbgen.DeletePersonalTokenParams{ID: tokenID, HolderID: holderID})
	if err != nil {
		return fmt.Errorf("revoke token: %w", err)
	}
	if len(rows) == 0 {
		return notFound
	}
	for _, r := range rows {
		s.announceRevoked(r.ID, r.HolderID)
	}
	return nil
}

// tokenGrants validates a requested grant: at least one permission, each
// one a token may carry.
func tokenGrants(perms []accessv1.Permission) ([]string, error) {
	actions, ok := accesswire.FromProto(perms)
	if !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("unknown permission"))
	}
	if len(actions) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("choose at least one permission"))
	}
	seen := map[authctx.Action]bool{}
	var out []string
	for _, a := range actions {
		if !a.Grantable() {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("a token can't be allowed to %s", a.Describe()))
		}
		if !seen[a] {
			seen[a] = true
			out = append(out, string(a))
		}
	}
	if err := checkGrantDependencies(seen); err != nil {
		return nil, err
	}
	return out, nil
}

// checkGrantDependencies refuses a grant that can't do anything on its
// own: every activity item previews a message from a space or a direct
// message, so activity.read goes only with both read grants.
func checkGrantDependencies(has map[authctx.Action]bool) error {
	if has[authctx.ActivityRead] && (!has[authctx.MessagesRead] || !has[authctx.DMsRead]) {
		return connect.NewError(connect.CodeInvalidArgument,
			errors.New("reading activity needs reading messages and direct messages as well"))
	}
	return nil
}

func newPersonalToken() (secret string, hash []byte, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, err
	}
	secret = personalTokenPrefix + base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(secret))
	return secret, sum[:], nil
}

func toProtoToken(r dbgen.ListPersonalTokensRow, blocked bool) *authv1.PersonalToken {
	out := &authv1.PersonalToken{
		Id: r.ID, Name: r.Name, Permissions: accesswire.ToProto(toActions(r.Grants)),
		CreatedAt: timestamppb.New(r.CreatedAt), Hint: r.Hint, Blocked: blocked,
	}
	if r.LastUsedAt != nil {
		out.LastUsedAt = timestamppb.New(*r.LastUsedAt)
	}
	if r.ExpiresAt != nil {
		out.ExpiresAt = timestamppb.New(*r.ExpiresAt)
	}
	return out
}

// isBadReference reports a foreign key that points nowhere, or an id that
// isn't a uuid at all.
func isBadReference(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && (pgErr.Code == "23503" || pgErr.Code == "22P02")
}
