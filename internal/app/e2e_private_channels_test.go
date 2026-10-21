package app_test

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// listen opens /ws as a bearer token and collects every frame the server
// sends until the test ends. frames returns what has arrived so far.
func (h *harness) listen(token string) (frames func() string) {
	h.t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(h.srv.URL, "http")+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + token}},
	})
	if err != nil {
		cancel()
		h.t.Fatalf("open socket: %v", err)
	}
	var lock sync.Mutex
	var seen bytes.Buffer
	go func() {
		for {
			_, frame, err := conn.Read(ctx)
			if err != nil {
				return
			}
			lock.Lock()
			seen.Write(frame)
			lock.Unlock()
		}
	}()
	h.t.Cleanup(func() {
		cancel()
		_ = conn.CloseNow()
	})
	return func() string {
		lock.Lock()
		defer lock.Unlock()
		return seen.String()
	}
}

// upload sends one attachment for a channel and returns the reply.
func (h *harness) upload(token, channelID, name, content string) reply {
	h.t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	_ = form.WriteField("channel_id", channelID)
	part, _ := form.CreateFormFile("file", name)
	_, _ = part.Write([]byte(content))
	_ = form.Close()
	return h.post("/files/upload", form.FormDataContentType(), body.String(), "Authorization", "Bearer "+token)
}

