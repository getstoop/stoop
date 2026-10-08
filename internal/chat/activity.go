package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/pbtime"
	"github.com/getstoop/stoop/internal/rowid"
	"github.com/getstoop/stoop/internal/text"
)

const (
	activityKindMention = "mention"
	activityKindReply   = "reply"
	activityKindDM      = "dm"
	// Thread replies, one unread entry per thread (messaging.md → Threads).
	activityKindThreadReply = "thread_reply"
	previewLen              = 140
)

// recordActivity tells the people a new message concerns: mentions, then
// the reply target, then a thread's root author and earlier repliers,
// then DM participants. The message is already saved and published, so a
// failure here is logged and the send still succeeds.
func (s *Service) recordActivity(ctx context.Context, msg messageRow, channel dbgen.Channel, participants []string, parent *messageRow, mentioned []string, author *chatv1.MessageAuthor, attachments []FileRecord) {
	about := alert{msg: msg, spaceID: channel.SpaceID, author: author}
	if len(attachments) > 0 {
		about.firstAttachment = attachments[0].Name
	}
	warn := func(step string, err error) {
		slog.Default().Warn("activity: could not record "+step, "message_id", msg.ID, "err", err)
	}
	if err := s.recordMentions(ctx, about, mentioned); err != nil {
		warn("mentions", err)
	}
	told := map[string]bool{msg.AuthorID: true}
	for _, id := range mentioned {
		told[id] = true
	}
	if parent != nil {
		if err := s.recordReply(ctx, about, parent.AuthorID, mentioned); err != nil {
			warn("reply", err)
		}
		told[parent.AuthorID] = true
	}
	if msg.ThreadRootID != nil {
		threadTold, err := s.recordThreadReply(ctx, about, *msg.ThreadRootID, told)
		if err != nil {
			warn("thread reply", err)
		}
		for _, id := range threadTold {
			told[id] = true
		}
	}
	if isDM(channel) {
		if err := s.recordDM(ctx, about, participants, told); err != nil {
			warn("dm", err)
		}
	}
}

// recordThreadReply tells the people in a thread who haven't muted it
// about a new reply, unless an earlier step already told them, as one
// thread_reply entry per thread while unread. It returns who it told.
func (s *Service) recordThreadReply(ctx context.Context, about alert, rootID string, told map[string]bool) ([]string, error) {
	people, err := s.q.ThreadParticipants(ctx, dbgen.ThreadParticipantsParams{RootID: rootID, ReplyID: about.msg.ID})
	if err != nil {
		return nil, fmt.Errorf("thread participants: %w", err)
	}
	var recipients []string
	for _, id := range people {
		if !told[id] {
			recipients = append(recipients, id)
		}
	}
	about.kind, about.coalesce = activityKindThreadReply, true
	return recipients, s.notify(ctx, recipients, about)
}

// alert is one kind of activity item about a message, for its recipients.
type alert struct {
	kind            string
	msg             messageRow
	spaceID         *string
	author          *chatv1.MessageAuthor
	firstAttachment string
	// coalesce refreshes a recipient's unread item of the kind in the
	// channel instead of adding one.
	coalesce bool
}

// recordMentions tells each mentioned member.
func (s *Service) recordMentions(ctx context.Context, about alert, mentioned []string) error {
	about.kind = activityKindMention
	return s.notify(ctx, mentioned, about)
}

// recordReply tells the replied-to author, unless they're the replier or
// were already @mentioned in the same message (one alert is enough).
func (s *Service) recordReply(ctx context.Context, about alert, parentAuthorID string, mentioned []string) error {
	if parentAuthorID == about.msg.AuthorID || slices.Contains(mentioned, parentAuthorID) {
		return nil
	}
	about.kind = activityKindReply
	return s.notify(ctx, []string{parentAuthorID}, about)
}

// recordDM tells a direct message's other participants about a new
// message — unless an earlier step already told them about the same
// message (one alert is enough). See messaging.md → The DM feed
// collapses.
func (s *Service) recordDM(ctx context.Context, about alert, participants []string, told map[string]bool) error {
	var recipients []string
	for _, id := range participants {
		if !told[id] {
			recipients = append(recipients, id)
		}
	}
	about.kind, about.spaceID, about.coalesce = activityKindDM, nil, true
	return s.notify(ctx, recipients, about)
}

