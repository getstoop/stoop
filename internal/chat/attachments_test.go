package chat_test

import (
	"context"
	"crypto/sha256"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/apierr/apierrtest"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

// dbFiles reads file rows straight from the table, as the files-backed
// adapter in internal/app would, and records what it was asked to delete.
type dbFiles struct {
	pool    *pgxpool.Pool
	deleted []string
}

func (d *dbFiles) GetFiles(ctx context.Context, ids []string) ([]chat.FileRecord, error) {
	rows, err := d.pool.Query(ctx,
		`SELECT id, kind, owner_id, COALESCE(space_id::text, ''), COALESCE(private_channel_id::text, ''), name, content_type, size, expired_at IS NOT NULL, COALESCE(width, 0), COALESCE(height, 0) FROM files WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []chat.FileRecord
	for rows.Next() {
		var record chat.FileRecord
		if err := rows.Scan(&record.ID, &record.Kind, &record.OwnerID, &record.SpaceID, &record.PrivateChannelID, &record.Name, &record.ContentType, &record.Size, &record.Expired, &record.Width, &record.Height); err != nil {
			return nil, err
		}
		out = append(out, record)
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
		var count int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM messages WHERE channel_id = $1`, channelID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count
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
	// The size the upload measured travels with the attachment.
	if _, err := pool.Exec(context.Background(), `UPDATE files SET width = 30, height = 40 WHERE id = $1`, f2); err != nil {
		t.Fatal(err)
	}
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
	if photo := list.Msg.Messages[1].Attachments[0]; photo.Width != 30 || photo.Height != 40 {
		t.Errorf("photo size = %d×%d, want 30×40", photo.Width, photo.Height)
	}
	if file := list.Msg.Messages[0].Attachments[0]; file.Width != 0 || file.Height != 0 {
		t.Errorf("text file size = %d×%d, want none", file.Width, file.Height)
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
	for index := 0; index < 11; index++ {
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
		_, err := send(owner, "x", ids...)
		apierrtest.ExpectCode(t, err, connect.CodeInvalidArgument, name)
	}
	_, err = send(owner, "")
	apierrtest.ExpectCode(t, err, connect.CodeInvalidArgument, "empty message without attachments")
	_, err = send(owner, "   \n ")
	apierrtest.ExpectCode(t, err, connect.CodeInvalidArgument, "blank message without attachments")
	_, err = send(owner, "a\x00b", newFile(t, pool, owner, spaceID, "attachment", "nul.txt"))
	apierrtest.ExpectCode(t, err, connect.CodeInvalidArgument, "NUL byte")
	if count := countMessages(); count != before {
		t.Errorf("rejected sends created %d messages", count-before)
	}

	// Blank text with a file is a file-only message.
	blank, err := send(owner, " \n ", newFile(t, pool, owner, spaceID, "attachment", "blank.txt"))
	if err != nil || blank.Content != "" {
		t.Errorf("blank text with a file: %+v %v", blank, err)
	}

	// Deleting the message deletes its files through the port.
	if _, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: m1.Id})); err != nil {
		t.Fatal(err)
	}
	if len(files.deleted) != 1 || files.deleted[0] != f1 {
		t.Errorf("DeleteFiles called with %v, want [%s]", files.deleted, f1)
	}
}
