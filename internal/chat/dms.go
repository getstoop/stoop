package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/Jhut89/stoop/gen/stoop/realtime/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/dbgen"
	"github.com/Jhut89/stoop/internal/events"
)

// Direct messages are channels with no space (kind DM), their people in
// dm_members. The message RPCs don't know the difference: they read the
// channel through accessChannel and publish through publishChannel, and
// those two are where a DM and a space channel part ways. See
// docs/architecture/messaging.md → Direct messages.

func isDM(c dbgen.Channel) bool { return c.SpaceID == nil }

// spaceOf is the channel's space id, "" for a direct message. Events and
// protos carry that "" so clients can tell the two apart.
func spaceOf(c dbgen.Channel) string {
	if c.SpaceID == nil {
		return ""
	}
	return *c.SpaceID
}

// dmKey is the identity of a 1:1 DM: both ids in a fixed order.
func dmKey(a, b string) string {
	if b < a {
		a, b = b, a
	}
	return a + ":" + b
}

// accessChannel loads a channel the caller may read: a member of its
// space, or a participant in the direct message. Membership is checked
// before the row is read so an outsider learns nothing from the error.
func (s *Service) accessChannel(ctx context.Context, channelID string) (dbgen.Channel, error) {
	if err := s.requireChannelMember(ctx, channelID); err != nil {
		return dbgen.Channel{}, err
	}
	channel, err := s.q.GetChannel(ctx, channelID)
	if err != nil {
		return dbgen.Channel{}, notFoundOr(err, "channel")
	}
	return channel, nil
}

// writableChannel loads a channel the caller may write in: accessChannel,
// plus the block rule in a direct message. Every RPC that adds to or
// changes what the other side sees — send, edit, react — goes through
// this one, so a kick, a ban or a block stops all three together.
func (s *Service) writableChannel(ctx context.Context, channelID string) (dbgen.Channel, error) {
	channel, err := s.accessChannel(ctx, channelID)
	if err != nil {
		return dbgen.Channel{}, err
	}
	if isDM(channel) {
		blocked, err := s.dmBlocked(ctx, channel, authctx.UserID(ctx))
		if err != nil {
			return dbgen.Channel{}, err
		}
		if blocked {
			return dbgen.Channel{}, errBlocked
		}
	}
	return channel, nil
}

// publishChannel delivers an event to everyone who can see the channel:
// the space's topic, or each DM participant's personal topic (which
// every connection already subscribes to, so the gateway needs no DM
// bookkeeping).
func (s *Service) publishChannel(ctx context.Context, channel dbgen.Channel, ev *realtimev1.ServerEvent) {
	if !isDM(channel) {
		s.bus.Publish("space:"+*channel.SpaceID, ev)
		return
	}
	ids, err := s.q.ListDMMembers(ctx, channel.ID)
	if err != nil {
		slog.Default().Warn("dm: could not list participants for event", "channel_id", channel.ID, "err", err)
		return
	}
	for _, id := range ids {
		s.bus.Publish("user:"+id, ev)
	}
}

// DMParticipants implements the realtime gateway's channel port: who is
// in a direct message, or nil for any other channel.
func (s *Service) DMParticipants(ctx context.Context, channelID string) ([]string, error) {
	channel, err := s.q.GetChannel(ctx, channelID)
	if err != nil {
		return nil, nil //nolint:nilerr // unknown channel: nobody
	}
	if !isDM(channel) {
		return nil, nil
	}
	return s.q.ListDMMembers(ctx, channel.ID)
}

// IsAttachmentReadable implements the files module's download rule for
// attachments without a space: the file hangs off a message in a
// channel the user can read.
func (s *Service) IsAttachmentReadable(ctx context.Context, userID, fileID string) (bool, error) {
	return s.q.IsAttachmentReadable(ctx, dbgen.IsAttachmentReadableParams{FileID: fileID, UserID: userID})
}

