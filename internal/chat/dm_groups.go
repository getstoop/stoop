package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// Group conversations: a direct message with more than two people. A
// group carries no dm_key — it is not identified by who is in it, because
// people are added and leave — so opening "the same" group twice is two
// conversations. See docs/architecture/messaging.md → Direct messages.

// maxDMParticipants caps a conversation, the caller included. Past ten the
// thing being asked for is a space.
const maxDMParticipants = 10

var errTooManyParticipants = connect.NewError(connect.CodeFailedPrecondition,
	fmt.Errorf("a conversation holds %d people; make a space for anything bigger", maxDMParticipants))

// A 1:1 is its two people: there is nobody to add and nothing to leave.
// Bringing a third in means starting a group with all three, which is a
// different conversation; getting out means blocking, or deleting what
// you said.
var errNotAGroup = connect.NewError(connect.CodeInvalidArgument,
	errors.New("a one-to-one conversation's members can't be changed"))

// isPairDM: a 1:1, identified by its two ids. A group has no key.
func isPairDM(c dbgen.Channel) bool { return c.DmKey != nil }

func (s *Service) CreateGroupDirectMessage(ctx context.Context, req *connect.Request[chatv1.CreateGroupDirectMessageRequest]) (*connect.Response[chatv1.CreateGroupDirectMessageResponse], error) {
	me := authctx.UserID(ctx)
	others, err := s.dmTargets(ctx, me, req.Msg.UserIds, nil)
	if err != nil {
		return nil, err
	}
	if len(others) < 2 {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("a group conversation needs at least two other people"))
	}
	if err := s.checkNoBlocks(ctx, others, append([]string{me}, others...)); err != nil {
		return nil, err
	}
	participants := append([]string{me}, others...)
	channel, err := s.createGroup(ctx, participants)
	if err != nil {
		return nil, err
	}
	// New for everyone, the creator's other tabs included.
	dm, err := s.announceGroup(ctx, channel, participants, participants)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.CreateGroupDirectMessageResponse{DirectMessage: dm}), nil
}

func (s *Service) AddDirectMessageMembers(ctx context.Context, req *connect.Request[chatv1.AddDirectMessageMembersRequest]) (*connect.Response[chatv1.AddDirectMessageMembersResponse], error) {
	me := authctx.UserID(ctx)
	channel, err := s.accessChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	if !isDM(channel) || isPairDM(channel) {
		return nil, errNotAGroup
	}
	current, err := s.q.ListDMMembers(ctx, channel.ID)
	if err != nil {
		return nil, fmt.Errorf("list participants: %w", err)
	}
	added, err := s.dmTargets(ctx, me, req.Msg.UserIds, current)
	if err != nil {
		return nil, err
	}
	if len(added) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("those people are already in this conversation"))
	}
	final := append(append([]string{}, current...), added...)
	if len(final) > maxDMParticipants {
		return nil, errTooManyParticipants
	}
	if err := s.checkNoBlocks(ctx, added, final); err != nil {
		return nil, err
	}

	if err := s.addMembers(ctx, channel.ID, added); err != nil {
		return nil, err
	}
	dm, err := s.announceGroup(ctx, channel, final, added)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.AddDirectMessageMembersResponse{DirectMessage: dm}), nil
}

func (s *Service) LeaveDirectMessage(ctx context.Context, req *connect.Request[chatv1.LeaveDirectMessageRequest]) (*connect.Response[chatv1.LeaveDirectMessageResponse], error) {
	me := authctx.UserID(ctx)
	channel, err := s.accessChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	if !isDM(channel) || isPairDM(channel) {
		return nil, errNotAGroup
	}
	if err := s.q.RemoveDMMember(ctx, dbgen.RemoveDMMemberParams{ChannelID: channel.ID, UserID: me}); err != nil {
		return nil, fmt.Errorf("leave conversation: %w", err)
	}
	left, err := s.q.CountDMMembers(ctx, channel.ID)
	if err != nil {
		return nil, fmt.Errorf("count participants: %w", err)
	}
	// The last person out takes the conversation with them; the cascades
	// drop its messages, reads, reactions and attachments.
	if left == 0 {
		if err := s.q.DeleteChannel(ctx, channel.ID); err != nil {
			return nil, fmt.Errorf("delete conversation: %w", err)
		}
	} else if _, err := s.announceGroup(ctx, channel, nil, nil); err != nil {
		return nil, err
	}
	s.bus.Publish("user:"+me, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelDeleted{
			ChannelDeleted: &realtimev1.ChannelDeleted{ChannelId: channel.ID},
		},
	}))
	return connect.NewResponse(&chatv1.LeaveDirectMessageResponse{}), nil
}

