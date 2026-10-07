package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/pbtime"
)

// placeholderError refuses anything but reading on a root kept as a
// placeholder.
func placeholderError() error {
	return connect.NewError(connect.CodeFailedPrecondition, errors.New("that message was deleted"))
}

// threadRootFor checks that rootID can take a reply sent in channel: a
// top-level message in that channel, not a placeholder, and not in an
// announcement channel. docs/architecture/messaging.md → Threads.
func (s *Service) threadRootFor(ctx context.Context, channel dbgen.Channel, rootID string) (messageRow, error) {
	if channel.PostPolicy == postPolicyAdmins {
		return messageRow{}, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("#%s is an announcement channel; it has no threads", channel.Name))
	}
	root, err := s.q.GetMessage(ctx, rootID)
	if err != nil {
		return messageRow{}, apierr.NotFoundOr(err, "message")
	}
	if root.ChannelID != channel.ID {
		return messageRow{}, connect.NewError(connect.CodeInvalidArgument,
			errors.New("a thread's root must be in the same channel"))
	}
	if root.ThreadRootID != nil {
		return messageRow{}, connect.NewError(connect.CodeInvalidArgument,
			errors.New("a reply in a thread can't start a thread"))
	}
	if root.DeletedAt != nil {
		return messageRow{}, placeholderError()
	}
	return root, nil
}

// checkQuote enforces where a quoted message may be: inside the same
// thread for a thread reply, in the channel's timeline otherwise.
func checkQuote(parent messageRow, threadRoot *messageRow) error {
	if parent.DeletedAt != nil {
		return placeholderError()
	}
	if threadRoot != nil {
		if parent.ID != threadRoot.ID && (parent.ThreadRootID == nil || *parent.ThreadRootID != threadRoot.ID) {
			return connect.NewError(connect.CodeInvalidArgument,
				errors.New("can only quote a message in the same thread"))
		}
		return nil
	}
	if !parent.InChannel {
		return connect.NewError(connect.CodeInvalidArgument,
			errors.New("can only quote a message in the channel"))
	}
	return nil
}

// toProtoThread is the summary shown under a root; nil when it has no
// replies.
func toProtoThread(count int32, lastReplyAt *time.Time, recentAuthorIDs []string, authors map[string]*chatv1.MessageAuthor) *chatv1.ThreadSummary {
	if count == 0 {
		return nil
	}
	summary := &chatv1.ThreadSummary{ReplyCount: count, LastReplyAt: pbtime.OrNil(lastReplyAt)}
	for _, id := range recentAuthorIDs {
		summary.RecentAuthors = append(summary.RecentAuthors, authorOrUnknown(authors, id))
	}
	return summary
}

// threadChanged is the event carrying a root's summary after a reply lands
// or goes; nil, logged, when the authors can't be resolved, since the
// reply is already saved.
func (s *Service) threadChanged(ctx context.Context, channel dbgen.Channel, rootID string, thread *dbgen.Thread) *realtimev1.ServerEvent {
	changed := &realtimev1.ThreadChanged{SpaceId: spaceOf(channel), ChannelId: channel.ID, RootMessageId: rootID}
	if thread != nil {
		authors, err := s.resolveAuthors(ctx, thread.RecentAuthorIds)
		if err != nil {
			slog.Default().Warn("thread: could not resolve authors", "root_id", rootID, "err", err)
			return nil
		}
		changed.Thread = toProtoThread(thread.ReplyCount, thread.LastReplyAt, thread.RecentAuthorIds, authors)
	}
	return events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ThreadChanged{ThreadChanged: changed},
	})
}

// deleteTopLevel deletes a top-level message, or keeps it as a
// placeholder when its thread still has replies.
func (s *Service) deleteTopLevel(ctx context.Context, msg messageRow, channel dbgen.Channel) error {
	// The link rows go in the transaction; the files themselves are
	// deleted through the port afterwards.
	fileIDs, err := s.q.ListAttachmentFileIDsForMessage(ctx, msg.ID)
	if err != nil {
		return fmt.Errorf("list attachments: %w", err)
	}
	placeholder := false
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		replies, err := qtx.LockThread(ctx, msg.ID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("lock thread: %w", err)
		}
		if replies > 0 {
			placeholder = true
			if err := qtx.MakePlaceholder(ctx, msg.ID); err != nil {
				return fmt.Errorf("keep placeholder: %w", err)
			}
			return nil
		}
		if err := qtx.DeleteMessage(ctx, msg.ID); err != nil {
			return fmt.Errorf("delete message: %w", err)
		}
		if err := qtx.RecomputeChannelLastMessage(ctx, channel.ID); err != nil {
			return fmt.Errorf("recompute channel: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.deleteMessageFiles(ctx, fileIDs)
	if !placeholder {
		s.publishChannel(ctx, channel, messageDeleted(msg.ID, channel, ""))
		return nil
	}
	out, err := s.loadMessage(ctx, msg.ID, spaceOf(channel))
	if err != nil {
		slog.Default().Warn("delete: could not reload placeholder", "message_id", msg.ID, "err", err)
		return nil
	}
	s.publishChannel(ctx, channel, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageUpdated{MessageUpdated: out},
	}))
	return nil
}

