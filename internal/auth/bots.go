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

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Bots: accounts of kind bot and the credentials they hold. Exposed to the
// integrations module through its BotIdentities port; authorisation is the
// caller's job. See docs/proposals/webhooks.md.

const (
	botTokenPrefix  = "stp_bot_"
	hookTokenPrefix = "stp_hook_"
)

// Bot is a bot account as other modules see it.
type Bot struct {
	ID            string
	Username      string
	DisplayName   string
	AvatarFileID  string
	Bio           string
	CreatedAt     time.Time
	DeactivatedAt *time.Time
}

// BotCredential is a bot token or hook token, never its secret.
type BotCredential struct {
	ID         string
	HolderID   string
	Kind       authctx.CredentialKind
	Name       string
	Grants     []authctx.Action
	Bounded    bool
	SpaceIDs   []string
	ChannelIDs []string
	Hint       string
	CreatedAt  time.Time
	LastUsedAt *time.Time
}

// MintBotCredential describes a credential to mint. A hook is bounded to
// ChannelID; a token has no bound and works wherever the bot is.
type MintBotCredential struct {
	HolderID  string
	Kind      authctx.CredentialKind
	Name      string
	Grants    []authctx.Action
	ChannelID string
	CreatedBy string
}

func (s *Service) CreateBot(ctx context.Context, username, displayName string) (Bot, error) {
	username = strings.ToLower(strings.TrimSpace(username))
	if !usernameRE.MatchString(username) {
		return Bot{}, connect.NewError(connect.CodeInvalidArgument,
			errors.New("username must be 3-32 letters, numbers, or _"))
	}
	if reservedUsernames[username] {
		return Bot{}, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("%q is reserved; pick another username", username))
	}
	displayName = strings.TrimSpace(displayName)
	if displayName == "" || utf8.RuneCountInString(displayName) > maxDisplayNameLen {
		return Bot{}, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("display name must be 1-%d characters", maxDisplayNameLen))
	}
	id, err := uuid.NewV7()
	if err != nil {
		return Bot{}, err
	}
	u, err := s.q.CreateBot(ctx, dbgen.CreateBotParams{ID: id.String(), Username: username, DisplayName: displayName})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return Bot{}, connect.NewError(connect.CodeAlreadyExists, errors.New("username is taken"))
		}
		return Bot{}, fmt.Errorf("create bot: %w", err)
	}
	return toBot(u), nil
}

func (s *Service) GetBot(ctx context.Context, id string) (Bot, error) {
	if _, err := uuid.Parse(id); err != nil {
		return Bot{}, connect.NewError(connect.CodeNotFound, errors.New("bot not found"))
	}
	u, err := s.q.GetUserByID(ctx, id)
	if err != nil || u.Kind != string(authctx.KindBot) {
		return Bot{}, connect.NewError(connect.CodeNotFound, errors.New("bot not found"))
	}
	return toBot(u), nil
}

func (s *Service) ListBots(ctx context.Context) ([]Bot, error) {
	rows, err := s.q.ListBots(ctx)
	if err != nil {
		return nil, fmt.Errorf("list bots: %w", err)
	}
	out := make([]Bot, len(rows))
	for i, u := range rows {
		out[i] = toBot(u)
	}
	return out, nil
}

// UpdateBot changes a bot's names and bio; a nil field is left alone.
// The bio takes the same one-line, 300-character shape as a person's.
func (s *Service) UpdateBot(ctx context.Context, id string, username, displayName, bio *string) (Bot, error) {
	if _, err := s.GetBot(ctx, id); err != nil {
		return Bot{}, err
	}
	text, err := profileText(bio, "bio", maxBioLen)
	if err != nil {
		return Bot{}, err
	}
	if username != nil || displayName != nil {
		if _, err := s.RenameAccount(ctx, id, username, displayName); err != nil {
			return Bot{}, err
		}
	}
	if text != nil {
		if _, err := s.q.UpdateUserProfile(ctx, dbgen.UpdateUserProfileParams{ID: id, Bio: text}); err != nil {
			return Bot{}, fmt.Errorf("update bio: %w", err)
		}
	}
	return s.GetBot(ctx, id)
}

