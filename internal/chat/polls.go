package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"connectrpc.com/connect"
	"golang.org/x/text/unicode/norm"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/pbtime"
	"github.com/getstoop/stoop/internal/text"
)

// Polls (docs/architecture/messaging.md → Polls): a poll is a system
// message of kind 7 by whoever asked, its definition in the row's data
// and its votes in poll_votes. Closing one records a second row, kind 8,
// that refers to it. Neither is quiet: both mark the channel unread.

const (
	maxPollQuestionLen = 200
	maxPollOptionLen   = 80
	minPollOptions     = 2
	maxPollOptions     = 10
)

// pollOption is one choice. Its id is what a vote names: 1 upwards in
// the order given, never reused.
type pollOption struct {
	ID   int16  `json:"id"`
	Text string `json:"text"`
}

// pollCreated is a poll's row. Its data is the definition, which never
// changes, and when and by whom it was closed, null while it is open.
type pollCreated struct {
	bareEvent
	Question string       `json:"question"`
	Options  []pollOption `json:"options"`
	Multiple bool         `json:"multiple"`
	ClosedAt *time.Time   `json:"closed_at"`
	ClosedBy *string      `json:"closed_by"`
	// votes are not in the row: addPollVotes reads them from poll_votes,
	// in the order they were cast.
	votes []dbgen.PollVote
}

func (pollCreated) kind() int16 { return kindPoll }
func (event pollCreated) check() error {
	if event.Question == "" || len(event.Options) < minPollOptions {
		return errors.New("a poll has a question and options")
	}
	return nil
}
func (event pollCreated) content() string { return event.Question }

// people: who closed it and everyone who voted.
func (event pollCreated) people() []string {
	var ids []string
	if event.ClosedBy != nil {
		ids = append(ids, *event.ClosedBy)
	}
	for _, vote := range event.votes {
		ids = append(ids, vote.UserID)
	}
	return ids
}

func (event pollCreated) proto(authors map[string]*chatv1.MessageAuthor) *chatv1.SystemEvent {
	poll := &chatv1.Poll{Question: event.Question, Multiple: event.Multiple, ClosedAt: pbtime.OrNil(event.ClosedAt)}
	if event.ClosedBy != nil {
		poll.ClosedBy = authorOrUnknown(authors, *event.ClosedBy)
	}
	voters := map[string]bool{}
	for _, option := range event.Options {
		out := &chatv1.PollOption{Id: int32(option.ID), Text: option.Text}
		for _, vote := range event.votes {
			if vote.OptionID == option.ID {
				out.Voters = append(out.Voters, authorOrUnknown(authors, vote.UserID))
				voters[vote.UserID] = true
			}
		}
		poll.Options = append(poll.Options, out)
	}
	poll.VoterCount = int32(len(voters))
	return &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_Poll{Poll: poll}}
}

// pollWinner is an option that had the most votes when the poll closed.
type pollWinner struct {
	Text  string `json:"text"`
	Votes int32  `json:"votes"`
}

// pollClosed is the closing row, by whoever closed the poll: a snapshot
// of the outcome, so it draws with no read of the poll. PollID is stored
// in the row's reference_message_id and not in its data.
type pollClosed struct {
	bareEvent
	PollID   string       `json:"-"`
	Question string       `json:"question"`
	Winners  []pollWinner `json:"winners"`
	Voters   int32        `json:"voters"`
}

func (pollClosed) kind() int16 { return kindPollClosed }
func (event pollClosed) check() error {
	if event.PollID == "" {
		return errors.New("a closing row names its poll")
	}
	return nil
}

// checkAbout: a closing row is about a live poll that has been closed,
// which ClosePoll does in the same transaction before it records one.
func (pollClosed) checkAbout(about messageRow) error {
	poll, err := pollOf(about)
	if err != nil {
		return err
	}
	if poll.ClosedAt == nil {
		return errors.New("the poll is still open")
	}
	return nil
}
func (event pollClosed) referenceID() string { return event.PollID }
func (event pollClosed) content() string     { return event.Question }
func (event pollClosed) proto(map[string]*chatv1.MessageAuthor) *chatv1.SystemEvent {
	closed := &chatv1.PollClosed{Question: event.Question, VoterCount: event.Voters}
	for _, winner := range event.Winners {
		closed.Winners = append(closed.Winners, &chatv1.PollWinner{Text: winner.Text, Votes: winner.Votes})
	}
	return &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_PollClosed{PollClosed: closed}}
}

