package chat_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// A thread goes by its root's age: an expired root takes its newer
// replies and their files; a pinned root keeps its thread.
func TestRetentionSweepsThreadsByRoot(t *testing.T) {
	pool, _, svc := newTestService(t)
	files := &dbFiles{pool: pool}
	svc.UseFiles(files)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	sp, err := svc.CreateSpace(casey, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	send := func(content, threadRoot string, attachments ...string) *chatv1.Message {
		t.Helper()
		res, err := svc.SendMessage(casey, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: channelID, Content: content, ThreadRootId: threadRoot, AttachmentIds: attachments,
		}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message
	}

	expiring := send("old root", "")
	kept := send("pinned root", "")
	if _, err := svc.SetMessagePinned(casey, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: kept.Id, Pinned: true})); err != nil {
		t.Fatal(err)
	}
	// The cutoff falls between the roots and the replies, so the replies
	// are young enough to keep on their own.
	cutoff := time.Now()
	time.Sleep(20 * time.Millisecond)
	photo := newFile(t, pool, casey, spaceID, "attachment", "ladder.jpg")
	send("recent reply", expiring.Id, photo)
	send("reply under the pinned root", kept.Id)
	now := cutoff.Add(30 * 24 * time.Hour)
	svc.UseInstancePolicy(retentionPolicy(30))

	count, err := svc.CountExpiredMessages(context.Background(), now, 30)
	if err != nil || count != 2 {
		t.Errorf("count = %d %v, want 2 (the old root and its reply)", count, err)
	}
	swept, err := svc.SweepMessages(context.Background(), now)
	if err != nil || swept != 2 {
		t.Fatalf("swept = %d %v, want 2", swept, err)
	}
	if !slices.Contains(files.deleted, photo) {
		t.Errorf("the reply's file was not deleted: %v", files.deleted)
	}

	var left []string
	rows, err := pool.Query(context.Background(), `SELECT content FROM messages ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var content string
		if err := rows.Scan(&content); err != nil {
			t.Fatal(err)
		}
		left = append(left, content)
	}
	if want := []string{"pinned root", "reply under the pinned root"}; !slices.Equal(left, want) {
		t.Errorf("left = %v, want %v", left, want)
	}
}
