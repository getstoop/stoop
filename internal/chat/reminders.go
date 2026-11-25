package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/rowid"
)

// Reminders (docs/architecture/messaging.md → Reminders): a reminder
// waits in the reminders table, seen by nobody but the person who set
// it. At its time DeliverReminders posts it in its channel as a system
// message of kind 9 by that person, and the waiting row is gone.

const (
	maxReminderLen      = 200
	maxWaitingReminders = 50
	// reminderBatch bounds one delivery run; what is left is due at the next.
	reminderBatch = 500

	// DeliverRemindersKind is the job kind internal/app registers for
	// DeliverReminders, and DeliverRemindersInterval how often it runs.
	DeliverRemindersKind     = "deliver_reminders"
	DeliverRemindersInterval = 30 * time.Second
)

// reminderFired is a delivered reminder's row. Text is stored in the
// row's content and not in its data, which is {}.
type reminderFired struct {
	bareEvent
	Text string `json:"-"`
}

func (reminderFired) kind() int16 { return kindReminder }
func (event reminderFired) check() error {
	if event.Text == "" {
		return errors.New("a reminder has text")
	}
	return nil
}
func (event reminderFired) content() string { return event.Text }
func (reminderFired) proto(map[string]*chatv1.MessageAuthor) *chatv1.SystemEvent {
	return &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_Reminder{Reminder: &chatv1.Reminder{}}}
}

func errReminderNotFound() error {
	return connect.NewError(connect.CodeNotFound, errors.New("reminder not found"))
}

// CreateReminder stores a reminder for a channel the caller may send a
// message in. The request says what time is meant and the server's clock
// decides the instant (reminder_time.go). Nothing is posted and nobody
// is told until then.
func (s *Service) CreateReminder(ctx context.Context, req *connect.Request[chatv1.CreateReminderRequest]) (*connect.Response[chatv1.CreateReminderResponse], error) {
	userID := authctx.UserID(ctx)
	content, err := pollLine(req.Msg.Text, "a reminder", maxReminderLen)
	if err != nil {
		return nil, err
	}
	if content == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("a reminder needs some text"))
	}
	remindAt, err := reminderTime(req.Msg, time.Now())
	if err != nil {
		return nil, err
	}
	channel, _, err := s.writableChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	if err := s.requirePostPolicy(ctx, channel); err != nil {
		return nil, err
	}
	var reminder dbgen.Reminder
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		// One count and insert per person at a time, or two requests
		// could both find room for the last one.
		if err := qtx.LockReminderOwner(ctx, userID); err != nil {
			return fmt.Errorf("lock reminder owner: %w", err)
		}
		waiting, err := qtx.CountRemindersByUser(ctx, userID)
		if err != nil {
			return fmt.Errorf("count reminders: %w", err)
		}
		if waiting >= maxWaitingReminders {
			return connect.NewError(connect.CodeResourceExhausted,
				fmt.Errorf("you can have at most %d reminders waiting", maxWaitingReminders))
		}
		reminder, err = qtx.CreateReminder(ctx, dbgen.CreateReminderParams{
			ID: rowid.New(), ChannelID: channel.ID, UserID: userID, Content: content, RemindAt: remindAt,
		})
		// The channel was deleted since the access check.
		if db.HasCode(err, db.ForeignKeyViolation) {
			return errChannelNotFound()
		}
		if err != nil {
			return fmt.Errorf("create reminder: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.CreateReminderResponse{
		Id: reminder.ID, RemindAt: timestamppb.New(reminder.RemindAt),
	}), nil
}

