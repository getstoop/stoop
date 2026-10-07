package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/pbtime"
)

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
		return messageRow{}, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("that message was deleted"))
	}
	return root, nil
}

// checkQuote enforces where a quoted message may be: inside the same
// thread for a thread reply, in the channel's timeline otherwise.
func checkQuote(parent messageRow, threadRoot *messageRow) error {
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

// publishThreadChanged sends a root's summary after a reply lands or goes.
// The reply is already saved, so a failure is logged, not returned.
func (s *Service) publishThreadChanged(ctx context.Context, channel dbgen.Channel, participants []string, thread dbgen.Thread) {
	authors, err := s.resolveAuthors(ctx, thread.RecentAuthorIds)
	if err != nil {
		slog.Default().Warn("thread: could not resolve authors", "root_id", thread.RootMessageID, "err", err)
		return
	}
	s.publishTo(channel, participants, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ThreadChanged{ThreadChanged: &realtimev1.ThreadChanged{
			SpaceId: spaceOf(channel), ChannelId: channel.ID, RootMessageId: thread.RootMessageID,
			Thread: toProtoThread(thread.ReplyCount, thread.LastReplyAt, thread.RecentAuthorIds, authors),
		}},
	}))
}

// DeleteThread removes a root and every reply in its thread. Built in
// STOOP-424.
func (s *Service) DeleteThread(ctx context.Context, req *connect.Request[chatv1.DeleteThreadRequest]) (*connect.Response[chatv1.DeleteThreadResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("deleting a thread is not available yet"))
}