// deleteThreadReply deletes a reply and recounts its root's summary. The
// last reply under a placeholder takes the placeholder with it.
func (s *Service) deleteThreadReply(ctx context.Context, msg messageRow, channel dbgen.Channel) error {
	rootID := *msg.ThreadRootID
	fileIDs, err := s.q.ListAttachmentFileIDsForMessage(ctx, msg.ID)
	if err != nil {
		return fmt.Errorf("list attachments: %w", err)
	}
	var thread *dbgen.Thread
	rootGone := false
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		if _, err := qtx.LockThread(ctx, rootID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("lock thread: %w", err)
		}
		if err := qtx.DeleteMessage(ctx, msg.ID); err != nil {
			return fmt.Errorf("delete message: %w", err)
		}
		recounted, err := qtx.RecomputeThread(ctx, rootID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("recount thread: %w", err)
		}
		if err == nil && recounted.ReplyCount > 0 {
			thread = &recounted
			return nil
		}
		if err := qtx.DeleteThreadSummary(ctx, rootID); err != nil {
			return fmt.Errorf("delete thread summary: %w", err)
		}
		root, err := qtx.GetMessage(ctx, rootID)
		if err != nil {
			return fmt.Errorf("load root: %w", err)
		}
		if root.DeletedAt == nil {
			return nil
		}
		rootGone = true
		if err := qtx.DeleteMessage(ctx, rootID); err != nil {
			return fmt.Errorf("delete placeholder: %w", err)
		}
		if err := qtx.RecomputeChannelLastMessage(ctx, channel.ID); err != nil {
			return fmt.Errorf("recompute channel: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.deleteMessageFiles(ctx, fileIDs)
	s.publishChannel(ctx, channel, messageDeleted(msg.ID, channel, rootID))
	if rootGone {
		s.publishChannel(ctx, channel, messageDeleted(rootID, channel, ""))
	} else if ev := s.threadChanged(ctx, channel, rootID, thread); ev != nil {
		s.publishChannel(ctx, channel, ev)
	}
	return nil
}

func messageDeleted(messageID string, channel dbgen.Channel, threadRootID string) *realtimev1.ServerEvent {
	return events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageDeleted{MessageDeleted: &realtimev1.MessageDeleted{
			MessageId: messageID, ChannelId: channel.ID, SpaceId: spaceOf(channel), ThreadRootId: threadRootID,
		}},
	})
}

// DeleteThread removes a root and every reply in its thread: moderation,
// so messages.moderate in the space, and never in a DM, which has no
// moderators. The replies go by the cascade on thread_root_id.
func (s *Service) DeleteThread(ctx context.Context, req *connect.Request[chatv1.DeleteThreadRequest]) (*connect.Response[chatv1.DeleteThreadResponse], error) {
	root, err := s.q.GetMessage(ctx, req.Msg.MessageId)
	if err != nil {
		return nil, apierr.NotFoundOr(err, "message")
	}
	channel, err := s.q.GetChannel(ctx, root.ChannelID)
	if err != nil {
		return nil, apierr.NotFoundOr(err, "channel")
	}
	if isDM(channel) {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("direct messages have no moderators"))
	}
	if err := s.requirePermission(ctx, *channel.SpaceID, authctx.MessagesModerate); err != nil {
		return nil, err
	}
	if root.ThreadRootID != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("that message is a reply, not a thread's root"))
	}
	fileIDs, err := s.q.ListThreadFileIDs(ctx, root.ID)
	if err != nil {
		return nil, fmt.Errorf("list attachments: %w", err)
	}
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		if err := qtx.DeleteMessage(ctx, root.ID); err != nil {
			return fmt.Errorf("delete thread: %w", err)
		}
		if err := qtx.RecomputeChannelLastMessage(ctx, channel.ID); err != nil {
			return fmt.Errorf("recompute channel: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.deleteMessageFiles(ctx, fileIDs)
	s.publishChannel(ctx, channel, messageDeleted(root.ID, channel, ""))
	return connect.NewResponse(&chatv1.DeleteThreadResponse{}), nil
}
