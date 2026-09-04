package chat_test

import (
	"context"
	"crypto/sha256"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/chat"
	"github.com/Jhut89/stoop/internal/db/dbtest"
	"github.com/Jhut89/stoop/internal/events"
)

// dbFiles reads file rows straight from the table, as the files-backed
// adapter in internal/app would, and records what it was asked to delete.
type dbFiles struct {
	pool    *pgxpool.Pool
	deleted []string
}

func (d *dbFiles) GetFiles(ctx context.Context, ids []string) ([]chat.FileRecord, error) {
	rows, err := d.pool.Query(ctx,
		`SELECT id, kind, owner_id, COALESCE(space_id::text, ''), name, content_type, size FROM files WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []chat.FileRecord
	for rows.Next() {
		var r chat.FileRecord
		if err := rows.Scan(&r.ID, &r.Kind, &r.OwnerID, &r.SpaceID, &r.Name, &r.ContentType, &r.Size); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (d *dbFiles) DeleteFiles(ctx context.Context, ids []string) error {
	d.deleted = append(d.deleted, ids...)
	_, err := d.pool.Exec(ctx, `DELETE FROM files WHERE id = ANY($1::uuid[])`, ids)
	return err
}

// newFile inserts a pending attachment row as the upload handler would.
func newFile(t *testing.T, pool *pgxpool.Pool, owner context.Context, spaceID, kind, name string) string {
	t.Helper()
	id := uuid.NewString()
	sum := sha256.Sum256([]byte(id))
	_, err := pool.Exec(context.Background(),
		`INSERT INTO files (id, kind, owner_id, space_id, content_type, size, sha256, storage_key, name)
		 VALUES ($1, $2, $3, $4, 'text/plain', 12, $5, $6, $7)`,
		id, kind, authctx.UserID(owner), spaceID, sum[:], kind+"/"+id, name)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestAttachments(t *testing.T) {
	pool := dbtest.New(t)
	files := &dbFiles{pool: pool}
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	svc.UseFiles(files)

	owner := newUser(t, pool, "owner", authctx.RoleMember)
	other := newUser(t, pool, "other", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	sp2, err := svc.CreateSpace(other, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Elsewhere"}))
	if err != nil {
		t.Fatal(err)
	}

	send := func(ctx context.Context, content string, ids ...string) (*chatv1.Message, error) {
		res, err := svc.SendMessage(ctx, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: channelID, Content: content, AttachmentIds: ids,
		}))
		if err != nil {
			return nil, err
		}
		return res.Msg.Message, nil
	}
	countMessages := func() int {
		var n int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM messages WHERE channel_id = $1`, channelID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// Happy path: text plus a file; attachment-only; both render.
	f1 := newFile(t, pool, owner, spaceID, "attachment", "report.txt")
	m1, err := send(owner, "here you go", f1)
	if err != nil {
		t.Fatal(err)
	}
	if len(m1.Attachments) != 1 || m1.Attachments[0].Name != "report.txt" || m1.Attachments[0].FileId != f1 {
		t.Fatalf("attachments on send: %+v", m1.Attachments)
	}
	f2 := newFile(t, pool, owner, spaceID, "attachment", "photo.png")
	m2, err := send(owner, "", f2)
	if err != nil {
		t.Fatalf("attachment-only message: %v", err)
	}
	list, err := svc.ListMessages(owner, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
	if err != nil {
		t.Fatal(err)
	}
	if got := list.Msg.Messages; len(got) != 2 || len(got[0].Attachments) != 1 || got[1].Attachments[0].Name != "photo.png" {
		t.Fatalf("ListMessages attachments: %+v", got)
	}

	// A reply to an attachment-only message previews the file name.
	reply, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: channelID, Content: "nice", ReplyToMessageId: m2.Id,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if got := reply.Msg.Message.ReplyTo.Preview; got != "📎 photo.png" {
		t.Errorf("reply preview = %q", got)
	}
	list, _ = svc.ListMessages(owner, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
	if got := list.Msg.Messages[2].ReplyTo.Preview; got != "📎 photo.png" {
		t.Errorf("listed reply preview = %q", got)
	}

	// Rejections: each leaves no message behind.
	before := countMessages()
	foreign := newFile(t, pool, other, sp2.Msg.Space.Id, "attachment", "theirs.txt")
	wrongSpace := newFile(t, pool, owner, sp2.Msg.Space.Id, "attachment", "elsewhere.txt")
	avatar := newFile(t, pool, owner, spaceID, "avatar", "")
	var many []string
	for i := 0; i < 11; i++ {
		many = append(many, newFile(t, pool, owner, spaceID, "attachment", "n.txt"))
	}
	cases := map[string][]string{
		"someone else's file":  {foreign},
		"file for other space": {wrongSpace},
		"not an attachment":    {avatar},
		"unknown id":           {uuid.NewString()},
		"already used":         {f1},
		"duplicate":            {many[0], many[0]},
		"too many":             many,
	}
	for name, ids := range cases {
		if _, err := send(owner, "x", ids...); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("%s: want InvalidArgument, got %v", name, err)
		}
	}
	if _, err := send(owner, ""); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("empty message without attachments: got %v", err)
	}
	if n := countMessages(); n != before {
		t.Errorf("rejected sends created %d messages", n-before)
	}

	// Deleting the message deletes its files through the port.
	if _, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: m1.Id})); err != nil {
		t.Fatal(err)
	}
	if len(files.deleted) != 1 || files.deleted[0] != f1 {
		t.Errorf("DeleteFiles called with %v, want [%s]", files.deleted, f1)
	}
}
