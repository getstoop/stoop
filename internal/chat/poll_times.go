package chat

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Time polls (docs/architecture/messaging.md → Polls): a poll whose
// options are instants. Everything but creating one is the poll's.

func errPollTime(message string) error {
	return connect.NewError(connect.CodeInvalidArgument, errors.New(message))
}

// newTimePoll is the time poll a request asks for at now, or why it is
// refused: a question, and 2 to 10 times, each rounded down to the whole
// minute, after now and at most a year ahead, no two the same minute.
// The options are the times earliest first, with ids in that order. Like
// newPoll it runs before the caller's access is known, so the count is
// judged before any time is read.
func newTimePoll(question string, times []*timestamppb.Timestamp, multiple bool, now time.Time) (pollCreated, error) {
	question, err := pollQuestion(question)
	if err != nil {
		return pollCreated{}, err
	}
	if len(times) < minPollOptions || len(times) > maxPollOptions {
		return pollCreated{}, errPollTime(fmt.Sprintf("a poll needs %d to %d times", minPollOptions, maxPollOptions))
	}
	latest := yearAhead(now)
	minutes := make([]time.Time, 0, len(times))
	for _, stamp := range times {
		// AsTime refuses nothing: a missing or out-of-range timestamp would
		// read as some other instant.
		if stamp.CheckValid() != nil {
			return pollCreated{}, errPollTime("a poll's time is not a real date and time")
		}
		minute := wholeMinute(stamp.AsTime())
		switch {
		case !minute.After(now):
			return pollCreated{}, errPollTime("a poll's time must be in the future")
		case minute.After(latest):
			return pollCreated{}, errPollTime("a poll's time can be at most a year from now")
		case slices.ContainsFunc(minutes, minute.Equal):
			return pollCreated{}, errPollTime("a poll can't have the same time twice")
		}
		minutes = append(minutes, minute)
	}
	slices.SortFunc(minutes, time.Time.Compare)
	poll := pollCreated{Question: question, Multiple: multiple}
	for index := range minutes {
		poll.Options = append(poll.Options, pollOption{ID: int16(index + 1), At: &minutes[index]})
	}
	return poll, nil
}
