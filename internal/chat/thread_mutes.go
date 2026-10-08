package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// Thread mutes and read markers (STOOP-433). Who is in a thread is worked
// out from its messages; these hold only what the person chose or saw.
// docs/architecture/messaging.md#threads.

// SetThreadMuted sets the caller's own mute for a thread in a channel they
// can read. A placeholder root can be muted too: its thread still runs.
func (s *Service) SetThreadMuted(ctx context.Context, req *connect.Request[chatv1.SetThreadMutedRequest]) (*connect.Response[chatv1.SetThreadMutedResponse], error) {
	root, channel, err := s.readableRoot(ctx, req.Msg.MessageId)
	if err != nil {
		return nil, err
	}
	userID := authctx.UserID(ctx)
	if req.Msg.Muted {
		err = s.q.MuteThread(ctx, dbgen.MuteThreadParams{UserID: userID, RootMessageID: root.ID})
	} else {
		err = s.q.UnmuteThread(ctx, dbgen.UnmuteThreadParams{UserID: userID, RootMessageID: root.ID})
	}
	if err != nil {
		return nil, fmt.Errorf("set thread mute: %w", err)
	}
	s.bus.Publish(events.UserTopic(userID), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ThreadMuted{
			ThreadMuted: &realtimev1.ThreadMuted{
				SpaceId: spaceOf(channel), ChannelId: channel.ID, RootMessageId: root.ID, Muted: req.Msg.Muted,
			},
		},
	}))
	return connect.NewResponse(&chatv1.SetThreadMutedResponse{}), nil
}

// ListThreadMutes is the threads half of Profile → Muted.
func (s *Service) ListThreadMutes(ctx context.Context, _ *connect.Request[chatv1.ListThreadMutesRequest]) (*connect.Response[chatv1.ListThreadMutesResponse], error) {
	rows, err := s.q.ListThreadMutes(ctx, authctx.UserID(ctx))
	if err != nil {
		return nil, fmt.Errorf("list thread mutes: %w", err)
	}
	var roots []dbgen.MessageWithReply
	var channels []dbgen.Channel
	for _, row := range rows {
		hidden, err := s.hiddenChannel(ctx, row.Channel)
		if err != nil {
			return nil, err
		}
		if !hidden {
			roots = append(roots, row.MessageWithReply)
			channels = append(channels, row.Channel)
		}
	}
	messages, err := s.hydrateMessages(ctx, "", roots)
	if err != nil {
		return nil, err
	}
	out := make([]*chatv1.MutedThread, len(roots))
	for index, channel := range channels {
		messages[index].SpaceId = spaceOf(channel)
		out[index] = &chatv1.MutedThread{SpaceId: spaceOf(channel), ChannelId: channel.ID, Root: messages[index]}
	}
	return connect.NewResponse(&chatv1.ListThreadMutesResponse{Threads: out}), nil
}

// MarkThreadRead moves the caller's read marker in a thread to its newest
// reply, or to reply_id. A thread with no replies has nothing to read.
func (s *Service) MarkThreadRead(ctx context.Context, req *connect.Request[chatv1.MarkThreadReadRequest]) (*connect.Response[chatv1.MarkThreadReadResponse], error) {
	root, channel, err := s.readableRoot(ctx, req.Msg.MessageId)
	if err != nil {
		return nil, err
	}
	target := req.Msg.ReplyId
	if target != "" {
		reply, err := s.q.GetMessage(ctx, target)
		if err != nil {
			return nil, apierr.NotFoundOr(err, "message")
		}
		if reply.ThreadRootID == nil || *reply.ThreadRootID != root.ID {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				errors.New("that message is not a reply in this thread"))
		}
	} else {
		last, err := s.q.ThreadLastReply(ctx, root.ID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && last == nil) {
			return connect.NewResponse(&chatv1.MarkThreadReadResponse{}), nil
		}
		if err != nil {
			return nil, fmt.Errorf("read thread: %w", err)
		}
		target = *last
	}
	userID := authctx.UserID(ctx)
	marker, err := s.q.MarkThreadRead(ctx, dbgen.MarkThreadReadParams{
		UserID: userID, RootMessageID: root.ID, LastReadMessageID: target,
	})
	if err != nil {
		return nil, fmt.Errorf("mark thread read: %w", err)
	}
	s.publishThreadRead(userID, channel, root.ID, marker)
	return connect.NewResponse(&chatv1.MarkThreadReadResponse{LastReadMessageId: marker}), nil
}

func (s *Service) publishThreadRead(userID string, channel dbgen.Channel, rootID, marker string) {
	s.bus.Publish(events.UserTopic(userID), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ThreadRead{
			ThreadRead: &realtimev1.ThreadRead{
				SpaceId: spaceOf(channel), ChannelId: channel.ID, RootMessageId: rootID, LastReadMessageId: marker,
			},
		},
	}))
}

// readableRoot loads a thread's root in a channel the caller can read.
func (s *Service) readableRoot(ctx context.Context, rootID string) (messageRow, dbgen.Channel, error) {
	root, err := s.q.GetMessage(ctx, rootID)
	if err != nil {
		return messageRow{}, dbgen.Channel{}, apierr.NotFoundOr(err, "message")
	}
	channel, err := s.accessChannel(ctx, root.ChannelID)
	if err != nil {
		return messageRow{}, dbgen.Channel{}, err
	}
	if root.ThreadRootID != nil {
		return messageRow{}, dbgen.Channel{}, connect.NewError(connect.CodeInvalidArgument,
			errors.New("that message is a reply, not a thread's root"))
	}
	return root, channel, nil
}

// addThreadViewerStates fills the caller's own half of each root's thread
// summary, for a response to them alone (never an event).
func (s *Service) addThreadViewerStates(ctx context.Context, messages []*chatv1.Message) error {
	byID := map[string]*chatv1.ThreadSummary{}
	var rootIDs []string
	for _, message := range messages {
		if message.Thread != nil {
			byID[message.Id] = message.Thread
			rootIDs = append(rootIDs, message.Id)
		}
	}
	if len(rootIDs) == 0 {
		return nil
	}
	states, err := s.q.ThreadViewerStates(ctx, dbgen.ThreadViewerStatesParams{
		UserID: authctx.UserID(ctx), RootIds: rootIDs,
	})
	if err != nil {
		return fmt.Errorf("thread viewer states: %w", err)
	}
	for _, state := range states {
		summary := byID[state.RootID]
		summary.Participating = state.Participating
		summary.Muted = state.Muted
		if state.Participating && !state.Muted {
			summary.UnreadCount = state.UnreadCount
		}
	}
	return nil
}