// addMembers re-counts inside the transaction that inserts, so a caller
// cannot read nine and then write on a count that has moved. Two adds at
// once can still both pass under READ COMMITTED and land at eleven; the
// overshoot is bounded by the number of concurrent adders and nothing
// downstream cares, which is the trade the pin cap makes too.
func (s *Service) addMembers(ctx context.Context, channelID string, added []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)
	have, err := qtx.CountDMMembers(ctx, channelID)
	if err != nil {
		return fmt.Errorf("count participants: %w", err)
	}
	if int(have)+len(added) > maxDMParticipants {
		return errTooManyParticipants
	}
	for _, id := range added {
		if err := qtx.AddDMMember(ctx, dbgen.AddDMMemberParams{ChannelID: channelID, UserID: id}); err != nil {
			return fmt.Errorf("add participant: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// createGroup writes the channel and its participants in one transaction.
func (s *Service) createGroup(ctx context.Context, participants []string) (dbgen.Channel, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return dbgen.Channel{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)
	channel, err := qtx.CreateGroupDMChannel(ctx, newID())
	if err != nil {
		return dbgen.Channel{}, fmt.Errorf("create group: %w", err)
	}
	for _, id := range participants {
		if err := qtx.AddDMMember(ctx, dbgen.AddDMMemberParams{ChannelID: channel.ID, UserID: id}); err != nil {
			return dbgen.Channel{}, fmt.Errorf("add participant: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return dbgen.Channel{}, fmt.Errorf("commit: %w", err)
	}
	return channel, nil
}

// announceGroup renders the conversation and tells its people about it: the
// new participant list to everyone still in it, and ChannelCreated to
// whoever it is new for. Passing nil for either skips that audience;
// the current membership is read back when `participants` is nil.
func (s *Service) announceGroup(ctx context.Context, channel dbgen.Channel, participants, fresh []string) (*chatv1.DirectMessage, error) {
	dms, err := s.directMessages(ctx, []dbgen.ListDMChannelsByUserRow{{Channel: channel}})
	if err != nil {
		return nil, err
	}
	dm := dms[0]
	if participants == nil {
		for _, p := range dm.Participants {
			participants = append(participants, p.Id)
		}
	}
	changed := events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_DirectMessageMembersChanged{
			DirectMessageMembersChanged: &realtimev1.DirectMessageMembersChanged{
				ChannelId: channel.ID, Participants: dm.Participants,
			},
		},
	})
	for _, id := range participants {
		s.bus.Publish("user:"+id, changed)
	}
	created := events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelCreated{ChannelCreated: toProtoChannel(channel)},
	})
	for _, id := range fresh {
		s.bus.Publish("user:"+id, created)
	}
	return dm, nil
}

// dmTargets validates the people a caller wants in a conversation: real
// accounts, not the caller, not already there, and each one the caller
// could message directly. Order is the request's, deduplicated.
func (s *Service) dmTargets(ctx context.Context, me string, ids, exclude []string) ([]string, error) {
	skip := map[string]bool{me: true}
	for _, id := range exclude {
		skip[id] = true
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_ids holds an empty id"))
		}
		if skip[id] {
			continue
		}
		skip[id] = true
		out = append(out, id)
	}
	if len(out) == 0 {
		return out, nil
	}
	if len(out) >= maxDMParticipants {
		return nil, errTooManyParticipants
	}
	records, err := s.users.GetUsers(ctx, out)
	if err != nil {
		return nil, fmt.Errorf("look up users: %w", err)
	}
	if len(records) != len(out) {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
	}
	// Eligibility before anything else: someone you don't share a space
	// with is "not reachable" whether or not the id is real.
	if !authctx.IsAdmin(ctx) {
		reachable, err := s.q.SharesSpaceAmong(ctx, dbgen.SharesSpaceAmongParams{UserID: me, Ids: out})
		if err != nil {
			return nil, fmt.Errorf("check shared spaces: %w", err)
		}
		if len(reachable) != len(out) {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("you can only message people you share a space with"))
		}
	}
	return out, nil
}

// checkNoBlocks refuses to put a newcomer in a room with anyone they have
// blocked, or who has blocked them. Blocks made afterwards do not dissolve
// a group; the way out of one is to leave.
func (s *Service) checkNoBlocks(ctx context.Context, added, everyone []string) error {
	for _, id := range added {
		others := make([]string, 0, len(everyone))
		for _, other := range everyone {
			if other != id {
				others = append(others, other)
			}
		}
		if len(others) == 0 {
			continue
		}
		hits, err := s.q.BlockedAmong(ctx, dbgen.BlockedAmongParams{UserID: id, Ids: others})
		if err != nil {
			return fmt.Errorf("check blocks: %w", err)
		}
		if len(hits) > 0 {
			return errBlocked
		}
	}
	return nil
}
