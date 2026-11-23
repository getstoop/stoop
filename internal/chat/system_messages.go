package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/rowid"
)

// System messages (docs/architecture/messaging.md → System messages): a
// messages row whose kind is above 0 records something that happened in
// its channel. author_id is who did it, data holds the kind's own values
// as JSON, and the clients write every word from the event on the wire.

// The messages.kind values. 0 is a message someone wrote; a stored number
// never changes meaning.
const (
	kindMembersAdded      int16 = 1
	kindMemberLeft        int16 = 2
	kindChannelRenamed    int16 = 3
	kindTopicChanged      int16 = 4
	kindMessagePinned     int16 = 5
	kindPostPolicyChanged int16 = 6
)

// systemKind is what the server knows about one kind.
type systemKind struct {
	// quiet: the row marks nothing unread. Stored on the row at insert, so
	// a row keeps the behaviour it was written with.
	quiet bool
	// decode reads a row's data back into the kind's event.
	decode func(data []byte) (systemEvent, error)
}

// systemKinds is the registry: adding a kind is one entry here, its event
// type below and its case in chatv1.SystemEvent.
var systemKinds = map[int16]systemKind{
	kindMembersAdded:      {quiet: true, decode: decodeEvent[membersAdded]},
	kindMemberLeft:        {quiet: true, decode: decodeEvent[memberLeft]},
	kindChannelRenamed:    {quiet: true, decode: decodeEvent[channelRenamed]},
	kindTopicChanged:      {quiet: true, decode: decodeEvent[topicChanged]},
	kindMessagePinned:     {quiet: true, decode: decodeEvent[messagePinned]},
	kindPostPolicyChanged: {quiet: true, decode: decodeEvent[postPolicyChanged]},
}

// systemEvent is one kind's event. Its JSON form is the row's data.
type systemEvent interface {
	kind() int16
	// check refuses an event that must not be stored.
	check() error
	// people are the user ids the event names besides the row's author.
	people() []string
	// referenceID is the message the event is about; "" when none. It is
	// stored on the row, so an event read back does not carry it.
	referenceID() string
	// proto is the event as a client reads it, its people from authors.
	proto(authors map[string]*chatv1.MessageAuthor) *chatv1.SystemEvent
}

func decodeEvent[Event systemEvent](data []byte) (systemEvent, error) {
	var event Event
	if err := json.Unmarshal(data, &event); err != nil {
		return nil, err
	}
	return event, nil
}

// bareEvent is embedded by every event: nothing to check, no people and
// no message, unless the event says otherwise.
type bareEvent struct{}

func (bareEvent) check() error        { return nil }
func (bareEvent) people() []string    { return nil }
func (bareEvent) referenceID() string { return "" }

// membersAdded: the author added these people to a private channel.
type membersAdded struct {
	bareEvent
	UserIDs []string `json:"user_ids"`
}

func (membersAdded) kind() int16 { return kindMembersAdded }

// check: an id that is not a UUID would fail every page holding the row,
// since the people are looked up by id when it is read.
func (event membersAdded) check() error {
	for _, id := range event.UserIDs {
		if err := uuid.Validate(id); err != nil {
			return fmt.Errorf("member %q is not a user id", id)
		}
	}
	return nil
}
func (event membersAdded) people() []string { return event.UserIDs }
func (event membersAdded) proto(authors map[string]*chatv1.MessageAuthor) *chatv1.SystemEvent {
	members := make([]*chatv1.MessageAuthor, len(event.UserIDs))
	for index, id := range event.UserIDs {
		members[index] = authorOrUnknown(authors, id)
	}
	return &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_MembersAdded{MembersAdded: &chatv1.MembersAdded{Members: members}}}
}

// memberLeft: the author left the channel or was removed from it.
type memberLeft struct{ bareEvent }

func (memberLeft) kind() int16 { return kindMemberLeft }
func (memberLeft) proto(map[string]*chatv1.MessageAuthor) *chatv1.SystemEvent {
	return &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_MemberLeft{MemberLeft: &chatv1.MemberLeft{}}}
}

type channelRenamed struct {
	bareEvent
	OldName string `json:"old_name"`
	NewName string `json:"new_name"`
}

func (channelRenamed) kind() int16 { return kindChannelRenamed }
func (event channelRenamed) proto(map[string]*chatv1.MessageAuthor) *chatv1.SystemEvent {
	return &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_ChannelRenamed{
		ChannelRenamed: &chatv1.ChannelRenamed{OldName: event.OldName, NewName: event.NewName},
	}}
}

// topicChanged: the new topic, "" when it was cleared.
type topicChanged struct {
	bareEvent
	Topic string `json:"topic"`
}

func (topicChanged) kind() int16 { return kindTopicChanged }
func (event topicChanged) proto(map[string]*chatv1.MessageAuthor) *chatv1.SystemEvent {
	return &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_TopicChanged{TopicChanged: &chatv1.TopicChanged{Topic: event.Topic}}}
}

// messagePinned: the author pinned MessageID, which is stored in the
// row's reference_message_id and not in its data.
type messagePinned struct {
	bareEvent
	MessageID string `json:"-"`
}

func (messagePinned) kind() int16 { return kindMessagePinned }
func (event messagePinned) check() error {
	if event.MessageID == "" {
		return errors.New("a pin names its message")
	}
	return nil
}
func (event messagePinned) referenceID() string { return event.MessageID }
func (messagePinned) proto(map[string]*chatv1.MessageAuthor) *chatv1.SystemEvent {
	return &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_Pin{Pin: &chatv1.PinEvent{}}}
}

