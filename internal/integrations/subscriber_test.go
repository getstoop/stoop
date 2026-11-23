package integrations

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"google.golang.org/protobuf/encoding/protojson"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
)

// The channel log's seq on the realtime events changes nothing a hook
// receives: message.updated is still the message as protojson, and
// message.deleted is still the two ids (docs/architecture/integrations.md).
func TestTranslatedMessagePayloadsIgnoreTheEventSeq(t *testing.T) {
	fixture := setup(t)
	updated := &chatv1.Message{Id: uuid.NewString(), ChannelId: fixture.channel, SpaceId: fixture.space, Content: "edited", Seq: 7}
	out, ok := fixture.svc.translate(context.Background(), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageUpdated{MessageUpdated: updated},
	}))
	if !ok || out.Type != EventMessageUpdated {
		t.Fatalf("message.updated not translated: %v %+v", ok, out)
	}
	want, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(updated)
	if err != nil {
		t.Fatal(err)
	}
	if string(out.Data) != string(want) {
		t.Errorf("message.updated data = %s, want the message as protojson %s", out.Data, want)
	}

	messageID := uuid.NewString()
	out, ok = fixture.svc.translate(context.Background(), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageDeleted{MessageDeleted: &realtimev1.MessageDeleted{
			MessageId: messageID, ChannelId: fixture.channel, SpaceId: fixture.space, ThreadRootId: uuid.NewString(), Seq: 9,
		}},
	}))
	if !ok || out.Type != EventMessageDeleted {
		t.Fatalf("message.deleted not translated: %v %+v", ok, out)
	}
	var data map[string]any
	if err := json.Unmarshal(out.Data, &data); err != nil {
		t.Fatal(err)
	}
	if len(data) != 2 || data["channel_id"] != fixture.channel || data["message_id"] != messageID {
		t.Errorf("message.deleted data = %s, want exactly channel_id and message_id", out.Data)
	}
}

// A system message is not something a person wrote: hooks get neither its
// message.created nor a message.updated for it, while a message someone
// wrote still goes out.
func TestSystemMessagesAreNotDelivered(t *testing.T) {
	fixture := setup(t)
	system := &chatv1.Message{Id: uuid.NewString(), ChannelId: fixture.channel, SpaceId: fixture.space, Quiet: true,
		Event: &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_TopicChanged{TopicChanged: &chatv1.TopicChanged{Topic: "Friday nights"}}}}
	if out, ok := fixture.svc.translate(context.Background(), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageCreated{MessageCreated: system},
	})); ok {
		t.Errorf("a system message was translated as %s", out.Type)
	}
	if out, ok := fixture.svc.translate(context.Background(), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageUpdated{MessageUpdated: system},
	})); ok {
		t.Errorf("a system message's update was translated as %s", out.Type)
	}
	// An event of a kind this server can't read is still a system message.
	system.Event = &chatv1.SystemEvent{}
	if _, ok := fixture.svc.translate(context.Background(), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageCreated{MessageCreated: system},
	})); ok {
		t.Error("a system message of an unknown kind was translated")
	}
	if out, ok := fixture.svc.translate(context.Background(), message(fixture.channel, fixture.space, "written")); !ok || out.Type != EventMessageCreated {
		t.Errorf("a written message: %v %+v, want message.created", ok, out)
	}
}
