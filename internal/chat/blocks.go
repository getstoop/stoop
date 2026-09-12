package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Blocks. One person's decision about another: no direct messages in
// either direction, every conversation they are both in hidden from the
// blocker's list, and no mention/reply/DM alerts from the blocked person
// — the ones already in the feed are deleted, not just stopped. Anyone
// can block anyone; it says nothing to the blocked side beyond a DM being
// refused, so only the blocker's own view changes.

// The refusals a block produces. None of them says who blocked whom, or
// which way round; a block is not announced to the side it lands on.
// "This person" is only true of a conversation with two people in it —
// in a group the block may be with any of several, and naming which would
// be naming them.
var (
	errBlocked = connect.NewError(connect.CodePermissionDenied,
		errors.New("you can't message this person"))
	errBlockedGroupOpen = connect.NewError(connect.CodePermissionDenied,
		errors.New("you can't start a conversation with these people"))
	errBlockedGroupSend = connect.NewError(connect.CodePermissionDenied,
		errors.New("you can't send messages in this conversation"))
)

func (s *Service) BlockUser(ctx context.Context, req *connect.Request[chatv1.BlockUserRequest]) (*connect.Response[chatv1.BlockUserResponse], error) {
	me := authctx.UserID(ctx)
	if req.Msg.UserId == "" || req.Msg.UserId == me {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("pick someone else to block"))
	}
	users, err := s.users.GetUsers(ctx, []string{req.Msg.UserId})
	if err != nil {
		return nil, fmt.Errorf("look up user: %w", err)
	}
	if len(users) == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
	}
	if err := s.q.BlockUser(ctx, dbgen.BlockUserParams{BlockerID: me, BlockedID: req.Msg.UserId}); err != nil {
		return nil, fmt.Errorf("block: %w", err)
	}
	// The alerts have to go with the conversation. Blocking hides every
	// direct message they are in, so an unread item pointing at one would
	// leave a badge with nothing behind it to open and mark read.
	if _, err := s.q.DeleteActivityForBlocked(ctx, dbgen.DeleteActivityForBlockedParams{
		UserID: me, BlockedID: req.Msg.UserId,
	}); err != nil {
		return nil, fmt.Errorf("clear their activity: %w", err)
	}
	return connect.NewResponse(&chatv1.BlockUserResponse{}), nil
}

func (s *Service) UnblockUser(ctx context.Context, req *connect.Request[chatv1.UnblockUserRequest]) (*connect.Response[chatv1.UnblockUserResponse], error) {
	if _, err := s.q.UnblockUser(ctx, dbgen.UnblockUserParams{BlockerID: authctx.UserID(ctx), BlockedID: req.Msg.UserId}); err != nil {
		return nil, fmt.Errorf("unblock: %w", err)
	}
	return connect.NewResponse(&chatv1.UnblockUserResponse{}), nil
}

func (s *Service) ListBlockedUsers(ctx context.Context, _ *connect.Request[chatv1.ListBlockedUsersRequest]) (*connect.Response[chatv1.ListBlockedUsersResponse], error) {
	ids, err := s.q.ListBlockedUserIDs(ctx, authctx.UserID(ctx))
	if err != nil {
		return nil, fmt.Errorf("list blocks: %w", err)
	}
	authors, err := s.resolveAuthors(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]*chatv1.MessageAuthor, 0, len(ids))
	for _, id := range ids {
		if a := authors[id]; a != nil {
			out = append(out, a)
		} else {
			out = append(out, &chatv1.MessageAuthor{Id: id, Username: "unknown"})
		}
	}
	return connect.NewResponse(&chatv1.ListBlockedUsersResponse{Users: out}), nil
}

// blockedBetween: does either of the two block the other?
func (s *Service) blockedBetween(ctx context.Context, a, b string) (bool, error) {
	return s.q.BlockedEitherWay(ctx, dbgen.BlockedEitherWayParams{BlockerID: a, BlockedID: b})
}

// dmBlocked: is userID blocked by, or blocking, anyone else in the
// conversation? One rule for two people or ten — a conversation holding
// somebody you blocked is one you can neither see nor write in.
func (s *Service) dmBlocked(ctx context.Context, channel dbgen.Channel, userID string) (bool, error) {
	ids, err := s.q.ListDMMembers(ctx, channel.ID)
	if err != nil {
		return false, fmt.Errorf("list participants: %w", err)
	}
	for _, id := range ids {
		if id == userID {
			continue
		}
		blocked, err := s.blockedBetween(ctx, userID, id)
		if err != nil || blocked {
			return blocked, err
		}
	}
	return false, nil
}

// withoutBlockers drops the recipients who have blocked authorID: their
// alerts from that person are not delivered.
func (s *Service) withoutBlockers(ctx context.Context, authorID string, ids []string) ([]string, error) {
	if len(ids) == 0 {
		return ids, nil
	}
	blockers, err := s.q.BlockersAmong(ctx, dbgen.BlockersAmongParams{UserID: authorID, Ids: ids})
	if err != nil {
		return nil, fmt.Errorf("check blocks: %w", err)
	}
	if len(blockers) == 0 {
		return ids, nil
	}
	skip := make(map[string]bool, len(blockers))
	for _, b := range blockers {
		skip[b] = true
	}
	out := ids[:0:0]
	for _, id := range ids {
		if !skip[id] {
			out = append(out, id)
		}
	}
	return out, nil
}