// IsBot answers files' avatar port: only a bot takes an admin-set avatar.
func (s *Service) IsBot(ctx context.Context, id string) (bool, error) {
	_, err := s.GetBot(ctx, id)
	if connect.CodeOf(err) == connect.CodeNotFound {
		return false, nil
	}
	return err == nil, err
}

// DeactivateBot deactivates the account and revokes everything it holds.
func (s *Service) DeactivateBot(ctx context.Context, id string) error {
	if _, err := s.GetBot(ctx, id); err != nil {
		return err
	}
	_, err := s.SetAccountActive(ctx, id, false)
	return err
}

// MintCredential mints a bot token or hook token and returns the secret,
// which is never stored.
func (s *Service) MintCredential(ctx context.Context, m MintBotCredential) (cred BotCredential, secret string, err error) {
	var prefix string
	switch m.Kind {
	case authctx.CredentialBotToken:
		prefix = botTokenPrefix
		if m.ChannelID != "" {
			return BotCredential{}, "", connect.NewError(connect.CodeInvalidArgument, errors.New("a bot token is bounded to spaces, not a channel"))
		}
	case authctx.CredentialIncomingHook:
		prefix = hookTokenPrefix
		if m.ChannelID == "" {
			return BotCredential{}, "", connect.NewError(connect.CodeInvalidArgument, errors.New("a hook is bounded to exactly one channel"))
		}
	default:
		return BotCredential{}, "", connect.NewError(connect.CodeInvalidArgument, errors.New("not a bot credential kind"))
	}
	name := strings.TrimSpace(m.Name)
	if name == "" || utf8.RuneCountInString(name) > maxTokenNameRunes {
		return BotCredential{}, "", connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("a credential's name must be 1-%d characters", maxTokenNameRunes))
	}
	if len(m.Grants) == 0 {
		return BotCredential{}, "", connect.NewError(connect.CodeInvalidArgument, errors.New("choose at least one permission"))
	}
	bounded := m.ChannelID != ""
	grants := make([]string, 0, len(m.Grants))
	has := map[authctx.Action]bool{}
	for _, a := range m.Grants {
		if !a.Grantable() {
			return BotCredential{}, "", connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("a credential can't be allowed to %s", a.Describe()))
		}
		if bounded && !a.OnSpace() {
			return BotCredential{}, "", connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("a bounded credential can't be allowed to %s", a.Describe()))
		}
		has[a] = true
		grants = append(grants, string(a))
	}
	if err := checkGrantDependencies(has); err != nil {
		return BotCredential{}, "", err
	}

	secret, hash, err := newToken(prefix)
	if err != nil {
		return BotCredential{}, "", err
	}
	credID, err := uuid.NewV7()
	if err != nil {
		return BotCredential{}, "", err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return BotCredential{}, "", fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)
	var createdBy *string
	if m.CreatedBy != "" {
		createdBy = &m.CreatedBy
	}
	row, err := qtx.CreateBotCredential(ctx, dbgen.CreateBotCredentialParams{
		ID: credID.String(), HolderID: m.HolderID, Kind: string(m.Kind), TokenHash: hash, Name: name,
		Grants: grants, Bounded: bounded, CreatedBy: createdBy, Hint: secret[len(secret)-4:],
	})
	if err != nil {
		if isBadReference(err) {
			return BotCredential{}, "", connect.NewError(connect.CodeNotFound, errors.New("bot not found"))
		}
		return BotCredential{}, "", notFoundOr(err, "bot")
	}
	if m.ChannelID != "" {
		if err := qtx.AddCredentialChannelBound(ctx, dbgen.AddCredentialChannelBoundParams{CredentialID: row.ID, ChannelID: m.ChannelID}); err != nil {
			if isBadReference(err) {
				return BotCredential{}, "", connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("unknown channel %q", m.ChannelID))
			}
			return BotCredential{}, "", fmt.Errorf("bound credential: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return BotCredential{}, "", fmt.Errorf("commit: %w", err)
	}
	return BotCredential{
		ID: row.ID, HolderID: row.HolderID, Kind: m.Kind, Name: row.Name, Grants: m.Grants,
		Bounded: row.Bounded, ChannelIDs: channelList(m.ChannelID),
		Hint: row.Hint, CreatedAt: row.CreatedAt,
	}, secret, nil
}

