package chat

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Starting a 1:1 begins from somebody's face — a message, the member list,
// a profile card. Starting a group begins from nobody, so the client needs
// a list to pick from, and it cannot assemble one itself: that would mean
// the member list of every space the caller is in.

// dmCandidateLimit bounds the picker. An instance with more people than
// this in one person's reach wants a search, not a list.
const dmCandidateLimit = 500

func (s *Service) ListDirectMessageCandidates(ctx context.Context, _ *connect.Request[chatv1.ListDirectMessageCandidatesRequest]) (*connect.Response[chatv1.ListDirectMessageCandidatesResponse], error) {
	ids, err := s.q.ListDMCandidates(ctx, dbgen.ListDMCandidatesParams{
		UserID: authctx.UserID(ctx), Lim: dmCandidateLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("list candidates: %w", err)
	}
	authors, err := s.resolveAuthors(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]*chatv1.MessageAuthor, 0, len(ids))
	for _, id := range ids {
		if a := authors[id]; a != nil {
			out = append(out, a)
		}
	}
	return connect.NewResponse(&chatv1.ListDirectMessageCandidatesResponse{Users: out}), nil
}
