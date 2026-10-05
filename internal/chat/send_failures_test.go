package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/events"
)

// refuseInserts makes every insert into table fail, as a broken write would.
func refuseInserts(t *testing.T, pool *pgxpool.Pool, table string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		CREATE FUNCTION refuse_insert() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			RAISE EXCEPTION 'refused by the test';
		END $$;
		CREATE TRIGGER refuse_insert BEFORE INSERT ON `+table+` FOR EACH ROW EXECUTE FUNCTION refuse_insert();`); err != nil {
		t.Fatal(err)
	}
}

func messageCount(t *testing.T, pool *pgxpool.Pool, channelID string) int {
	t.Helper()
	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM messages WHERE channel_id = $1`, channelID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

// mentionSpace is casey's space with ada in it, and a subscription to its
// events.
func mentionSpace(t *testing.T) (*pgxpool.Pool, *chat.Service, context.Context, string, *events.Subscription) {
	t.Helper()
	pool, bus, svc := newTestService(t)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	created, err := svc.CreateSpace(casey, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	joinSpace(t, svc, casey, created.Msg.Space.Id, ada)
	spaceEvents := bus.Subscribe(events.SpaceTopic(created.Msg.Space.Id))
	t.Cleanup(spaceEvents.Close)
	return pool, svc, casey, created.Msg.DefaultChannel.Id, spaceEvents
}

// The message is saved before activity is recorded: activity that fails
// to write is logged, and the sender and the channel still see it sent.
func TestFailedActivityDoesNotFailTheSend(t *testing.T) {
	pool, svc, casey, channelID, spaceEvents := mentionSpace(t)
	refuseInserts(t, pool, "activity_items")

	sent, err := svc.SendMessage(casey, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: channelID, Content: "hey @ada",
	}))
	if err != nil {
		t.Fatalf("send reported failure after the message was saved: %v", err)
	}
	if count := messageCount(t, pool, channelID); count != 1 {
		t.Errorf("%d messages in the channel, want 1", count)
	}
	created := nextEvent(t, spaceEvents).GetMessageCreated()
	if created == nil || created.Id != sent.Msg.Message.Id {
		t.Errorf("want MessageCreated for %s, got %v", sent.Msg.Message.Id, created)
	}
}

// A mention row belongs to the message: when it fails to write, nothing
// of the send is kept and nobody is told.
func TestFailedMentionRollsBackTheSend(t *testing.T) {
	pool, svc, casey, channelID, spaceEvents := mentionSpace(t)
	refuseInserts(t, pool, "message_mentions")

	if _, err := svc.SendMessage(casey, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: channelID, Content: "hey @ada",
	})); err == nil {
		t.Fatal("the failed mention write was not reported")
	}
	if count := messageCount(t, pool, channelID); count != 0 {
		t.Errorf("%d messages in the channel after a failed send, want 0", count)
	}
	noEvent(t, spaceEvents)
}
