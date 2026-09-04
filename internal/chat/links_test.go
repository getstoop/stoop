package chat_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"sync"
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

type fakeUnfurler struct {
	mu      sync.Mutex
	fetches map[string]int
}

func (f *fakeUnfurler) Fetch(_ context.Context, url string) (chat.LinkMeta, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fetches[url]++
	switch url {
	case "https://example.com/article":
		return chat.LinkMeta{Title: "An article", Description: "About things", SiteName: "Example", Image: []byte("img")}, nil
	case "https://example.com/plain":
		return chat.LinkMeta{Title: "Plain"}, nil
	default:
		return chat.LinkMeta{}, errors.New("unreachable")
	}
}

// fakePreviewImages stands in for the files module but still writes a
// real files row: link_previews.image_file_id is a foreign key, so a
// made-up id would make the preview silently fail to save.
type fakePreviewImages struct {
	pool   *pgxpool.Pool
	stored int
}

func (f *fakePreviewImages) StoreLinkPreviewImage(ctx context.Context, ownerID string, _ []byte) (string, int, int, error) {
	f.stored++
	id := uuid.NewString()
	sum := sha256.Sum256([]byte(id))
	_, err := f.pool.Exec(ctx,
		`INSERT INTO files (id, kind, owner_id, content_type, size, sha256, storage_key)
		 VALUES ($1, 'link_preview', $2, 'image/png', 3, $3, $4)`,
		id, ownerID, sum[:], "link_preview/"+id)
	if err != nil {
		return "", 0, 0, err
	}
	return id, 320, 180, nil
}

func TestLinkPreviews(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	uf := &fakeUnfurler{fetches: map[string]int{}}
	imgs := &fakePreviewImages{pool: pool}
	svc.UseUnfurler(uf, imgs, chat.UnfurlOptions{Inline: true})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	channelID := sp.Msg.DefaultChannel.Id
	sub := bus.Subscribe("space:" + sp.Msg.Space.Id)
	defer sub.Close()
	send := func(content string) *chatv1.Message {
		res, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: content}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message
	}
	previewsOf := func(id string) []*chatv1.LinkPreview {
		res, err := svc.ListMessages(owner, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range res.Msg.Messages {
			if m.Id == id {
				return m.LinkPreviews
			}
		}
		t.Fatalf("message %s not listed", id)
		return nil
	}

	// A link is fetched (inline here), stored, and delivered as MessageUpdated.
	m := send("read https://example.com/article and `https://example.com/plain`")
	p := previewsOf(m.Id)
	if len(p) != 1 || p[0].Title != "An article" || p[0].SiteName != "Example" || p[0].ImageFileId == "" || p[0].ImageWidth != 320 {
		t.Fatalf("previews = %+v", p)
	}
	if imgs.stored != 1 || uf.fetches["https://example.com/plain"] != 0 {
		t.Errorf("image stored %d, code-span link fetched %d times", imgs.stored, uf.fetches["https://example.com/plain"])
	}
	var sawUpdate bool
	for i := 0; i < 8 && !sawUpdate; i++ {
		select {
		case ev := <-sub.Events():
			if u := ev.GetMessageUpdated(); u != nil && u.Id == m.Id && len(u.LinkPreviews) == 1 {
				sawUpdate = true
			}
		default:
			i = 8
		}
	}
	if !sawUpdate {
		t.Error("expected a MessageUpdated carrying the preview")
	}

	// The same URL in another message is served from the cache, and comes
	// back on the send response itself.
	m2 := send("again https://example.com/article")
	if uf.fetches["https://example.com/article"] != 1 {
		t.Errorf("cached URL refetched: %d", uf.fetches["https://example.com/article"])
	}
	if len(m2.LinkPreviews) != 1 {
		t.Errorf("cached preview should be on the send response, got %+v", m2.LinkPreviews)
	}
	// …and on the MessageCreated event, which is what clients render.
	var createdWithPreview bool
	for i := 0; i < 16 && !createdWithPreview; i++ {
		select {
		case ev := <-sub.Events():
			if c := ev.GetMessageCreated(); c != nil && c.Id == m2.Id && len(c.LinkPreviews) == 1 {
				createdWithPreview = true
			}
		default:
			i = 16
		}
	}
	if !createdWithPreview {
		t.Error("MessageCreated for a cached link must carry the preview")
	}

	// A failing URL is remembered as failed: no preview, no retry storm.
	m3 := send("https://example.com/404 twice https://example.com/404")
	if len(previewsOf(m3.Id)) != 0 || uf.fetches["https://example.com/404"] != 1 {
		t.Errorf("failed url: previews=%v fetches=%d", previewsOf(m3.Id), uf.fetches["https://example.com/404"])
	}

	// Editing the text re-resolves links: removing the URL drops the preview.
	if _, err := svc.EditMessage(owner, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: m.Id, Content: "no links now"})); err != nil {
		t.Fatal(err)
	}
	if len(previewsOf(m.Id)) != 0 {
		t.Error("edit removed the link but the preview stayed")
	}
	if _, err := svc.EditMessage(owner, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: m.Id, Content: "now https://example.com/plain"})); err != nil {
		t.Fatal(err)
	}
	if p := previewsOf(m.Id); len(p) != 1 || p[0].Title != "Plain" {
		t.Errorf("edit added a link but no preview: %+v", p)
	}
}
