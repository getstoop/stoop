package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// Voting on a poll (docs/architecture/messaging.md → Polls).

// selection is a vote's option ids as the poll stores them, or why the
// vote is refused: an id the poll does not have, an id twice, or more
// than one on a poll of one choice. The caller has bounded optionIDs.
func (event pollCreated) selection(optionIDs []int32) ([]int16, error) {
	if len(optionIDs) > 1 && !event.Multiple {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("this poll takes one choice"))
	}
	// Never nil: an empty selection is stored as "keep none".
	chosen := make([]int16, 0, len(optionIDs))
	for _, id := range optionIDs {
		known := slices.ContainsFunc(event.Options, func(option pollOption) bool { return int32(option.ID) == id })
		if !known {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("this poll has no option %d", id))
		}
		if slices.Contains(chosen, int16(id)) {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("option %d is chosen twice", id))
		}
		chosen = append(chosen, int16(id))
	}
	return chosen, nil
}

// SetPollVote sets the caller's whole selection on an open poll, where
// they may react: an announcement channel's members vote. A vote marks
// nothing unread, records no activity and leaves the channel's last
// message alone. One that changes nothing writes and publishes nothing.
func (s *Service) SetPollVote(ctx context.Context, req *connect.Request[chatv1.SetPollVoteRequest]) (*connect.Response[chatv1.SetPollVoteResponse], error) {
	// Before anything is read: no poll has more options than this.
	if len(req.Msg.OptionIds) > maxPollOptions {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("a vote names at most %d options", maxPollOptions))
	}
	userID := authctx.UserID(ctx)
	msg, err := s.q.GetMessage(ctx, req.Msg.MessageId)
	if err != nil {
		return nil, apierr.NotFoundOr(err, "message")
	}
	channel, participants, err := s.writableChannel(ctx, msg.ChannelID)
	if err != nil {
		return nil, err
	}
	// After the access check, so only someone who may write here learns
	// what the row is. The definition never changes, so the selection is
	// judged once; whether the poll is open is read again under the lock.
	poll, err := openPoll(msg)
	if err != nil {
		return nil, err
	}
	chosen, err := poll.selection(req.Msg.OptionIds)
	if err != nil {
		return nil, err
	}
	var seq int64
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		// The stamp's seq is the first write, so it takes the channel row
		// before any other (seq.go).
		var err error
		if seq, err = stampMessage(ctx, qtx, channel.ID, msg.ID); err != nil {
			return err
		}
		// A close or a delete may have committed since the check above.
		live, err := liveMessage(ctx, qtx, msg.ID)
		if err != nil {
			return err
		}
		if _, err := openPoll(live); err != nil {
			return err
		}
		removed, err := qtx.RemovePollVotesExcept(ctx, dbgen.RemovePollVotesExceptParams{
			MessageID: msg.ID, UserID: userID, Kept: chosen,
		})
		if err != nil {
			return fmt.Errorf("remove poll votes: %w", err)
		}
		added, err := qtx.AddPollVotes(ctx, dbgen.AddPollVotesParams{
			MessageID: msg.ID, UserID: userID, OptionIds: chosen,
		})
		if err != nil {
			return fmt.Errorf("add poll votes: %w", err)
		}
		if removed+added == 0 {
			return errUnchanged // rolls the stamp back: no seq with no event
		}
		return nil
	})
	unchanged := errors.Is(err, errUnchanged)
	if err != nil && !unchanged {
		return nil, err
	}

	// The vote is saved: a failed reload answers with no message and
	// sends no event, rather than reporting the save as failed.
	out, err := s.loadMessage(ctx, msg.ID, spaceOf(channel))
	if err != nil {
		slog.Default().Warn("poll vote: could not reload the poll", "message_id", msg.ID, "err", err)
		return connect.NewResponse(&chatv1.SetPollVoteResponse{}), nil
	}
	if !unchanged {
		// At the seq this vote took, whatever the reload read: a vote that
		// committed since has stamped the row again and publishes that
		// seq itself, so no position goes unsent or is sent twice.
		out.Seq = seq
		s.publishTo(channel, participants, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_MessageUpdated{MessageUpdated: out},
		}))
	}
	return connect.NewResponse(&chatv1.SetPollVoteResponse{Message: out}), nil
}
