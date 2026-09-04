package chat

import (
	"context"
	"errors"
	"fmt"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/Jhut89/stoop/gen/stoop/realtime/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/dbgen"
	"github.com/Jhut89/stoop/internal/events"
)

const (
	activityKindMention = "mention"
	activityKindReply   = "reply"
	activityKindDM      = "dm"
	previewLen          = 140
)

// recordMentions writes an activity item for each mentioned member and
// delivers it live. Called after the message is committed.
func (s *Service) recordMentions(ctx context.Context, msg dbgen.Message, spaceID *string, mentioned []string, author *chatv1.MessageAuthor, firstAttachment string) error {
	mentioned, err := s.withoutBlockers(ctx, msg.AuthorID, mentioned)
	if err != nil {
		return err
	}
	for _, userID := range mentioned {
		a, err := s.q.CreateActivityItem(ctx, dbgen.CreateActivityItemParams{
			ID: newID(), UserID: userID, Kind: activityKindMention,
			SpaceID: spaceID, ChannelID: msg.ChannelID, MessageID: &msg.ID, ActorID: msg.AuthorID,
		})
		if err != nil {
			return fmt.Errorf("create activity item: %w", err)
		}
		muted, err := s.mutedFor(ctx, userID, msg.ChannelID, spaceID)
		if err != nil {
			return err
		}
		s.bus.Publish("user:"+userID, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_ActivityItemCreated{
				ActivityItemCreated: &realtimev1.ActivityItemCreated{
					Item: toProtoActivityItem(a, &msg.Content, firstAttachment, author, muted),
				},
			},
		}))
	}
	return nil
}

// recordReply tells the replied-to author, unless they're the replier or
// were already @mentioned in the same message (one alert is enough).
func (s *Service) recordReply(ctx context.Context, msg dbgen.Message, spaceID *string, parentAuthorID string, mentioned []string, author *chatv1.MessageAuthor, firstAttachment string) error {
	if parentAuthorID == msg.AuthorID {
		return nil
	}
	for _, id := range mentioned {
		if id == parentAuthorID {
			return nil
		}
	}
	if allowed, err := s.withoutBlockers(ctx, msg.AuthorID, []string{parentAuthorID}); err != nil {
		return err
	} else if len(allowed) == 0 {
		return nil
	}
	a, err := s.q.CreateActivityItem(ctx, dbgen.CreateActivityItemParams{
		ID: newID(), UserID: parentAuthorID, Kind: activityKindReply,
		SpaceID: spaceID, ChannelID: msg.ChannelID, MessageID: &msg.ID, ActorID: msg.AuthorID,
	})
	if err != nil {
		return fmt.Errorf("create reply activity item: %w", err)
	}
	muted, err := s.mutedFor(ctx, parentAuthorID, msg.ChannelID, spaceID)
	if err != nil {
		return err
	}
	s.bus.Publish("user:"+parentAuthorID, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ActivityItemCreated{
			ActivityItemCreated: &realtimev1.ActivityItemCreated{
				Item: toProtoActivityItem(a, &msg.Content, firstAttachment, author, muted),
			},
		},
	}))
	return nil
}

