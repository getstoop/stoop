package chat

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/rowid"
)

// poolUsers reads users from the table, as the app's directory does:
// opening a direct message looks the other person up.
type poolUsers struct{ pool *pgxpool.Pool }

func (users poolUsers) GetUsers(ctx context.Context, ids []string) ([]UserRecord, error) {
	rows, err := users.pool.Query(ctx, `SELECT id, username FROM users WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserRecord
	for rows.Next() {
		var record UserRecord
		if err := rows.Scan(&record.ID, &record.Username); err != nil {
			return nil, err
		}
		out = append(out, record)
	}
	return out, rows.Err()
}

// A message is published before its activity is recorded, so a client
// with the channel or thread on screen can move the marker past it before
// the item exists. The item is then born read, by the rule the markers
// apply later; the refreshed entry of a coalescing kind is left as it
// was, unread. SendMessage can't be interposed from a test, so the write
// queries are driven directly.
func TestActivityItemBornReadBehindTheMarker(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	bus := events.NewInProcBus()
	svc := New(pool, bus, poolUsers{pool})
	queries := dbgen.New(pool)
	person := func(name string) context.Context {
		return authctx.WithIdentity(ctx, authctx.Identity{UserID: dbtest.NewUser(t, pool, name, "member"), Role: authctx.RoleMember})
	}
	owner, bea := person("ada"), person("bea")
	beaID := authctx.UserID(bea)
	space, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := space.Msg.Space.Id, space.Msg.DefaultChannel.Id
	invite, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	send := func(req *chatv1.SendMessageRequest) *chatv1.Message {
		t.Helper()
		res, err := svc.SendMessage(owner, connect.NewRequest(req))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message
	}
	// writeMention records a mention item for bea about a message as
	// notify would, and says whether it was born read.
	writeMention := func(message *chatv1.Message) bool {
		t.Helper()
		items, err := queries.CreateActivityItems(ctx, dbgen.CreateActivityItemsParams{
			Ids: []string{rowid.New()}, UserIds: []string{beaID}, Kind: activityKindMention, SpaceID: &spaceID,
			ChannelID: message.ChannelId, MessageID: message.Id, ActorID: authctx.UserID(owner),
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(items) != 1 {
			t.Fatalf("wrote %d items, want 1", len(items))
		}
		return items[0].ReadAt != nil
	}

	// The channel's marker, for messages the channel shows.
	first := send(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "one"})
	second := send(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "two"})
	if _, err := svc.MarkChannelRead(bea, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: channelID, MessageId: first.Id})); err != nil {
		t.Fatal(err)
	}
	if !writeMention(first) {
		t.Error("mention at the channel marker: born unread")
	}
	if writeMention(second) {
		t.Error("mention past the channel marker: born read")
	}

	// The thread's marker, for a reply only the thread shows; the
	// channel's marker, however far along, says nothing about it.
	root := send(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "a thread"})
	if _, err := svc.MarkChannelRead(bea, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: channelID})); err != nil {
		t.Fatal(err)
	}
	inThread := send(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "reply one", ThreadRootId: root.Id})
	later := send(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "reply two", ThreadRootId: root.Id})
	if writeMention(inThread) {
		t.Error("mention in a thread the reader never opened: born read")
	}
	if _, err := svc.MarkThreadRead(bea, connect.NewRequest(&chatv1.MarkThreadReadRequest{MessageId: root.Id, ReplyId: inThread.Id})); err != nil {
		t.Fatal(err)
	}
	if !writeMention(inThread) {
		t.Error("mention at the thread marker: born unread")
	}
	if writeMention(later) {
		t.Error("mention past the thread marker: born read")
	}

	// The feed does not count what was born read.
	list, err := svc.ListActivity(bea, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	read, unread := 0, 0
	for _, item := range list.Msg.Items {
		if item.ReadAt != nil {
			read++
		} else {
			unread++
		}
	}
	// Born read: the first, and the thread mention written after the
	// thread read. Read by a marker: the second, by the channel read, and
	// the earlier thread mention, by the thread read. Unread: the last.
	if read != 4 || unread != 1 || list.Msg.UnreadCount != 1 {
		t.Errorf("feed: %d read, %d unread, unread_count %d; want 4, 1 and 1", read, unread, list.Msg.UnreadCount)
	}
	if count, err := queries.CountUnreadActivity(ctx, beaID); err != nil || int(count) != unread {
		t.Errorf("CountUnreadActivity = %d (%v), want %d", count, err, unread)
	}

	// The channel's marker, however far past the replies' ids, says
	// nothing about a reply only the thread shows.
	after := send(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "three"})
	if _, err := svc.MarkChannelRead(bea, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: channelID, MessageId: after.Id})); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM activity_items WHERE user_id = $1 AND message_id = ANY($2::uuid[])`, beaID, []string{inThread.Id, later.Id}); err != nil {
		t.Fatal(err)
	}
	if !writeMention(inThread) {
		t.Error("thread mention at the thread marker, channel marker past it: born unread")
	}
	if writeMention(later) {
		t.Error("thread mention past the thread marker, channel marker past it: born read")
	}

	// A thread_reply item stands for the thread, so only the thread's
	// marker reads it, though its reply is also shown in the channel.
	alsoSent := send(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "for everyone", ThreadRootId: root.Id, AlsoSendToChannel: true})
	if _, err := svc.MarkChannelRead(bea, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: channelID, MessageId: alsoSent.Id})); err != nil {
		t.Fatal(err)
	}
	threadReply := func() *dbgen.UpsertUnreadActivityItemsRow {
		t.Helper()
		if _, err := pool.Exec(ctx, `DELETE FROM activity_items WHERE user_id = $1 AND kind = 'thread_reply'`, beaID); err != nil {
			t.Fatal(err)
		}
		rows, err := queries.UpsertUnreadActivityItems(ctx, dbgen.UpsertUnreadActivityItemsParams{
			Ids: []string{rowid.New()}, UserIds: []string{beaID}, Kind: activityKindThreadReply, SpaceID: &spaceID,
			ChannelID: channelID, MessageID: alsoSent.Id, ActorID: authctx.UserID(owner), ThreadRootID: &root.Id,
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 1 {
			t.Fatalf("upserted %d rows, want 1", len(rows))
		}
		return &rows[0]
	}
	if threadReply().ReadAt != nil {
		t.Error("thread_reply for an also-sent reply, channel marker at it: born read")
	}
	if _, err := svc.MarkThreadRead(bea, connect.NewRequest(&chatv1.MarkThreadReadRequest{MessageId: root.Id, ReplyId: alsoSent.Id})); err != nil {
		t.Fatal(err)
	}
	if threadReply().ReadAt == nil {
		t.Error("thread_reply for an also-sent reply, thread marker at it: born unread")
	}

	// A coalescing kind: a new entry is born read the same way, and a
	// refreshed one stays unread whatever the marker says.
	dm, err := svc.OpenDirectMessage(owner, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{beaID}}))
	if err != nil {
		t.Fatal(err)
	}
	dmID := dm.Msg.DirectMessage.Channel.Id
	if _, err := pool.Exec(ctx, `DELETE FROM activity_items WHERE user_id = $1`, beaID); err != nil {
		t.Fatal(err)
	}
	upsert := func(message *chatv1.Message) dbgen.UpsertUnreadActivityItemsRow {
		t.Helper()
		rows, err := queries.UpsertUnreadActivityItems(ctx, dbgen.UpsertUnreadActivityItemsParams{
			Ids: []string{rowid.New()}, UserIds: []string{beaID}, Kind: activityKindDM,
			ChannelID: dmID, MessageID: message.Id, ActorID: authctx.UserID(owner),
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 1 {
			t.Fatalf("upserted %d rows, want 1", len(rows))
		}
		return rows[0]
	}
	hello := send(&chatv1.SendMessageRequest{ChannelId: dmID, Content: "hello"})
	if _, err := pool.Exec(ctx, `DELETE FROM activity_items WHERE user_id = $1`, beaID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MarkChannelRead(bea, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: dmID})); err != nil {
		t.Fatal(err)
	}
	if entry := upsert(hello); entry.ReadAt == nil {
		t.Error("new DM entry at the marker: born unread")
	}
	again := send(&chatv1.SendMessageRequest{ChannelId: dmID, Content: "again"})
	if _, err := pool.Exec(ctx, `DELETE FROM activity_items WHERE user_id = $1`, beaID); err != nil {
		t.Fatal(err)
	}
	entry := upsert(again)
	if entry.ReadAt != nil {
		t.Fatal("new DM entry past the marker: born read")
	}
	// With the marker past the newest message, a refresh of an unread
	// entry only repoints it.
	more := send(&chatv1.SendMessageRequest{ChannelId: dmID, Content: "more"})
	if _, err := svc.MarkChannelRead(bea, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: dmID})); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE activity_items SET read_at = NULL WHERE id = $1`, entry.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM activity_items WHERE user_id = $1 AND id <> $2`, beaID, entry.ID); err != nil {
		t.Fatal(err)
	}
	refreshed := upsert(more)
	if refreshed.ID != entry.ID || refreshed.ReadAt != nil || refreshed.MessageID == nil || *refreshed.MessageID != more.Id {
		t.Errorf("refreshed entry: id %s (want %s), read_at %v, message %v", refreshed.ID, entry.ID, refreshed.ReadAt, refreshed.MessageID)
	}
}