// DeleteReminder takes back a waiting reminder of the caller's own.
// Someone else's, one already posted and an id that names none are all
// not found, and so is one in a channel the caller's credential does not
// reach. It asks nothing else: a person who has left the channel still
// takes theirs back.
func (s *Service) DeleteReminder(ctx context.Context, req *connect.Request[chatv1.DeleteReminderRequest]) (*connect.Response[chatv1.DeleteReminderResponse], error) {
	if uuid.Validate(req.Msg.Id) != nil {
		return nil, errReminderNotFound()
	}
	err := s.inTx(ctx, func(qtx *dbgen.Queries) error {
		channelID, err := qtx.DeleteOwnReminder(ctx, dbgen.DeleteOwnReminderParams{ID: req.Msg.Id, UserID: authctx.UserID(ctx)})
		if errors.Is(err, pgx.ErrNoRows) {
			return errReminderNotFound()
		}
		if err != nil {
			return fmt.Errorf("delete reminder: %w", err)
		}
		if id, _ := authctx.From(ctx); !id.Credential.Bounded {
			return nil
		}
		channel, err := qtx.GetChannel(ctx, channelID)
		if err != nil {
			return fmt.Errorf("look up channel: %w", err)
		}
		if requireChannelAction(ctx, channel, authctx.MessagesPost, authctx.DMsPost) != nil {
			return errReminderNotFound()
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.DeleteReminderResponse{}), nil
}

// ReminderReport is what one delivery run did with the reminders that
// were due.
type ReminderReport struct {
	// Delivered were posted in their channels.
	Delivered int64
	// Dropped were deleted unposted: the person may no longer post there.
	Dropped int64
	// Failed stay in the table for the next run.
	Failed int64
}

// DeliverReminders posts the reminders due at now, oldest first and at
// most reminderBatch of them, each in its own transaction. One that
// fails is logged and left for the next run, and the rest go on; the
// error says how many did.
func (s *Service) DeliverReminders(ctx context.Context, now time.Time) (ReminderReport, error) {
	var report ReminderReport
	due, err := s.q.ListDueReminders(ctx, dbgen.ListDueRemindersParams{Now: now, Limit: reminderBatch})
	if err != nil {
		return report, fmt.Errorf("list due reminders: %w", err)
	}
	for _, reminder := range due {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		outcome, err := s.deliverReminder(ctx, reminder, now)
		switch {
		case err != nil:
			report.Failed++
			slog.Default().Warn("reminder: could not deliver it", "reminder_id", reminder.ID, "channel_id", reminder.ChannelID, "err", err)
		case outcome == reminderDelivered:
			report.Delivered++
		case outcome == reminderDropped:
			report.Dropped++
		}
	}
	if report.Failed > 0 {
		return report, fmt.Errorf("%d of %d due reminders could not be delivered and stay for the next run", report.Failed, len(due))
	}
	return report, nil
}

type reminderOutcome int

const (
	// reminderGone: an Undo, another dispatcher or a channel delete took
	// it first.
	reminderGone reminderOutcome = iota
	reminderDelivered
	reminderDropped
)

// deliverReminder posts one due reminder, or drops it when the person
// who set it may no longer post in its channel. The access checks run
// first, outside the transaction, as a request's do: they read through
// the pool and the ports, which a transaction holding the channel row
// must not wait on. The transaction then takes the channel row before
// the reminder (seq.go): a channel delete holds the channel and cascades
// into reminders, so the other order would deadlock with it. An error
// that may pass leaves the reminder for the next run.
func (s *Service) deliverReminder(ctx context.Context, due dbgen.ListDueRemindersRow, now time.Time) (reminderOutcome, error) {
	var channel dbgen.Channel
	poster, author, refusal := s.reminderPoster(ctx, due.UserID)
	if refusal == nil {
		channel, _, refusal = s.writableChannel(poster, due.ChannelID)
	}
	if refusal == nil {
		refusal = s.requirePostPolicy(poster, channel)
	}
	if refusal != nil && !dropsReminder(refusal) {
		return reminderGone, refusal
	}

	outcome := reminderGone
	var participants []string
	var row messageRow
	err := s.inTx(ctx, func(qtx *dbgen.Queries) error {
		if _, err := qtx.LockChannel(ctx, due.ChannelID); errors.Is(err, pgx.ErrNoRows) {
			return nil
		} else if err != nil {
			return fmt.Errorf("lock channel: %w", err)
		}
		reminder, err := qtx.ClaimReminder(ctx, dbgen.ClaimReminderParams{ID: due.ID, Now: now})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("claim reminder: %w", err)
		}
		outcome = reminderDropped
		if refusal != nil {
			return nil
		}
		// Under the lock, what one statement can ask again: a removal
		// from the channel that landed since the checks above.
		member, err := qtx.IsChannelMember(ctx, dbgen.IsChannelMemberParams{ChannelID: channel.ID, UserID: reminder.UserID})
		if err != nil {
			return fmt.Errorf("check membership: %w", err)
		}
		if !member {
			refusal = errors.New("no longer in the channel")
			return nil
		}
		if participants, err = peopleWith(ctx, qtx, channel); err != nil {
			return fmt.Errorf("list participants: %w", err)
		}
		if row, err = recordEvent(ctx, qtx, channel, reminder.UserID, reminderFired{Text: reminder.Content}); err != nil {
			return err
		}
		outcome = reminderDelivered
		return nil
	})
	if err != nil {
		return reminderGone, err
	}
	if outcome == reminderDropped {
		slog.Default().Info("reminder: dropped, the person may no longer post there",
			"reminder_id", due.ID, "channel_id", due.ChannelID, "user_id", due.UserID, "reason", refusal)
	}
	if outcome != reminderDelivered {
		return outcome, nil
	}

	// The row is saved: from here on nothing fails the delivery. Nobody's
	// read marker moves, the person's own included: they are not at the
	// keyboard.
	if isDM(channel) {
		s.reopenDM(ctx, channel)
	}
	message, err := s.loadMessage(ctx, row.ID, spaceOf(channel))
	if err != nil {
		slog.Default().Warn("reminder: could not reload its row", "message_id", row.ID, "err", err)
	} else {
		s.publishTo(channel, participants, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_MessageCreated{MessageCreated: message},
		}))
	}
	// In a channel a reminder only marks unread, as a poll does.
	if isDM(channel) {
		s.recordActivity(ctx, row, channel, participants, nil, nil, author, nil)
	}
	return reminderDelivered, nil
}

