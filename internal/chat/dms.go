package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/rowid"
	"github.com/getstoop/stoop/internal/text"
)

// Direct messages: see docs/architecture/messaging.md → Direct messages.
// The message RPCs reach them through channel_access.go.

// maxDMParticipants caps a conversation, the caller included. Past ten the
// thing being asked for is a space.
const maxDMParticipants = 10

// dmKey is the identity of a conversation: everyone in it, in a fixed
// order. Two people or ten, the same rule — which is what makes "open the
// conversation with these people" answer with the one that exists.
func dmKey(ids []string) string {
	sorted := append([]string{}, ids...)
	slices.Sort(sorted)
	return strings.Join(sorted, ":")
}

// ChannelPeople implements the realtime gateway's channel port. listed
// says the channel has a people list, as a direct message and a private
// channel do, and people is who is on it, which may be nobody. A public
// channel is not listed. An id that names no channel is listed with
// nobody on it, so nothing about it is relayed anywhere.
func (s *Service) ChannelPeople(ctx context.Context, channelID string) (people []string, listed bool, err error) {
	channel, err := s.q.GetChannel(ctx, channelID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, true, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("look up channel: %w", err)
	}
	if !isDM(channel) && !channel.Private {
		return nil, false, nil
	}
	people, err = s.people(ctx, channel)
	return people, true, err
}

// IsAttachmentReadable implements the files module's download rule for
// attachments without a space: the file hangs off a message in a
// channel the user can read.
func (s *Service) IsAttachmentReadable(ctx context.Context, userID, fileID string) (bool, error) {
	return s.q.IsAttachmentReadable(ctx, dbgen.IsAttachmentReadableParams{FileID: fileID, UserID: userID})
}

func (s *Service) OpenDirectMessage(ctx context.Context, req *connect.Request[chatv1.OpenDirectMessageRequest]) (*connect.Response[chatv1.OpenDirectMessageResponse], error) {
	// Bots and direct messages are a later feature, with consent in it;
	// until then a bot neither receives one (dmTargets) nor opens one.
	if err := refuseBot(ctx, "bots can't open direct messages"); err != nil {
		return nil, err
	}
	me := authctx.UserID(ctx)
	others, err := s.dmTargets(ctx, me, req.Msg.UserIds)
	if err != nil {
		return nil, err
	}
	participants := append([]string{me}, others...)
	if err := s.checkNoBlocks(ctx, participants); err != nil {
		return nil, err
	}

	var id string
	var channel dbgen.Channel
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		id = rowid.New()
		key := dmKey(participants)
		var err error
		channel, err = qtx.OpenDMChannel(ctx, dbgen.OpenDMChannelParams{ID: id, DmKey: &key})
		if err != nil {
			return fmt.Errorf("open dm: %w", err)
		}
		for _, uid := range participants {
			if err := qtx.AddDMMember(ctx, dbgen.AddDMMemberParams{ChannelID: channel.ID, UserID: uid}); err != nil {
				return fmt.Errorf("add participant: %w", err)
			}
		}
		// Opening a conversation the caller had closed puts it back on their
		// list; nobody else's row is touched.
		if err := qtx.SetDMClosed(ctx, dbgen.SetDMClosedParams{ChannelID: channel.ID, UserID: me, Closed: false}); err != nil {
			return fmt.Errorf("reopen dm: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	// A brand-new conversation shows up in everyone's list at once. An
	// existing one needs no announcement: they all already have it.
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

// SetDirectMessageClosed takes a conversation off the caller's own list,
// or puts it back. Closing is list grooming and nothing more: nobody
// else's list changes, membership never changes, and reopenDM brings it
// back for everyone the moment someone writes.
func (s *Service) SetDirectMessageClosed(ctx context.Context, req *connect.Request[chatv1.SetDirectMessageClosedRequest]) (*connect.Response[chatv1.SetDirectMessageClosedResponse], error) {
	me := authctx.UserID(ctx)
	channel, err := s.q.GetChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, apierr.NotFoundOr(err, "conversation")
	}
	if !isDM(channel) {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("conversation not found"))
	}
	isMember, err := s.q.IsDMMember(ctx, dbgen.IsDMMemberParams{ChannelID: channel.ID, UserID: me})
	if err != nil {
		return nil, fmt.Errorf("check participant: %w", err)
	}
	if !isMember {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("conversation not found"))
	}
	if err := s.q.SetDMClosed(ctx, dbgen.SetDMClosedParams{ChannelID: channel.ID, UserID: me, Closed: req.Msg.Closed}); err != nil {
		return nil, fmt.Errorf("close dm: %w", err)
	}
	rows, err := s.q.ListDMChannelsByUser(ctx, me)
	if err != nil {
		return nil, fmt.Errorf("list dms: %w", err)
	}
	for _, r := range rows {
		if r.Channel.ID == channel.ID {
			dms, err := s.directMessages(ctx, []dbgen.ListDMChannelsByUserRow{r})
			if err != nil {
				return nil, err
			}
			return connect.NewResponse(&chatv1.SetDirectMessageClosedResponse{DirectMessage: dms[0]}), nil
		}
	}
	return nil, connect.NewError(connect.CodeNotFound, errors.New("conversation not found"))
}