// typedAsIs says a kind's content is plain text shown exactly as it was
// typed: a poll's question, on the poll and on its closing row. It is
// not Markdown and holds no mention tokens, whatever it looks like.
func typedAsIs(kind int16) bool {
	return kind == kindPoll || kind == kindPollClosed
}

// previewOf is previewText for a row of any kind: a poll and its closing
// row are worded from the question, anything else is its text or first
// attachment.
func previewOf(kind int16, content, firstAttachment string) string {
	switch kind {
	case kindPoll:
		return "Poll: " + content
	case kindPollClosed:
		return "Poll closed: " + content
	}
	return previewText(content, firstAttachment)
}

// preview is a row's one-line excerpt, cut to previewLen: previewOf,
// with mention tokens under their current names unless the kind's
// content is typed as is.
func (n mentionNames) preview(kind int16, content, firstAttachment string) string {
	if !typedAsIs(kind) {
		content = n.current(content)
	}
	return text.Truncate(previewOf(kind, content, firstAttachment), previewLen)
}

// pollLine is one line of a poll as it is stored: value trimmed, and
// refused when it holds a control character (a NUL, a tab, a line
// break), a line or paragraph separator or a bidirectional override or
// isolate, when it is longer than limit, or when it has characters but
// none anyone can see. what names it in the refusal. "" is an empty line,
// which the caller judges.
func pollLine(value, what string, limit int) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	visible := false
	for _, char := range value {
		switch {
		case unicode.IsControl(char), char == '\u2028', char == '\u2029':
			return "", connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("%s can't contain a line break, a tab or another control character", what))
		case (char >= '\u202a' && char <= '\u202e') || (char >= '\u2066' && char <= '\u2069'):
			return "", connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("%s can't contain a text direction override", what))
		case unicode.In(char, unicode.L, unicode.N, unicode.P, unicode.S):
			visible = true
		}
	}
	if !visible {
		return "", connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("%s needs at least one visible character", what))
	}
	if utf8.RuneCountInString(value) > limit {
		return "", connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("%s can be at most %d characters", what, limit))
	}
	return value, nil
}

// optionKey is what two options are compared by: the text in one
// normalisation form, without the format characters nobody sees (a
// zero-width space or joiner, a byte order mark). Compared ignoring case.
func optionKey(option string) string {
	return norm.NFC.String(strings.Map(func(char rune) rune {
		if unicode.Is(unicode.Cf, char) {
			return -1
		}
		return char
	}, option))
}

// newPoll is the poll a request asks for, or why it is refused: a
// question, and 2 to 10 options once the empty ones are dropped, no two
// the same ignoring case. It runs before the caller's access is known,
// so it stops at the first option past the limit: the work is bounded
// by the limit, not by what was sent.
func newPoll(question string, options []string, multiple bool) (pollCreated, error) {
	question, err := pollLine(question, "a poll's question", maxPollQuestionLen)
	if err != nil {
		return pollCreated{}, err
	}
	if question == "" {
		return pollCreated{}, connect.NewError(connect.CodeInvalidArgument, errors.New("a poll needs a question"))
	}
	errCount := connect.NewError(connect.CodeInvalidArgument,
		fmt.Errorf("a poll needs %d to %d options", minPollOptions, maxPollOptions))
	poll := pollCreated{Question: question, Multiple: multiple}
	var keys []string
	for _, option := range options {
		// Before anything is read of it: an empty option is dropped, and
		// leading space is all that can hide one.
		if strings.TrimSpace(option) == "" {
			continue
		}
		if len(poll.Options) == maxPollOptions {
			return pollCreated{}, errCount
		}
		option, err := pollLine(option, "a poll option", maxPollOptionLen)
		if err != nil {
			return pollCreated{}, err
		}
		key := optionKey(option)
		for _, earlier := range keys {
			if strings.EqualFold(earlier, key) {
				return pollCreated{}, connect.NewError(connect.CodeInvalidArgument,
					fmt.Errorf("a poll can't have the same option twice: %s", option))
			}
		}
		keys = append(keys, key)
		poll.Options = append(poll.Options, pollOption{ID: int16(len(poll.Options) + 1), Text: option})
	}
	if len(poll.Options) < minPollOptions {
		return pollCreated{}, errCount
	}
	return poll, nil
}

