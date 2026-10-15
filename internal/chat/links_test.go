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

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
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
	pool, bus, svc := newTestService(t)
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
		for _, message := range res.Msg.Messages {
			if message.Id == id {
				return message.LinkPreviews
			}
		}
		t.Fatalf("message %s not listed", id)
		return nil
	}

	// A link is fetched (inline here), stored, and delivered as MessageUpdated.
	sent := send("read https://example.com/article and `https://example.com/plain`")
	previews := previewsOf(sent.Id)
	if len(previews) != 1 || previews[0].Title != "An article" || previews[0].SiteName != "Example" || previews[0].ImageFileId == "" || previews[0].ImageWidth != 320 {
		t.Fatalf("previews = %+v", previews)
	}
	if imgs.stored != 1 || uf.fetches["https://example.com/plain"] != 0 {
		t.Errorf("image stored %d, code-span link fetched %d times", imgs.stored, uf.fetches["https://example.com/plain"])
	}
	var sawUpdate bool
	for attempt := 0; attempt < 8 && !sawUpdate; attempt++ {
		select {
		case ev := <-sub.Events():
			if updated := ev.GetMessageUpdated(); updated != nil && updated.Id == sent.Id && len(updated.LinkPreviews) == 1 {
				sawUpdate = true
			}
		default:
			attempt = 8
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
	for attempt := 0; attempt < 16 && !createdWithPreview; attempt++ {
		select {
		case ev := <-sub.Events():
			if created := ev.GetMessageCreated(); created != nil && created.Id == m2.Id && len(created.LinkPreviews) == 1 {
				createdWithPreview = true
			}
		default:
			attempt = 16
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
	if _, err := svc.EditMessage(owner, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: sent.Id, Content: "no links now"})); err != nil {
		t.Fatal(err)
	}
	if len(previewsOf(sent.Id)) != 0 {
		t.Error("edit removed the link but the preview stayed")
	}
	if _, err := svc.EditMessage(owner, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: sent.Id, Content: "now https://example.com/plain"})); err != nil {
		t.Fatal(err)
	}
	if previews := previewsOf(sent.Id); len(previews) != 1 || previews[0].Title != "Plain" {
		t.Errorf("edit added a link but no preview: %+v", previews)
	}
}

// A card is dismissed by its message's author, or by a moderator outside
// DMs, for everyone; an edit keeps it dismissed and doesn't refetch it.
func TestDismissLinkPreview(t *testing.T) {
	pool, _, svc := newTestService(t)
	uf := &fakeUnfurler{fetches: map[string]int{}}
	svc.UseUnfurler(uf, &fakePreviewImages{pool: pool}, chat.UnfurlOptions{Inline: true})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	cal := newUser(t, pool, "cal", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	joinSpace(t, svc, owner, sp.Msg.Space.Id, bea, cal)
	channelID := sp.Msg.DefaultChannel.Id
	send := func(who context.Context, channel, content string) string {
		res, err := svc.SendMessage(who, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channel, Content: content}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message.Id
	}
	previewsOf := func(who context.Context, channel, id string) []*chatv1.LinkPreview {
		res, err := svc.ListMessages(who, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channel}))
		if err != nil {
			t.Fatal(err)
		}
		for _, message := range res.Msg.Messages {
			if message.Id == id {
				return message.LinkPreviews
			}
		}
		t.Fatalf("message %s not listed", id)
		return nil
	}
	dismiss := func(who context.Context, id, url string) error {
		_, err := svc.DismissLinkPreview(who, connect.NewRequest(&chatv1.DismissLinkPreviewRequest{MessageId: id, Url: url}))
		return err
	}
	const article, plain = "https://example.com/article", "https://example.com/plain"

	// The author dismisses one of two cards; the other stays.
	mine := send(bea, channelID, "see "+article+" and "+plain)
	if err := dismiss(bea, mine, article); err != nil {
		t.Fatal(err)
	}
	if previews := previewsOf(cal, channelID, mine); len(previews) != 1 || previews[0].Url != plain {
		t.Fatalf("after dismissing the article, previews = %+v", previews)
	}
	if err := dismiss(bea, mine, "https://example.com/elsewhere"); code(err) != connect.CodeNotFound {
		t.Errorf("a URL the message doesn't link: %v, want not found", err)
	}

	// An edit keeps the dismissal and doesn't fetch the URL again.
	fetches := uf.fetches[article]
	if _, err := svc.EditMessage(bea, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: mine, Content: "still " + article + " and " + plain})); err != nil {
		t.Fatal(err)
	}
	if previews := previewsOf(cal, channelID, mine); len(previews) != 1 || previews[0].Url != plain {
		t.Errorf("after an edit, previews = %+v", previews)
	}
	if uf.fetches[article] != fetches {
		t.Error("an edit refetched a dismissed URL")
	}

	// Another member can't; the space's owner, a moderator, can.
	if err := dismiss(cal, mine, plain); code(err) != connect.CodePermissionDenied {
		t.Errorf("another member dismissing: %v, want permission denied", err)
	}
	if err := dismiss(owner, mine, plain); err != nil {
		t.Fatalf("a moderator dismissing: %v", err)
	}
	if previews := previewsOf(cal, channelID, mine); len(previews) != 0 {
		t.Errorf("after the moderator, previews = %+v", previews)
	}

	// In a DM there is no moderator.
	dm := openDM(t, svc, bea, authctx.UserID(cal))
	inDM := send(bea, dm.Channel.Id, "look "+plain)
	if err := dismiss(cal, inDM, plain); code(err) != connect.CodePermissionDenied {
		t.Errorf("the other person in a DM: %v, want permission denied", err)
	}
	// A token dismisses only where it may post: a dms.post token not in a
	// space, a messages.post token not in a DM.
	withGrant := func(grant authctx.Action) context.Context {
		id, _ := authctx.From(bea)
		id.Credential = authctx.Credential{ID: "t", Kind: authctx.CredentialPersonalToken, Grants: []authctx.Action{grant}}
		return authctx.WithIdentity(context.Background(), id)
	}
	dmOnly, spaceOnly := withGrant(authctx.DMsPost), withGrant(authctx.MessagesPost)
	inSpace := send(bea, channelID, "more "+article)
	if err := dismiss(dmOnly, inSpace, article); code(err) != connect.CodePermissionDenied {
		t.Errorf("a dms.post token in a space: %v, want permission denied", err)
	}
	dmAgain := send(bea, dm.Channel.Id, "again "+article)
	if err := dismiss(spaceOnly, dmAgain, article); code(err) != connect.CodePermissionDenied {
		t.Errorf("a messages.post token in a DM: %v, want permission denied", err)
	}
	if err := dismiss(spaceOnly, inSpace, article); err != nil {
		t.Errorf("a messages.post token on its own space message: %v", err)
	}

	if err := dismiss(bea, inDM, plain); err != nil {
		t.Errorf("the author in a DM: %v", err)
	}
}