// recordDM tells a direct message's other participants about a new
// message — unless they were already told by a mention or a reply in the
// same message (one alert is enough). A conversation holds one unread
// entry in the feed: while it is unread, further messages refresh it
// (newest preview and time) rather than add rows; once read, the next
// message starts a new one. The event goes out either way, so a desktop
// banner still fires per message.
func (s *Service) recordDM(ctx context.Context, msg dbgen.Message, channel dbgen.Channel, parent *dbgen.Message, mentioned []string, author *chatv1.MessageAuthor, firstAttachment string) error {
	ids, err := s.q.ListDMMembers(ctx, channel.ID)
	if err != nil {
		return fmt.Errorf("list participants: %w", err)
	}
	if ids, err = s.withoutBlockers(ctx, msg.AuthorID, ids); err != nil {
		return err
	}
	told := map[string]bool{msg.AuthorID: true}
	for _, id := range mentioned {
		told[id] = true
	}
	if parent != nil && parent.AuthorID != msg.AuthorID {
		told[parent.AuthorID] = true
	}
	for _, id := range ids {
		if told[id] {
			continue
		}
		var a dbgen.ActivityItem
		existing, err := s.q.GetUnreadActivityForChannel(ctx, dbgen.GetUnreadActivityForChannelParams{
			UserID: id, ChannelID: msg.ChannelID, Kind: activityKindDM,
		})
		switch {
		case err == nil:
			a, err = s.q.RefreshActivityItem(ctx, dbgen.RefreshActivityItemParams{
				ID: existing.ID, MessageID: &msg.ID, ActorID: msg.AuthorID,
			})
		case errors.Is(err, pgx.ErrNoRows):
			a, err = s.q.CreateActivityItem(ctx, dbgen.CreateActivityItemParams{
				ID: newID(), UserID: id, Kind: activityKindDM,
				ChannelID: msg.ChannelID, MessageID: &msg.ID, ActorID: msg.AuthorID,
			})
		}
		if err != nil {
			return fmt.Errorf("dm activity item: %w", err)
		}
		muted, err := s.mutedFor(ctx, id, msg.ChannelID, nil)
		if err != nil {
			return err
		}
		s.bus.Publish("user:"+id, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_ActivityItemCreated{
				ActivityItemCreated: &realtimev1.ActivityItemCreated{
					Item: toProtoActivityItem(a, &msg.Content, firstAttachment, author, muted),
				},
			},
		}))
	}
	return nil
}

func (s *Service) ListActivity(ctx context.Context, req *connect.Request[chatv1.ListActivityRequest]) (*connect.Response[chatv1.ListActivityResponse], error) {
	userID := authctx.UserID(ctx)
	limit := req.Msg.Limit
	if limit <= 0 {
		limit = defaultPageSize
	} else if limit > maxPageSize {
		limit = maxPageSize
	}
	var before *string
	if req.Msg.BeforeId != "" {
		before = &req.Msg.BeforeId
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
		out[i] = toProtoActivityItem(r.ActivityItem, r.MessageContent, files[r.MessageFirstFileID].Name, actors[r.ActivityItem.ActorID], r.Muted)
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

// toProtoActivityItem renders an activity item; firstAttachment names the
// message's first file, the preview when it has no text, and muted is the
// recipient's effective mute for where it happened.
func toProtoActivityItem(a dbgen.ActivityItem, content *string, firstAttachment string, actor *chatv1.MessageAuthor, muted bool) *chatv1.ActivityItem {
	if actor == nil {
		actor = &chatv1.MessageAuthor{Id: a.ActorID, Username: "unknown"}
	}
	kind := chatv1.ActivityKind_ACTIVITY_KIND_MENTION
	switch a.Kind {
	case activityKindReply:
		kind = chatv1.ActivityKind_ACTIVITY_KIND_REPLY
	case activityKindDM:
		kind = chatv1.ActivityKind_ACTIVITY_KIND_DM
	}
	out := &chatv1.ActivityItem{
		Id: a.ID, Kind: kind,
		ChannelId: a.ChannelID, Actor: actor,
		CreatedAt: timestamppb.New(a.CreatedAt),
		Muted:     muted,
	}
	if a.SpaceID != nil {
		out.SpaceId = *a.SpaceID
	}
	if a.MessageID != nil {
		out.MessageId = *a.MessageID
	}
	if content != nil {
		out.Preview = truncate(previewText(*content, firstAttachment), previewLen)
	}
	if a.ReadAt != nil {
		out.ReadAt = timestamppb.New(*a.ReadAt)
	}
	return out
}

// mutedFor is the recipient's effective mute for a channel: their own
// channel row or their own space row. spaceID is nil for a direct message.
func (s *Service) mutedFor(ctx context.Context, userID, channelID string, spaceID *string) (bool, error) {
	muted, err := s.q.IsMutedFor(ctx, dbgen.IsMutedForParams{UserID: userID, ChannelID: channelID, SpaceID: spaceID})
	if err != nil {
		return false, fmt.Errorf("is muted for: %w", err)
	}
	return muted, nil
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n-1]) + "…"
}