// reopenDM puts a conversation back on every list it had been closed off,
// and tells those people, the way a new conversation is told: their
// client refetches its list on ChannelCreated.
func (s *Service) reopenDM(ctx context.Context, channel dbgen.Channel) {
	reopened, err := s.q.ReopenDM(ctx, channel.ID)
	if err != nil {
		slog.Default().Warn("dm: could not reopen", "channel_id", channel.ID, "err", err)
		return
	}
	for _, uid := range reopened {
		s.bus.Publish(events.UserTopic(uid), events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_ChannelCreated{ChannelCreated: toProtoChannel(channel)},
		}))
	}
}

// dmTargets validates the people a caller wants to talk to: real accounts,
// not the caller, and each one the caller could message. Deduplicated, so
// the same person twice is the same conversation.
func (s *Service) dmTargets(ctx context.Context, me string, ids []string) ([]string, error) {
	seen := map[string]bool{me: true}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_ids holds an empty id"))
		}
		if id == me {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("you can't message yourself"))
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	if len(out) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_ids is required"))
	}
	if len(out) >= maxDMParticipants {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("a conversation holds %d people; make a space for anything bigger", maxDMParticipants))
	}
	users, err := s.usersByID(ctx, out)
	if err != nil {
		return nil, fmt.Errorf("look up users: %w", err)
	}
	if len(users) != len(out) {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
	}
	for _, user := range users {
		if user.Kind == authctx.KindBot {
			return nil, connect.NewError(connect.CodePermissionDenied, errors.New("bots can't be messaged directly"))
		}
	}
	// Eligibility before existence: someone you don't share a space with
	// is "not reachable" whether or not the id is real.
	if !authctx.Allows(ctx, authctx.DMsReachAnyone) {
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

// blockRefusal picks the wording for a conversation of this size: "this
// person" only means something when there is exactly one other.
func blockRefusal(participants int, group *connect.Error) *connect.Error {
	if participants > 2 {
		return group
	}
	return errBlocked
}

// checkNoBlocks refuses a conversation holding anyone who has blocked, or
// is blocked by, anyone else in it: every pair, not just the caller's
// (messaging.md → Direct messages).
func (s *Service) checkNoBlocks(ctx context.Context, everyone []string) error {
	for i, id := range everyone {
		others := append(append([]string{}, everyone[:i]...), everyone[i+1:]...)
		hits, err := s.q.BlockedAmong(ctx, dbgen.BlockedAmongParams{UserID: id, Ids: others})
		if err != nil {
			return fmt.Errorf("check blocks: %w", err)
		}
		if len(hits) > 0 {
			return blockRefusal(len(everyone), errBlockedGroupOpen)
		}
	}
	return nil
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
	// The line quotes a message, so it needs the read grant: opening a
	// conversation asks only dms.post, and closing one preferences.manage.
	var lastIDs []string
	if authctx.Covers(ctx, authctx.DMsRead) {
		for _, row := range rows {
			if row.Channel.LastMessageID != nil {
				lastIDs = append(lastIDs, *row.Channel.LastMessageID)
			}
		}
	}
	last, err := s.dmLastMessages(ctx, lastIDs, authors)
	if err != nil {
		return nil, err
	}
	out := make([]*chatv1.DirectMessage, len(rows))
	for i, row := range rows {
		channel := toProtoChannel(row.Channel)
		if row.LastReadMessageID != nil {
			channel.LastReadMessageId = *row.LastReadMessageID
		}
		channel.UnreadCount = int32(row.UnreadCount)
		channel.Muted = row.Muted
		dm := &chatv1.DirectMessage{Channel: channel, Closed: row.ClosedAt != nil, LastMessage: last[row.Channel.ID]}
		for _, participantID := range byChannel[row.Channel.ID] {
			dm.Participants = append(dm.Participants, authorOrUnknown(authors, participantID))
		}
		out[i] = dm
	}
	return out, nil
}

// dmLastMessages is each conversation's newest message as the list's
// preview line, by channel ID, previewed as an activity item is: mentions
// as names, the first file's name when there is no text. The author is
// a participant (membership never changes), so authors already has them.
func (s *Service) dmLastMessages(ctx context.Context, messageIDs []string, authors map[string]*chatv1.MessageAuthor) (map[string]*chatv1.DirectMessageLast, error) {
	if len(messageIDs) == 0 {
		return nil, nil
	}
	messages, err := s.q.ListDMLastMessages(ctx, dbgen.ListDMLastMessagesParams{UserID: authctx.UserID(ctx), MessageIds: messageIDs})
	if err != nil {
		return nil, fmt.Errorf("list last messages: %w", err)
	}
	var fileIDs, contents []string
	for _, msg := range messages {
		if msg.FirstFileID != "" {
			fileIDs = append(fileIDs, msg.FirstFileID)
		}
		contents = append(contents, msg.Content)
	}
	files, err := s.fileRecords(ctx, fileIDs)
	if err != nil {
		return nil, err
	}
	names, err := s.mentionNames(ctx, contents...)
	if err != nil {
		return nil, err
	}
	out := make(map[string]*chatv1.DirectMessageLast, len(messages))
	for _, msg := range messages {
		last := &chatv1.DirectMessageLast{
			MessageId: msg.ID, Author: authorOrUnknown(authors, msg.AuthorID),
			Deleted: msg.Deleted, CreatedAt: timestamppb.New(msg.CreatedAt),
		}
		if !msg.Deleted {
			last.Preview = text.Truncate(previewText(names.current(msg.Content), files[msg.FirstFileID].label()), previewLen)
		}
		out[msg.ChannelID] = last
	}
	return out, nil
}