func (s *Service) OpenDirectMessage(ctx context.Context, req *connect.Request[chatv1.OpenDirectMessageRequest]) (*connect.Response[chatv1.OpenDirectMessageResponse], error) {
	me := authctx.UserID(ctx)
	other := req.Msg.UserId
	if other == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_id is required"))
	}
	if other == me {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("you can't message yourself"))
	}
	// Eligibility before existence: someone you don't share a space with
	// is "not reachable" whether or not the id is real.
	if !authctx.IsAdmin(ctx) {
		shares, err := s.q.SharesSpace(ctx, dbgen.SharesSpaceParams{UserID: me, UserID_2: other})
		if err != nil {
			return nil, fmt.Errorf("check shared space: %w", err)
		}
		if !shares {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("you can only message people you share a space with"))
		}
	}
	records, err := s.users.GetUsers(ctx, []string{other})
	if err != nil {
		return nil, fmt.Errorf("look up user: %w", err)
	}
	if len(records) == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
	}
	if blocked, err := s.blockedBetween(ctx, me, other); err != nil {
		return nil, err
	} else if blocked {
		return nil, errBlocked
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)
	id := newID()
	channel, err := qtx.OpenDMChannel(ctx, dbgen.OpenDMChannelParams{ID: id, DmKey: &[]string{dmKey(me, other)}[0]})
	if err != nil {
		return nil, fmt.Errorf("open dm: %w", err)
	}
	for _, uid := range []string{me, other} {
		if err := qtx.AddDMMember(ctx, dbgen.AddDMMemberParams{ChannelID: channel.ID, UserID: uid}); err != nil {
			return nil, fmt.Errorf("add participant: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	// A brand-new conversation shows up in both people's lists at once.
	if channel.ID == id {
		s.publishChannel(ctx, channel, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_ChannelCreated{ChannelCreated: toProtoChannel(channel)},
		}))
	}
	dms, err := s.directMessages(ctx, []dbgen.ListDMChannelsByUserRow{{Channel: channel}})
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.OpenDirectMessageResponse{DirectMessage: dms[0]}), nil
}

func (s *Service) ListDirectMessages(ctx context.Context, _ *connect.Request[chatv1.ListDirectMessagesRequest]) (*connect.Response[chatv1.ListDirectMessagesResponse], error) {
	rows, err := s.q.ListDMChannelsByUser(ctx, authctx.UserID(ctx))
	if err != nil {
		return nil, fmt.Errorf("list dms: %w", err)
	}
	dms, err := s.directMessages(ctx, rows)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.ListDirectMessagesResponse{DirectMessages: dms}), nil
}

// directMessages renders DM rows with their participants resolved.
func (s *Service) directMessages(ctx context.Context, rows []dbgen.ListDMChannelsByUserRow) ([]*chatv1.DirectMessage, error) {
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.Channel.ID
	}
	members, err := s.q.ListDMMembersForChannels(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("list participants: %w", err)
	}
	var userIDs []string
	seen := map[string]bool{}
	byChannel := map[string][]string{}
	for _, m := range members {
		byChannel[m.ChannelID] = append(byChannel[m.ChannelID], m.UserID)
		if !seen[m.UserID] {
			seen[m.UserID] = true
			userIDs = append(userIDs, m.UserID)
		}
	}
	authors, err := s.resolveAuthors(ctx, userIDs)
	if err != nil {
		return nil, err
	}
	out := make([]*chatv1.DirectMessage, len(rows))
	for i, r := range rows {
		channel := toProtoChannel(r.Channel)
		if r.LastReadMessageID != nil {
			channel.LastReadMessageId = *r.LastReadMessageID
		}
		channel.UnreadCount = int32(r.UnreadCount)
		channel.Muted = r.Muted
		dm := &chatv1.DirectMessage{Channel: channel}
		for _, uid := range byChannel[r.Channel.ID] {
			if a := authors[uid]; a != nil {
				dm.Participants = append(dm.Participants, a)
			} else {
				dm.Participants = append(dm.Participants, &chatv1.MessageAuthor{Id: uid, Username: "unknown"})
			}
		}
		out[i] = dm
	}
	return out, nil
}
