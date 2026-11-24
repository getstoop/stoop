package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// Closing a poll (docs/architecture/messaging.md → Polls).

// outcome is a poll's result over its votes: every option with the most
// votes when that is at least one, in the poll's order, and how many
// people voted.
func (event pollCreated) outcome(votes []dbgen.PollVote) ([]pollWinner, int32) {
	counts := map[int16]int32{}
	voters := map[string]bool{}
	var most int32
	for _, vote := range votes {
		counts[vote.OptionID]++
		voters[vote.UserID] = true
		most = max(most, counts[vote.OptionID])
	}
	// Never nil: with no votes the row stores an empty list.
	winners := []pollWinner{}
	for _, option := range event.Options {
		if most > 0 && counts[option.ID] == most {
			winners = append(winners, pollWinner{Text: option.Text, Votes: most})
		}
	}
	return winners, int32(len(voters))
}

// ClosePoll closes a poll for good: its author may, or in a space someone
// with messages.moderate, and either only where they may still write. The
// poll takes closed_at and closed_by, and a closing row by the closer
// records the outcome as it stood. Like a message, that row is the
// channel's last message, is unread for everyone but the closer, reopens
// a closed conversation and, in a direct message or group conversation,
// tells the other participants.
func (s *Service) ClosePoll(ctx context.Context, req *connect.Request[chatv1.ClosePollRequest]) (*connect.Response[chatv1.ClosePollResponse], error) {
	userID := authctx.UserID(ctx)
	msg, err := s.q.GetMessage(ctx, req.Msg.MessageId)
	if err != nil {
		return nil, apierr.NotFoundOr(err, "message")
	}
	// Authorship is not access: an author removed from the channel, or
	// blocked in the direct message, closes nothing.
	channel, participants, err := s.writableChannel(ctx, msg.ChannelID)
	if err != nil {
		return nil, err
	}
	if _, err := openPoll(msg); err != nil {
		return nil, err
	}
	if msg.AuthorID != userID {
		// A conversation has no moderator.
		if isDM(channel) {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("only the person who asked can close this poll"))
		}
		if err := s.requireOnMessageIn(ctx, channel, authctx.MessagesModerate); err != nil {
			return nil, err
		}
	}
	// Read before anything is written: the activity needs the closer
	// whether or not the saved row reads back.
	authors, err := s.resolveAuthors(ctx, []string{userID})
	if err != nil {
		return nil, err
	}
	var closing messageRow
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		// The channel row before any other (seq.go).
		if _, err := qtx.LockChannel(ctx, channel.ID); err != nil {
			return fmt.Errorf("lock channel: %w", err)
		}
		// Under the lock no vote, close or delete can land: the row read
		// here and the votes counted are what the outcome is of.
		live, err := liveMessage(ctx, qtx, msg.ID)
		if err != nil {
			return err
		}
		poll, err := openPoll(live)
		if err != nil {
			return err
		}
		votes, err := qtx.ListPollVotesForMessages(ctx, []string{msg.ID})
		if err != nil {
			return fmt.Errorf("list poll votes: %w", err)
		}
		closedAt := time.Now().UTC()
		poll.ClosedAt, poll.ClosedBy = &closedAt, &userID
		data, err := json.Marshal(poll)
		if err != nil {
			return fmt.Errorf("encode poll: %w", err)
		}
		closed, err := qtx.ClosePoll(ctx, dbgen.ClosePollParams{ID: msg.ID, Data: data})
		if err != nil {
			return fmt.Errorf("close poll: %w", err)
		}
		if closed == 0 {
			return connect.NewError(connect.CodeNotFound, errMessageGone)
		}
		// The poll is stamped first and its closing row next, so their
		// events go out in that order.
		if _, err := stampMessage(ctx, qtx, channel.ID, msg.ID); err != nil {
			return err
		}
		winners, voters := poll.outcome(votes)
		closing, err = recordEvent(ctx, qtx, channel, userID, pollClosed{
			PollID: msg.ID, Question: poll.Question, Winners: winners, Voters: voters,
		})
		if err != nil {
			return err
		}
		// The closer has read their own closing row, and everything above it.
		return markChannelRead(ctx, qtx, userID, channel.ID, closing.ID)
	})
	if err != nil {
		return nil, err
	}

	// The close is saved: from here on nothing fails the request. A failed
	// reload answers with no message and sends no event for that row.
	if isDM(channel) {
		s.reopenDM(ctx, channel)
	}
	out, err := s.loadMessage(ctx, msg.ID, spaceOf(channel))
	if err != nil {
		slog.Default().Warn("poll close: could not reload the poll", "message_id", msg.ID, "err", err)
	} else {
		s.publishTo(channel, participants, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_MessageUpdated{MessageUpdated: out},
		}))
	}
	row, err := s.loadMessage(ctx, closing.ID, spaceOf(channel))
	if err != nil {
		slog.Default().Warn("poll close: could not reload its closing row", "message_id", closing.ID, "err", err)
	} else {
		s.publishTo(channel, participants, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_MessageCreated{MessageCreated: row},
		}))
	}
	// In a channel a closing row only marks unread, as a poll does.
	if isDM(channel) {
		s.recordActivity(ctx, closing, channel, participants, nil, nil, authorOrUnknown(authors, userID), nil)
	}
	return connect.NewResponse(&chatv1.ClosePollResponse{Message: out}), nil
}