// SetCredentialGrants replaces a bot credential's grant.
func (s *Service) SetCredentialGrants(ctx context.Context, id string, grants []authctx.Action) error {
	if _, err := uuid.Parse(id); err != nil {
		return connect.NewError(connect.CodeNotFound, errors.New("credential not found"))
	}
	out := make([]string, 0, len(grants))
	for _, a := range grants {
		if !a.Grantable() {
			return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("a credential can't be allowed to %s", a.Describe()))
		}
		out = append(out, string(a))
	}
	n, err := s.q.SetBotCredentialGrants(ctx, dbgen.SetBotCredentialGrantsParams{ID: id, Grants: out})
	if err != nil {
		return fmt.Errorf("set grants: %w", err)
	}
	if n == 0 {
		return connect.NewError(connect.CodeNotFound, errors.New("credential not found"))
	}
	return nil
}

// RevokeCredential deletes a bot credential and announces it.
func (s *Service) RevokeCredential(ctx context.Context, id string) error {
	if _, err := uuid.Parse(id); err != nil {
		return connect.NewError(connect.CodeNotFound, errors.New("credential not found"))
	}
	rows, err := s.q.DeleteBotCredential(ctx, id)
	if err != nil {
		return fmt.Errorf("revoke credential: %w", err)
	}
	if len(rows) == 0 {
		return connect.NewError(connect.CodeNotFound, errors.New("credential not found"))
	}
	for _, r := range rows {
		s.announceRevoked(r.ID, r.HolderID)
	}
	return nil
}

// BotCredentials lists the given credentials, or with an empty ids every
// bot credential of the given holders (every bot's when both are empty).
func (s *Service) BotCredentials(ctx context.Context, holderIDs, ids []string) ([]BotCredential, error) {
	var rows []dbgen.ListBotCredentialsRow
	if len(ids) > 0 {
		got, err := s.q.GetBotCredentials(ctx, ids)
		if err != nil {
			return nil, fmt.Errorf("list credentials: %w", err)
		}
		for _, r := range got {
			rows = append(rows, dbgen.ListBotCredentialsRow(r))
		}
	} else {
		if holderIDs == nil {
			holderIDs = []string{}
		}
		var err error
		if rows, err = s.q.ListBotCredentials(ctx, holderIDs); err != nil {
			return nil, fmt.Errorf("list credentials: %w", err)
		}
	}
	out := make([]BotCredential, len(rows))
	for i, r := range rows {
		out[i] = BotCredential{
			ID: r.ID, HolderID: r.HolderID, Kind: authctx.CredentialKind(r.Kind), Name: r.Name,
			Grants: toActions(r.Grants), Bounded: r.Bounded, SpaceIDs: r.BoundSpaces, ChannelIDs: r.BoundChannels,
			Hint: r.Hint, CreatedAt: r.CreatedAt, LastUsedAt: r.LastUsedAt,
		}
	}
	return out, nil
}

// CountCredentials is how many tokens and hooks a bot still holds.
func (s *Service) CountCredentials(ctx context.Context, holderID string) (int64, error) {
	return s.q.CountBotCredentials(ctx, holderID)
}

// VerifyHookToken resolves the token in a hook URL. Any other kind of
// credential is refused, as a hook token is everywhere else.
func (s *Service) VerifyHookToken(ctx context.Context, token string) (authctx.Identity, error) {
	id, err := s.verify(ctx, token, true)
	if err != nil {
		return authctx.Identity{}, err
	}
	if id.Credential.Kind != authctx.CredentialIncomingHook {
		return authctx.Identity{}, errors.New("not a hook token")
	}
	return id, nil
}

func newToken(prefix string) (secret string, hash []byte, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, err
	}
	secret = prefix + base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(secret))
	return secret, sum[:], nil
}

func channelList(id string) []string {
	if id == "" {
		return nil
	}
	return []string{id}
}

func toBot(u dbgen.User) Bot {
	return Bot{
		ID: u.ID, Username: u.Username, DisplayName: u.DisplayName, AvatarFileID: deref(u.AvatarFileID), Bio: u.Bio,
		CreatedAt: u.CreatedAt, DeactivatedAt: u.DeactivatedAt,
	}
}