// CreatePoll posts a poll where the caller may send a message. Like a
// message it becomes the channel's last message, counts as unread for
// everyone but its author, reopens a closed conversation and, in a
// direct message or group conversation, tells the other participants.
func (s *Service) CreatePoll(ctx context.Context, req *connect.Request[chatv1.CreatePollRequest]) (*connect.Response[chatv1.CreatePollResponse], error) {
	userID := authctx.UserID(ctx)
	poll, err := newPoll(req.Msg.Question, req.Msg.Options, req.Msg.Multiple)
	if err != nil {
		return nil, err
	}
	channel, participants, err := s.writableChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	if err := s.requirePostPolicy(ctx, channel); err != nil {
		return nil, err
	}
	// Read before anything is written: the activity needs the author
	// whether or not the saved row reads back.
	authors, err := s.resolveAuthors(ctx, []string{userID})
	if err != nil {
		return nil, err
	}
	var row messageRow
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		// The channel row before any other (seq.go).
		if _, err := qtx.LockChannel(ctx, channel.ID); err != nil {
			return fmt.Errorf("lock channel: %w", err)
		}
		var err error
		if row, err = recordEvent(ctx, qtx, channel, userID, poll); err != nil {
			return err
		}
		// The author has read their own poll, and everything above it.
		return markChannelRead(ctx, qtx, userID, channel.ID, row.ID)
	})
	if err != nil {
		return nil, err
	}

	// The poll is saved: from here on nothing fails the request. A failed
	// reload answers with no message and sends no event.
	if isDM(channel) {
		s.reopenDM(ctx, channel)
	}
	message, err := s.loadMessage(ctx, row.ID, spaceOf(channel))
	if err != nil {
		slog.Default().Warn("poll: could not reload it", "message_id", row.ID, "err", err)
	} else {
		s.publishTo(channel, participants, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_MessageCreated{MessageCreated: message},
		}))
	}
	// In a channel a poll only marks unread: with no mention, quote or
	// thread, the conversation step is all recordActivity would run.
	if isDM(channel) {
		s.recordActivity(ctx, row, channel, participants, nil, nil, authorOrUnknown(authors, userID), nil)
	}
	return connect.NewResponse(&chatv1.CreatePollResponse{Message: message}), nil
}

// addPollVotes gives each live poll among a page's events its votes, in
// one query, and none when the page holds no poll.
func (s *Service) addPollVotes(ctx context.Context, rows []dbgen.MessageWithReply, rowEvents []systemEvent) error {
	var pollIDs []string
	for index, row := range rows {
		if _, isPoll := rowEvents[index].(pollCreated); isPoll && row.DeletedAt == nil {
			pollIDs = append(pollIDs, row.ID)
		}
	}
	if len(pollIDs) == 0 {
		return nil
	}
	votes, err := s.q.ListPollVotesForMessages(ctx, pollIDs)
	if err != nil {
		return fmt.Errorf("list poll votes: %w", err)
	}
	byPoll := map[string][]dbgen.PollVote{}
	for _, vote := range votes {
		byPoll[vote.MessageID] = append(byPoll[vote.MessageID], vote)
	}
	for index, row := range rows {
		if poll, isPoll := rowEvents[index].(pollCreated); isPoll {
			poll.votes = byPoll[row.ID]
			rowEvents[index] = poll
		}
	}
	return nil
}

var (
	errNotAPoll   = errors.New("that message is not a poll")
	errPollClosed = errors.New("this poll is closed")
)

// pollOf is the poll a row holds, refused as FailedPrecondition when the
// row is anything else: a message, another system row, a tombstone.
func pollOf(row messageRow) (pollCreated, error) {
	if row.Kind != kindPoll || row.DeletedAt != nil {
		return pollCreated{}, connect.NewError(connect.CodeFailedPrecondition, errNotAPoll)
	}
	poll, ok := storedEvent(row.ID, row.Kind, row.Data).(pollCreated)
	if !ok {
		return pollCreated{}, fmt.Errorf("poll %s: its data does not read", row.ID)
	}
	return poll, nil
}

// openPoll is pollOf for a write that needs the poll open: voting, and
// closing it.
func openPoll(row messageRow) (pollCreated, error) {
	poll, err := pollOf(row)
	if err != nil {
		return pollCreated{}, err
	}
	if poll.ClosedAt != nil {
		return pollCreated{}, connect.NewError(connect.CodeFailedPrecondition, errPollClosed)
	}
	return poll, nil
}