// notify writes the alert's activity items for the recipients, less any
// who blocked the author, and delivers each live with its recipient's
// mute. Its query count does not grow with the recipients.
func (s *Service) notify(ctx context.Context, recipients []string, about alert) error {
	recipients, err := s.withoutBlockers(ctx, about.msg.AuthorID, recipients)
	if err != nil || len(recipients) == 0 {
		return err
	}
	items, err := s.writeActivityItems(ctx, recipients, about)
	if err != nil {
		return err
	}
	muted, err := s.mutedAmong(ctx, recipients, about.msg.ChannelID, about.spaceID, about.msg.ThreadRootID)
	if err != nil {
		return err
	}
	for _, item := range items {
		s.bus.Publish(events.UserTopic(item.UserID), events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_ActivityItemCreated{
				ActivityItemCreated: &realtimev1.ActivityItemCreated{
					Item: toProtoActivityItem(item, &about.msg.Content, about.msg.ThreadRootID, about.firstAttachment, about.author, muted[item.UserID]),
				},
			},
		}))
	}
	return nil
}

func (s *Service) writeActivityItems(ctx context.Context, recipients []string, about alert) ([]dbgen.ActivityItem, error) {
	ids := make([]string, len(recipients))
	for index := range recipients {
		ids[index] = rowid.New()
	}
	if !about.coalesce {
		items, err := s.q.CreateActivityItems(ctx, dbgen.CreateActivityItemsParams{
			Ids: ids, UserIds: recipients, Kind: about.kind, SpaceID: about.spaceID,
			ChannelID: about.msg.ChannelID, MessageID: about.msg.ID, ActorID: about.msg.AuthorID,
		})
		if err != nil {
			return nil, fmt.Errorf("create %s activity items: %w", about.kind, err)
		}
		return items, nil
	}
	var threadRootID *string
	if about.kind == activityKindThreadReply {
		threadRootID = about.msg.ThreadRootID
	}
	rows, err := s.q.UpsertUnreadActivityItems(ctx, dbgen.UpsertUnreadActivityItemsParams{
		Ids: ids, UserIds: recipients, Kind: about.kind, SpaceID: about.spaceID,
		ChannelID: about.msg.ChannelID, MessageID: about.msg.ID, ActorID: about.msg.AuthorID,
		ThreadRootID: threadRootID,
	})
	if err != nil {
		return nil, fmt.Errorf("upsert %s activity items: %w", about.kind, err)
	}
	items := make([]dbgen.ActivityItem, len(rows))
	for index, row := range rows {
		items[index] = dbgen.ActivityItem(row)
	}
	return items, nil
}

var errActivityNeedsReads = errors.New("reading activity needs reading messages and direct messages as well")

func (s *Service) ListActivity(ctx context.Context, req *connect.Request[chatv1.ListActivityRequest]) (*connect.Response[chatv1.ListActivityResponse], error) {
	userID := authctx.UserID(ctx)
	limit := clampPageSize(req.Msg.Limit, defaultPageSize, maxPageSize)
	var before *string
	if req.Msg.BeforeId != "" {
		before = &req.Msg.BeforeId
	}
	// Every item previews a message, from a space or a direct message, so
	// the feed needs both read grants beside activity.read. A session has
	// them; a token is only ever minted with all three together.
	if !authctx.Covers(ctx, authctx.MessagesRead) || !authctx.Covers(ctx, authctx.DMsRead) {
		return nil, connect.NewError(connect.CodePermissionDenied, errActivityNeedsReads)
	}
	rows, err := s.q.ListActivity(ctx, dbgen.ListActivityParams{UserID: userID, BeforeID: before, Limit: limit})
	if err != nil {
		return nil, fmt.Errorf("list activity: %w", err)
	}
	actorIDs := make([]string, 0, len(rows))
	seen := map[string]bool{}
	for _, r := range rows {
		if !seen[r.ActivityItem.ActorID] {
			seen[r.ActivityItem.ActorID] = true
			actorIDs = append(actorIDs, r.ActivityItem.ActorID)
		}
	}
	actors, err := s.resolveAuthors(ctx, actorIDs)
	if err != nil {
		return nil, err
	}
	out := make([]*chatv1.ActivityItem, len(rows))
	var fileIDs []string
	for _, r := range rows {
		if r.MessageFirstFileID != "" {
			fileIDs = append(fileIDs, r.MessageFirstFileID)
		}
	}
	files, err := s.fileRecords(ctx, fileIDs)
	if err != nil {
		return nil, err
	}
	for i, r := range rows {
		out[i] = toProtoActivityItem(r.ActivityItem, r.MessageContent, r.MessageThreadRootID, files[r.MessageFirstFileID].label(), actors[r.ActivityItem.ActorID], r.Muted)
	}
	unread, err := s.q.CountUnreadActivity(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("count unread: %w", err)
	}
	return connect.NewResponse(&chatv1.ListActivityResponse{
		Items: out, UnreadCount: int32(unread),
	}), nil
}

