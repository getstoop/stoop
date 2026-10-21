package chat_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// channelStamps reads every row of a channel with the position it holds.
func channelStamps(t *testing.T, pool *pgxpool.Pool, channelID string) map[string]int64 {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT id, seq FROM messages WHERE channel_id = $1`, channelID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	stamps := map[string]int64{}
	for rows.Next() {
		var id string
		var seq *int64
		if err := rows.Scan(&id, &seq); err != nil {
			t.Fatal(err)
		}
		if seq == nil {
			t.Fatalf("row %s has no seq", id)
		}
		stamps[id] = *seq
	}
	return stamps
}

// ids is the order of a list of messages.
func ids(messages []*chatv1.Message) []string {
	out := make([]string, len(messages))
	for index, message := range messages {
		out[index] = message.Id
	}
	return out
}

// ListChanges is the channel log from a position: every row stamped above
// it, tombstones and thread replies included, each once at its latest
// position, in seq order (docs/architecture/messaging.md → History).
func TestListChangesWalksTheChannelLog(t *testing.T) {
	pool, _, svc := newTestService(t)
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	channelID := sp.Msg.DefaultChannel.Id
	send := func(req *chatv1.SendMessageRequest) *chatv1.Message {
		t.Helper()
		req.ChannelId = channelID
		res, err := svc.SendMessage(owner, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("send %q: %v", req.Content, err)
		}
		return res.Msg.Message
	}
	remove := func(id string) {
		t.Helper()
		if _, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: id})); err != nil {
			t.Fatalf("delete %s: %v", id, err)
		}
	}
	changes := func(since int64, limit int32) *chatv1.ListChangesResponse {
		t.Helper()
		res, err := svc.ListChanges(owner, connect.NewRequest(&chatv1.ListChangesRequest{ChannelId: channelID, SinceSeq: since, Limit: limit}))
		if err != nil {
			t.Fatalf("list changes since %d: %v", since, err)
		}
		return res.Msg
	}

	// Every kind of write, in one channel.
	first := send(&chatv1.SendMessageRequest{Content: "first"})
	second := send(&chatv1.SendMessageRequest{Content: "second"})
	reply := send(&chatv1.SendMessageRequest{Content: "a reply", ThreadRootId: first.Id})
	if _, err := svc.EditMessage(owner, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: first.Id, Content: "first, edited"})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ToggleReaction(owner, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: second.Id, Emoji: "👍"})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetMessagePinned(owner, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: second.Id, Pinned: true})); err != nil {
		t.Fatal(err)
	}
	gone := send(&chatv1.SendMessageRequest{Content: "going"})
	remove(gone.Id)
	goneReply := send(&chatv1.SendMessageRequest{Content: "a reply, going", ThreadRootId: first.Id})
	remove(goneReply.Id)
	// The root with a live reply left becomes a placeholder.
	remove(first.Id)
	root := send(&chatv1.SendMessageRequest{Content: "a thread to moderate"})
	threadReply := send(&chatv1.SendMessageRequest{Content: "its reply", ThreadRootId: root.Id})
	if _, err := svc.DeleteThread(owner, connect.NewRequest(&chatv1.DeleteThreadRequest{MessageId: root.Id})); err != nil {
		t.Fatal(err)
	}

	stamps := channelStamps(t, pool, channelID)
	counter := channelSeq(t, pool, channelID)

	// From zero: the whole log, every row once, at the position it holds,
	// strictly increasing.
	full := changes(0, 0)
	if full.ChannelSeq != counter {
		t.Errorf("channel_seq = %d, want the counter %d", full.ChannelSeq, counter)
	}
	if full.HasMore {
		t.Error("has_more on a page holding the whole log")
	}
	if len(full.Messages) != len(stamps) {
		t.Fatalf("the log lists %d rows, the channel has %d", len(full.Messages), len(stamps))
	}
	byID := map[string]*chatv1.Message{}
	var last int64
	for _, message := range full.Messages {
		if message.Seq <= last {
			t.Errorf("row %s at %d after %d: not strictly increasing", message.Id, message.Seq, last)
		}
		last = message.Seq
		if message.Seq != stamps[message.Id] {
			t.Errorf("row %s listed at %d, stamped %d", message.Id, message.Seq, stamps[message.Id])
		}
		if message.ChannelId != channelID {
			t.Errorf("row %s belongs to channel %s", message.Id, message.ChannelId)
		}
		if _, twice := byID[message.Id]; twice {
			t.Errorf("row %s is listed twice", message.Id)
		}
		byID[message.Id] = message
	}
	// Each row's shape is the one the client would see it in.
	if row := byID[gone.Id]; row == nil || !row.Deleted || row.Content != "" || len(row.Attachments)+len(row.Reactions)+len(row.LinkPreviews) != 0 || row.Pinned || row.Thread != nil {
		t.Errorf("a deleted top-level message = %+v, want a bare tombstone", row)
	}
	if row := byID[goneReply.Id]; row == nil || !row.Deleted || row.Content != "" || row.InChannel || row.ThreadRootId != first.Id {
		t.Errorf("a deleted reply = %+v, want a tombstone in its thread", row)
	}
	if row := byID[first.Id]; row == nil || !row.Deleted || row.Content != "" || row.Thread.GetReplyCount() != 1 {
		t.Errorf("the placeholder root = %+v, want deleted with one reply", row)
	}
	if row := byID[reply.Id]; row == nil || row.Deleted || row.InChannel || row.ThreadRootId != first.Id || row.Content != "a reply" {
		t.Errorf("the live reply = %+v, want it in its thread", row)
	}
	if row := byID[second.Id]; row == nil || row.Deleted || !row.Pinned || len(row.Reactions) != 1 || row.Content != "second" {
		t.Errorf("the pinned, reacted message = %+v", row)
	}
	if row := byID[root.Id]; row == nil || !row.Deleted || row.Thread != nil {
		t.Errorf("the moderated root = %+v, want a tombstone with no summary", row)
	}
	if row := byID[threadReply.Id]; row == nil || !row.Deleted || row.ThreadRootId != root.Id {
		t.Errorf("the moderated reply = %+v, want a tombstone in its thread", row)
	}

	// From a position: exactly the rows stamped after it.
	cut := full.Messages[len(full.Messages)/2].Seq
	var wantAfter []string
	for _, message := range full.Messages {
		if message.Seq > cut {
			wantAfter = append(wantAfter, message.Id)
		}
	}
	if got := ids(changes(cut, 0).Messages); !slices.Equal(got, wantAfter) {
		t.Errorf("changes since %d = %v, want %v", cut, got, wantAfter)
	}
	if got := changes(counter, 0); len(got.Messages) != 0 || got.HasMore {
		t.Errorf("changes since the counter = %v, has_more %v, want none", got.Messages, got.HasMore)
	}

	// Paging walks the whole log, has_more saying when to go on.
	var walked []*chatv1.Message
	var cursor int64
	for pages := 0; ; pages++ {
		page := changes(cursor, 3)
		if len(page.Messages) > 3 {
			t.Fatalf("a page of 3 holds %d rows", len(page.Messages))
		}
		walked = append(walked, page.Messages...)
		if !page.HasMore {
			break
		}
		if len(page.Messages) != 3 {
			t.Fatalf("has_more on a page of %d", len(page.Messages))
		}
		cursor = page.Messages[len(page.Messages)-1].Seq
		if pages > len(stamps) {
			t.Fatal("paging never ends")
		}
	}
	if !slices.Equal(ids(walked), ids(full.Messages)) {
		t.Errorf("paged %v, want %v", ids(walked), ids(full.Messages))
	}
	for index, message := range walked {
		if message.Seq != full.Messages[index].Seq {
			t.Errorf("paged row %s at %d, want %d", message.Id, message.Seq, full.Messages[index].Seq)
		}
	}

	// A write after a load is a change to ask for.
	late := send(&chatv1.SendMessageRequest{Content: "late"})
	if got := changes(counter, 0); len(got.Messages) != 1 || got.Messages[0].Id != late.Id || got.Messages[0].Seq != late.Seq || got.ChannelSeq != counter+1 {
		t.Errorf("changes since %d after one send = %v (channel_seq %d)", counter, ids(got.Messages), got.ChannelSeq)
	}
}

// The retention floor comes with every list: nothing while retention is
// off, the sweep's cutoff for the moment of the answer with it on, and
// every row that exists is above it.
func TestListsCarryTheRetentionFloor(t *testing.T) {
	pool, _, svc := newTestService(t)
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	channelID := sp.Msg.DefaultChannel.Id
	sent, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "kept"}))
	if err != nil {
		t.Fatal(err)
	}
	floors := func() (changes, page string) {
		t.Helper()
		changed, err := svc.ListChanges(owner, connect.NewRequest(&chatv1.ListChangesRequest{ChannelId: channelID}))
		if err != nil {
			t.Fatal(err)
		}
		listed, err := svc.ListMessages(owner, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
		if err != nil {
			t.Fatal(err)
		}
		return changed.Msg.RetentionFloorId, listed.Msg.RetentionFloorId
	}

	if changes, page := floors(); changes != "" || page != "" {
		t.Errorf("floors with no policy = %q, %q, want none", changes, page)
	}
	svc.UseInstancePolicy(retentionPolicy(0))
	if changes, page := floors(); changes != "" || page != "" {
		t.Errorf("floors with retention off = %q, %q, want none", changes, page)
	}

	svc.UseInstancePolicy(retentionPolicy(30))
	asked := time.Now()
	changes, page := floors()
	for _, floor := range []string{changes, page} {
		parsed, err := uuid.Parse(floor)
		if err != nil || parsed.Version() != 7 {
			t.Fatalf("floor %q is not a UUIDv7: %v", floor, err)
		}
		sec, nsec := parsed.Time().UnixTime()
		cutoff := time.Unix(sec, nsec)
		if want := asked.Add(-30 * 24 * time.Hour); cutoff.Sub(want).Abs() > 5*time.Second {
			t.Errorf("floor %s is for %v, want thirty days before %v", floor, cutoff, asked)
		}
		if sent.Msg.Message.Id < floor {
			t.Errorf("the message just sent, %s, is below the floor %s", sent.Msg.Message.Id, floor)
		}
	}
}

// ListChanges is read under ListMessages's gate: someone outside the space
// is refused, someone in the space but outside a private channel does not
// find it, and a credential without messages.read is refused, each with
// the code ListMessages gives.
func TestListChangesIsGatedLikeListMessages(t *testing.T) {
	fixture := newPrivateFixture(t)
	stranger := newUser(t, fixture.pool, "stranger", authctx.RoleMember)
	identity, _ := authctx.From(fixture.bea)
	identity.Credential = authctx.Credential{
		Kind: authctx.CredentialPersonalToken, Grants: []authctx.Action{authctx.SpaceRead},
	}
	noReading := authctx.WithIdentity(context.Background(), identity)

	for _, tc := range []struct {
		name    string
		who     context.Context
		channel string
		want    connect.Code
	}{
		{"someone outside the space", stranger, fixture.generalID, connect.CodePermissionDenied},
		{"someone outside the space, a private channel", stranger, fixture.secretID, connect.CodeNotFound},
		{"a member outside the private channel", fixture.cal, fixture.secretID, connect.CodeNotFound},
		{"a token without messages.read", noReading, fixture.generalID, connect.CodePermissionDenied},
		{"someone in the private channel", fixture.bea, fixture.secretID, 0},
	} {
		_, changesErr := fixture.svc.ListChanges(tc.who, connect.NewRequest(&chatv1.ListChangesRequest{ChannelId: tc.channel}))
		_, listErr := fixture.svc.ListMessages(tc.who, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: tc.channel}))
		if code(changesErr) != tc.want {
			t.Errorf("%s: ListChanges %v, want %v", tc.name, changesErr, tc.want)
		}
		if code(changesErr) != code(listErr) {
			t.Errorf("%s: ListChanges %v but ListMessages %v", tc.name, changesErr, listErr)
		}
	}
}