// errReminderOwnerGone is the person who set a reminder no longer being
// someone who posts: no such account, a deleted one or a deactivated one.
var errReminderOwnerGone = errors.New("the account is gone or deactivated")

// reminderPoster is the context a reminder is checked and posted under:
// the identity of the person who set it, as a session of theirs would
// carry it, so every access check reads them as the caller. A job has no
// caller of its own.
func (s *Service) reminderPoster(ctx context.Context, userID string) (context.Context, *chatv1.MessageAuthor, error) {
	user, found, err := s.lookupUser(ctx, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("look up the reminder's person: %w", err)
	}
	if !found || user.Deleted || user.Deactivated {
		return nil, nil, connect.NewError(connect.CodeFailedPrecondition, errReminderOwnerGone)
	}
	role := authctx.RoleMember
	if user.InstanceAdmin {
		role = authctx.RoleAdmin
	}
	return authctx.WithIdentity(ctx, authctx.Identity{UserID: user.ID, Role: role, Kind: user.Kind}), authorOf(user), nil
}

// dropsReminder says a refusal is the person's standing and not a
// passing failure: the channel is not theirs to read (or is hidden),
// they may not post in it, or a block or their account stands in the
// way. Anything else may pass, so the reminder is kept.
func dropsReminder(err error) bool {
	if err == nil {
		return false
	}
	var refusal *connect.Error
	if !errors.As(err, &refusal) {
		return false
	}
	switch refusal.Code() {
	case connect.CodeNotFound, connect.CodePermissionDenied, connect.CodeFailedPrecondition:
		return true
	}
	return false
}