func (s *Service) MarkActivityRead(ctx context.Context, req *connect.Request[chatv1.MarkActivityReadRequest]) (*connect.Response[chatv1.MarkActivityReadResponse], error) {
	userID := authctx.UserID(ctx)
	if req.Msg.All {
		if err := s.q.MarkAllActivityRead(ctx, userID); err != nil {
			return nil, fmt.Errorf("mark all read: %w", err)
		}
	} else if len(req.Msg.Ids) > 0 {
		if err := s.q.MarkActivityRead(ctx, dbgen.MarkActivityReadParams{UserID: userID, Ids: req.Msg.Ids}); err != nil {
			return nil, fmt.Errorf("mark read: %w", err)
		}
	}
	unread, err := s.q.CountUnreadActivity(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("count unread: %w", err)
	}
	return connect.NewResponse(&chatv1.MarkActivityReadResponse{UnreadCount: int32(unread)}), nil
}

// toProtoActivityItem renders an activity item; threadRootID is the
// message's thread, if it is a reply in one; firstAttachment names the
// message's first file, the preview when it has no text, and muted is the
// recipient's effective mute for where it happened.
func toProtoActivityItem(item dbgen.ActivityItem, content, threadRootID *string, firstAttachment string, actor *chatv1.MessageAuthor, muted bool) *chatv1.ActivityItem {
	if actor == nil {
		actor = unknownAuthor(item.ActorID)
	}
	kind := chatv1.ActivityKind_ACTIVITY_KIND_MENTION
	switch item.Kind {
	case activityKindReply:
		kind = chatv1.ActivityKind_ACTIVITY_KIND_REPLY
	case activityKindDM:
		kind = chatv1.ActivityKind_ACTIVITY_KIND_DM
	case activityKindThreadReply:
		kind = chatv1.ActivityKind_ACTIVITY_KIND_THREAD_REPLY
	}
	out := &chatv1.ActivityItem{
		Id: item.ID, Kind: kind,
		ChannelId: item.ChannelID, Actor: actor,
		CreatedAt: timestamppb.New(item.CreatedAt),
		Muted:     muted,
	}
	if item.SpaceID != nil {
		out.SpaceId = *item.SpaceID
	}
	if item.MessageID != nil {
		out.MessageId = *item.MessageID
	}
	if threadRootID != nil {
		out.ThreadRootId = *threadRootID
	}
	if content != nil {
		out.Preview = text.Truncate(previewText(*content, firstAttachment), previewLen)
	}
	out.ReadAt = pbtime.OrNil(item.ReadAt)
	return out
}

// mutedAmong is each recipient's effective mute for a channel: their own
// channel row or their own space row. spaceID is nil for a direct message.
func (s *Service) mutedAmong(ctx context.Context, userIDs []string, channelID string, spaceID, threadRootID *string) (map[string]bool, error) {
	mutedIDs, err := s.q.MutedAmong(ctx, dbgen.MutedAmongParams{UserIds: userIDs, ChannelID: channelID, SpaceID: spaceID, ThreadRootID: threadRootID})
	if err != nil {
		return nil, fmt.Errorf("muted among: %w", err)
	}
	muted := make(map[string]bool, len(mutedIDs))
	for _, id := range mutedIDs {
		muted[id] = true
	}
	return muted, nil
}