// postPolicyChanged: PostPolicy is the new channels.post_policy value.
type postPolicyChanged struct {
	bareEvent
	PostPolicy string `json:"post_policy"`
}

func (postPolicyChanged) kind() int16 { return kindPostPolicyChanged }
func (event postPolicyChanged) proto(map[string]*chatv1.MessageAuthor) *chatv1.SystemEvent {
	policy := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_EVERYONE
	if event.PostPolicy == postPolicyAdmins {
		policy = chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS
	}
	return &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_PostPolicyChanged{
		PostPolicyChanged: &chatv1.PostPolicyChanged{PostPolicy: policy},
	}}
}

// recordEvent writes the system message for event into channel, by
// actorID, and returns its row. It runs inside the transaction of the
// action it records, and the caller owns both ends of that:
//
//   - Before: the caller takes the channel row (LockChannel) ahead of any
//     other row it writes, as seq.go requires; recordEvent takes the
//     channel's next seq and would otherwise wait on it out of order.
//   - After: recordEvent publishes nothing. Once the transaction has
//     committed the caller publishes MessageCreated for the row, in seq
//     order with whatever else it publishes. The message to publish is
//     s.loadMessage(ctx, row.ID, spaceOf(channel)): the row as every
//     reader is sent it, with the event's people and the reference.
//     toProtoMessage alone fills neither.
//
// It marks nothing read, records no activity and writes no mentions, and
// the channel's post policy does not apply. A quiet row leaves the
// channel's last message alone. An event about a message is refused
// unless that message is shown in this channel.
func recordEvent(ctx context.Context, qtx *dbgen.Queries, channel dbgen.Channel, actorID string, event systemEvent) (messageRow, error) {
	if event == nil {
		return messageRow{}, errors.New("record event: no event")
	}
	registered, ok := systemKinds[event.kind()]
	if !ok {
		return messageRow{}, fmt.Errorf("record event: kind %d is not registered", event.kind())
	}
	if err := event.check(); err != nil {
		return messageRow{}, fmt.Errorf("record event: %w", err)
	}
	var reference *string
	if id := event.referenceID(); id != "" {
		about, err := qtx.GetMessage(ctx, id)
		if err != nil {
			return messageRow{}, fmt.Errorf("record event: read message %s: %w", id, err)
		}
		if about.ChannelID != channel.ID {
			return messageRow{}, fmt.Errorf("record event: message %s is in another channel", id)
		}
		reference = &id
	}
	data, err := json.Marshal(event)
	if err != nil {
		return messageRow{}, fmt.Errorf("record event: encode data: %w", err)
	}
	seq, err := qtx.NextChannelSeq(ctx, channel.ID)
	if err != nil {
		return messageRow{}, fmt.Errorf("next channel seq: %w", err)
	}
	created, err := qtx.CreateSystemMessage(ctx, dbgen.CreateSystemMessageParams{
		ID: rowid.New(), ChannelID: channel.ID, AuthorID: actorID, Seq: seq,
		Kind: event.kind(), Data: data, Quiet: registered.quiet, ReferenceMessageID: reference,
	})
	if err != nil {
		return messageRow{}, fmt.Errorf("create system message: %w", err)
	}
	row := messageRow(created)
	if !row.Quiet {
		if err := qtx.SetChannelLastMessage(ctx, dbgen.SetChannelLastMessageParams{ID: channel.ID, LastMessageID: &row.ID}); err != nil {
			return messageRow{}, fmt.Errorf("bump channel: %w", err)
		}
	}
	return row, nil
}

// errSystemMessage is a write that only makes sense on a message someone
// wrote, aimed at a system message. refuseSystemRow wraps it.
var errSystemMessage = errors.New("that message records something that happened in the channel; it can't be changed")

// refuseSystemRow is the one check for everything that assumes a message
// is something a person wrote: editing it, reacting to it, threading
// under it, quoting or replying to it, pinning it, dismissing its
// previews. It is on the kind, not on a list of kinds, so a new kind is
// refused all of them without anyone adding it anywhere. It answers as a
// placeholder is refused, FailedPrecondition. Deleting one is allowed,
// under its own rule (DeleteMessage). docs/architecture/messaging.md →
// System messages.
func refuseSystemRow(row messageRow) error {
	if row.Kind != 0 {
		return connect.NewError(connect.CodeFailedPrecondition, errSystemMessage)
	}
	return nil
}

// storedEvent is the event a row holds: nil for a message someone wrote,
// for a kind this server does not know (a newer server wrote it) and for
// data that does not read.
func storedEvent(messageID string, kind int16, data []byte) systemEvent {
	registered, ok := systemKinds[kind]
	if !ok {
		return nil
	}
	event, err := registered.decode(data)
	if err != nil {
		slog.Default().Warn("system message: could not read data", "message_id", messageID, "kind", kind, "err", err)
		return nil
	}
	return event
}

// eventProto is Message.event for a row of kind holding event: nil on a
// message someone wrote, and an event with no case set for a row this
// server cannot read, which a client treats as a kind it does not know.
func eventProto(kind int16, event systemEvent, authors map[string]*chatv1.MessageAuthor) *chatv1.SystemEvent {
	switch {
	case kind == 0:
		return nil
	case event == nil:
		return &chatv1.SystemEvent{}
	}
	return event.proto(authors)
}