// A private channel as someone in the space who is not in it meets it:
// every chat procedure, the upload and download routes and a socket, and
// nothing of the channel comes back. Then an admin outside it, who can
// list it and join but not read; and a webhook's bot, which is added.
func TestE2EPrivateChannelOutsider(t *testing.T) {
	const marker = "permit-came-through"
	site := newHarness(t)
	casey := site.person("casey")
	stoop, general := site.space(casey, "The Stoop")
	ada, bea, dee := site.person("ada"), site.person("bea"), site.person("dee")
	code := site.invite(casey, stoop)
	for _, person := range []string{ada, bea, dee} {
		site.join(person, code)
	}
	site.rpc(casey, "stoop.chat.v1.ChatService/SetMemberRole", map[string]any{
		"spaceId": stoop, "userId": site.userID(dee), "role": "SPACE_ROLE_ADMIN",
	}).expect(t, "ok")

	beaSocket := site.listen(bea)

	created := site.rpc(casey, "stoop.chat.v1.ChatService/CreateChannel", map[string]any{
		"spaceId": stoop, "name": "captains", "private": true,
	}).expect(t, "ok")
	captains := created.str("channel.id")
	if created.body["channel"].(map[string]any)["private"] != true {
		t.Fatalf("the new channel is not private: %s", created.raw)
	}
	site.rpc(casey, "stoop.chat.v1.ChatService/AddChannelMembers", map[string]any{
		"channelId": captains, "userIds": []string{site.userID(ada)},
	}).expect(t, "ok")

	root := site.send(casey, captains, marker+" and the party is the 24th "+site.mention(bea)).expect(t, "ok").str("message.id")
	site.rpc(ada, "stoop.chat.v1.ChatService/SendMessage", map[string]any{
		"channelId": captains, "content": marker + " in a thread", "threadRootId": root,
	}).expect(t, "ok")
	site.rpc(casey, "stoop.chat.v1.ChatService/SetMessagePinned", map[string]any{"messageId": root, "pinned": true}).expect(t, "ok")
	site.rpc(ada, "stoop.chat.v1.ChatService/ToggleReaction", map[string]any{"messageId": root, "emoji": "👍"}).expect(t, "ok")
	fileID := site.upload(ada, captains, "flyer.txt", marker).expectStatus(t, http.StatusCreated).str("id")
	site.rpc(ada, "stoop.chat.v1.ChatService/SendMessage", map[string]any{
		"channelId": captains, "content": "the flyer", "attachmentIds": []string{fileID},
	}).expect(t, "ok")
	site.rpc(ada, "stoop.chat.v1.ChatService/SendMessage", map[string]any{
		"channelId": general, "content": "stolen", "attachmentIds": []string{fileID},
	}).expect(t, "invalid_argument")

	// The people in it read it.
	if got := site.message(ada, captains, marker); got == nil {
		t.Fatal("someone in the channel can't read it")
	}

	chat := "stoop.chat.v1.ChatService/"
	outsider := func(who, token string, admin bool) {
		t.Helper()
		refused := []struct {
			procedure string
			request   map[string]any
		}{
			{chat + "ListMessages", map[string]any{"channelId": captains}},
			{chat + "ListMessages", map[string]any{"channelId": captains, "threadRootId": root}},
			{chat + "ListChanges", map[string]any{"channelId": captains}},
			{chat + "SendMessage", map[string]any{"channelId": captains, "content": "hello?"}},
			{chat + "EditMessage", map[string]any{"messageId": root, "content": "mine now"}},
			{chat + "DeleteMessage", map[string]any{"messageId": root}},
			{chat + "DeleteThread", map[string]any{"messageId": root}},
			{chat + "ToggleReaction", map[string]any{"messageId": root, "emoji": "👀"}},
			{chat + "SetMessagePinned", map[string]any{"messageId": root, "pinned": false}},
			{chat + "ListPinnedMessages", map[string]any{"channelId": captains}},
			{chat + "SetChannelMuted", map[string]any{"channelId": captains, "muted": true}},
			{chat + "MarkChannelRead", map[string]any{"channelId": captains}},
			{chat + "SetThreadMuted", map[string]any{"messageId": root, "muted": true}},
			{chat + "MarkThreadRead", map[string]any{"messageId": root}},
			{chat + "LeaveChannel", map[string]any{"channelId": captains}},
			{"stoop.voice.v1.VoiceService/JoinVoiceChannel", map[string]any{"channelId": captains}},
		}
		if !admin {
			refused = append(refused, []struct {
				procedure string
				request   map[string]any
			}{
				{chat + "ListAllChannels", map[string]any{"spaceId": stoop}},
				{chat + "ListChannelMembers", map[string]any{"channelId": captains}},
				{chat + "AddChannelMembers", map[string]any{"channelId": captains, "userIds": []string{site.userID(token)}}},
				{chat + "RemoveChannelMember", map[string]any{"channelId": captains, "userId": site.userID(ada)}},
				{chat + "UpdateChannel", map[string]any{"channelId": captains, "topic": "mine"}},
				{chat + "DeleteChannel", map[string]any{"channelId": captains}},
			}...)
		}
		for _, call := range refused {
			got := site.rpc(token, call.procedure, call.request)
			if got.code() == "ok" {
				t.Errorf("%s: %s succeeded: %s", who, call.procedure, got.raw)
			}
			if strings.Contains(got.raw, marker) {
				t.Errorf("%s: %s answered with the channel's content: %s", who, call.procedure, got.raw)
			}
		}
		// What they may call returns nothing of the channel.
		for _, call := range []struct {
			procedure string
			request   map[string]any
		}{
			{chat + "ListChannels", map[string]any{"spaceId": stoop}},
			{chat + "SearchMessages", map[string]any{"spaceId": stoop, "query": marker}},
			{chat + "ListActivity", map[string]any{}},
			{chat + "ListThreadMutes", map[string]any{}},
		} {
			got := site.rpc(token, call.procedure, call.request).expect(t, "ok")
			if strings.Contains(got.raw, captains) || strings.Contains(got.raw, marker) {
				t.Errorf("%s: %s shows the channel: %s", who, call.procedure, got.raw)
			}
		}
		site.rpc(token, chat+"SearchMessages", map[string]any{"spaceId": stoop, "query": marker + " in:#captains"}).
			expect(t, "not_found")
		// Nothing else in the space is unread, so a dot on it could only
		// come from the private channel.
		if got := site.rpc(token, chat+"ListSpaces", map[string]any{}).expect(t, "ok"); strings.Contains(got.raw, `"hasUnread":true`) {
			t.Errorf("%s: the space shows as unread because of the private channel: %s", who, got.raw)
		}
		if got := site.get(token, "/files/"+fileID); got.status == http.StatusOK || strings.Contains(got.raw, marker) {
			t.Errorf("%s downloaded the channel's file: %d", who, got.status)
		}
		if got := site.upload(token, captains, "note.txt", "hi"); got.status == http.StatusCreated {
			t.Errorf("%s uploaded into the channel", who)
		}
	}
	outsider("a member outside the channel", bea, false)
	outsider("an admin outside the channel", dee, true)

	// An admin outside it sees it listed in settings, with who is in it,
	// and reads it only after joining.
	all := site.rpc(dee, chat+"ListAllChannels", map[string]any{"spaceId": stoop}).expect(t, "ok")
	if !strings.Contains(all.raw, captains) || !strings.Contains(all.raw, `"memberCount":2`) {
		t.Errorf("settings list: %s", all.raw)
	}
	if people := site.rpc(dee, chat+"ListChannelMembers", map[string]any{"channelId": captains}).expect(t, "ok").list("userIds"); len(people) != 2 {
		t.Errorf("an admin outside the channel sees %d people, want 2", len(people))
	}
	site.rpc(dee, chat+"AddChannelMembers", map[string]any{"channelId": captains, "userIds": []string{site.userID(dee)}}).expect(t, "ok")
	if got := site.message(dee, captains, marker); got == nil {
		t.Error("an admin who joined can't read the channel")
	}
	if got := site.get(dee, "/files/"+fileID); got.status != http.StatusOK {
		t.Errorf("an admin who joined can't download the file: %d", got.status)
	}

	// Removal: the channel and its alerts are gone for that person.
	site.rpc(casey, chat+"RemoveChannelMember", map[string]any{"channelId": captains, "userId": site.userID(dee)}).expect(t, "ok")
	site.list(dee, captains).expect(t, "not_found")
	site.rpc(ada, chat+"LeaveChannel", map[string]any{"channelId": captains}).expect(t, "ok")
	site.list(ada, captains).expect(t, "not_found")
	if got := site.rpc(ada, chat+"ListActivity", map[string]any{}).expect(t, "ok"); strings.Contains(got.raw, marker) {
		t.Errorf("someone who left still has the channel's alerts: %s", got.raw)
	}

	// A webhook into the channel: its bot is added and posts.
	created = site.rpc(casey, "stoop.integrations.v1.IntegrationService/CreateIncoming", map[string]any{
		"channelId": captains, "name": "Uptime Kuma",
	}).expect(t, "ok")
	hook := created.str("url")
	if strings.HasPrefix(hook, "/") {
		hook = site.srv.URL + hook
	}
	site.post(hook, "text/plain", marker+" says the monitor").expectStatus(t, http.StatusOK)
	if got := site.message(casey, captains, "says the monitor"); got == nil {
		t.Error("the webhook's post did not reach the private channel")
	}

	// The space's hook list names it only to someone in the channel.
	hooks := "stoop.integrations.v1.IntegrationService/ListWebhooks"
	if got := site.rpc(bea, hooks, map[string]any{"spaceId": stoop}).expect(t, "ok"); strings.Contains(got.raw, captains) || strings.Contains(got.raw, "Uptime Kuma") {
		t.Errorf("someone outside the channel is shown its webhook: %s", got.raw)
	}
	site.rpc(casey, chat+"AddChannelMembers", map[string]any{"channelId": captains, "userIds": []string{site.userID(ada)}}).expect(t, "ok")
	if got := site.rpc(ada, hooks, map[string]any{"spaceId": stoop}).expect(t, "ok"); !strings.Contains(got.raw, "Uptime Kuma") {
		t.Errorf("someone in the channel is not shown its webhook: %s", got.raw)
	}

	// Nothing of any of it reached the outsider's socket.
	time.Sleep(300 * time.Millisecond)
	if frames := beaSocket(); strings.Contains(frames, captains) || strings.Contains(frames, marker) {
		t.Errorf("the outsider's socket carried the private channel")
	}
}
