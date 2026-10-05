package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
)

const (
	defaultSearchPage = 25
	maxSearchPage     = 50
	// searchTimeout bounds one search's time in Postgres.
	searchTimeout = 2 * time.Second
)

// Throttle is chat's port onto a rate limiter, keyed per user for
// search. Nil means unlimited. An error means the limiter could not
// answer, and the search is refused.
type Throttle interface {
	Allow(ctx context.Context, key string) (bool, error)
}

// UseSearchThrottle wires the per-user search limiter.
func (s *Service) UseSearchThrottle(t Throttle) { s.searchThrottle = t }

func (s *Service) SearchMessages(ctx context.Context, req *connect.Request[chatv1.SearchMessagesRequest]) (*connect.Response[chatv1.SearchMessagesResponse], error) {
	spaceID := req.Msg.GetSpaceId()
	if spaceID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("space_id is required"))
	}
	if err := s.requireSpaceMember(ctx, spaceID); err != nil {
		return nil, err
	}
	userID := authctx.UserID(ctx)
	if s.searchThrottle != nil {
		allowed, err := s.searchThrottle.Allow(ctx, userID)
		if err != nil {
			return nil, connect.NewError(connect.CodeUnavailable, errors.New("search is unavailable right now; try again in a moment"))
		}
		if !allowed {
			err := connect.NewError(connect.CodeResourceExhausted, errors.New("too many searches; try again in a minute"))
			err.Meta().Set("Retry-After", "60")
			return nil, err
		}
	}
	q, err := parseSearchQuery(req.Msg.Query)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	limit := clampPageSize(req.Msg.Limit, defaultSearchPage, maxSearchPage)

	withVoice, err := s.voiceOn(ctx, spaceID)
	if err != nil {
		return nil, err
	}
	params := dbgen.SearchMessagesParams{
		SpaceID: spaceID, Words: q.words, Prefix: q.prefix, Lim: limit,
		BeforeAt: q.before, AfterAt: q.after, WithVoice: withVoice,
	}
	if req.Msg.BeforeId != "" {
		params.BeforeID = &req.Msg.BeforeId
	}
	if q.in != "" {
		channel, err := s.q.GetChannelInSpaceByName(ctx, dbgen.GetChannelInSpaceByNameParams{SpaceID: spaceID, Name: q.in})
		if err != nil {
			return nil, apierr.NotFoundOr(err, "channel")
		}
		params.ChannelID = &channel.ID
	}
	if q.from != "" {
		id, err := s.memberIDByHandle(ctx, spaceID, q.from)
		if err != nil {
			return nil, err
		}
		params.AuthorID = &id
	}

	rows, err := s.searchWithTimeout(ctx, params)
	if err != nil {
		return nil, err
	}
	messages, err := s.hydrateMessages(ctx, spaceID, rows)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.SearchMessagesResponse{
		Messages: messages, HasOlder: int32(len(rows)) == limit,
	}), nil
}

// searchWithTimeout runs the search under a statement timeout, so one
// pathological query cannot hold a connection. A timeout is reported as
// DeadlineExceeded for the client to word.
func (s *Service) searchWithTimeout(ctx context.Context, params dbgen.SearchMessagesParams) ([]dbgen.MessageWithReply, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL statement_timeout = %d", searchTimeout.Milliseconds())); err != nil {
		return nil, fmt.Errorf("set timeout: %w", err)
	}
	found, err := s.q.WithTx(tx).SearchMessages(ctx, params)
	if err != nil {
		if db.HasCode(err, db.QueryCanceled) {
			return nil, connect.NewError(connect.CodeDeadlineExceeded, errors.New("that search took too long; add a channel or a word"))
		}
		return nil, fmt.Errorf("search messages: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return found, nil
}

// memberIDByHandle resolves a from: filter to a member of the space, the
// way mentions do. NotFound for anyone else, members of other spaces
// included, so a handle cannot be probed.
func (s *Service) memberIDByHandle(ctx context.Context, spaceID, handle string) (string, error) {
	members, err := s.q.ListSpaceMembers(ctx, spaceID)
	if err != nil {
		return "", fmt.Errorf("list members: %w", err)
	}
	ids := make([]string, len(members))
	for i, m := range members {
		ids[i] = m.UserID
	}
	records, err := s.users.GetUsers(ctx, ids)
	if err != nil {
		return "", fmt.Errorf("resolve members: %w", err)
	}
	for _, r := range records {
		if strings.EqualFold(r.Username, handle) {
			return r.ID, nil
		}
	}
	return "", connect.NewError(connect.CodeNotFound, errors.New("user not found"))
}
