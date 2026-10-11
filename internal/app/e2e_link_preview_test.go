package app_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/netguard/socks5test"
)

// How much of a linked page a preview reads, and whether links get
// previews at all: the saved setting, else the environment. A page whose
// title sits past the cap gets no preview.
func TestE2ELinkPreviewHTMLCap(t *testing.T) {
	var fetched sync.Map
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<head><!--" + strings.Repeat("a", 3<<19) + "--><title>Late title</title></head>"))
		fetched.Store(r.URL.Path, true)
	}))
	defer site.Close()
	server := newHarness(t, "STOOP_UNFURL_ALLOW_PRIVATE", "true", "STOOP_LINK_PREVIEW_HTML_MB", "1")
	casey := server.person("casey")
	_, channelID := server.space(casey, "Porch")
	status := "stoop.instance.v1.InstanceService/GetInstanceStatus"
	settings := "stoop.instance.v1.InstanceService/UpdateSettings"
	megabytes := func() float64 {
		value, _ := server.rpc("", status, map[string]any{}).expect(t, "ok").body["linkPreviewHtmlMb"].(float64)
		return value
	}
	if megabytes() != 1 {
		t.Errorf("status linkPreviewHtmlMb = %v, want the environment's 1", megabytes())
	}
	server.send(casey, channelID, "under one megabyte "+site.URL+"/one").expect(t, "ok")
	// The cap is read when the fetch starts, so the page must have been
	// fetched before the cap changes.
	for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(20 * time.Millisecond) {
		if _, done := fetched.Load("/one"); done {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the first link was never fetched")
		}
	}

	server.rpc(casey, settings, map[string]any{"linkPreviewHtmlMb": 17}).expect(t, "invalid_argument", "1-16")
	server.rpc(casey, settings, map[string]any{"linkPreviewHtmlMb": 2}).expect(t, "ok")
	if megabytes() != 2 {
		t.Errorf("status linkPreviewHtmlMb = %v, want 2", megabytes())
	}
	server.send(casey, channelID, "under two megabytes "+site.URL+"/two").expect(t, "ok")
	previews := func(contains string) []any {
		list, _ := server.message(casey, channelID, contains)["linkPreviews"].([]any)
		return list
	}
	for deadline := time.Now().Add(10 * time.Second); len(previews("under two")) == 0; time.Sleep(50 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("no preview under a 2 MB cap")
		}
	}
	if title := previews("under two")[0].(map[string]any)["title"]; title != "Late title" {
		t.Errorf("preview title = %v", title)
	}
	if got := previews("under one"); len(got) != 0 {
		t.Errorf("a title past a 1 MB cap still made a preview: %v", got)
	}

	// Off: a link posted meanwhile never gets a preview, even once it is
	// back on.
	server.rpc(casey, settings, map[string]any{"linkPreviews": false}).expect(t, "ok")
	if on, _ := server.rpc("", status, map[string]any{}).expect(t, "ok").body["linkPreviews"].(bool); on {
		t.Error("status linkPreviews stayed on")
	}
	server.send(casey, channelID, "while off "+site.URL+"/off").expect(t, "ok")
	// An edit while off keeps the card of a link it keeps and drops the
	// card of a link it removes.
	const edit = "stoop.chat.v1.ChatService/EditMessage"
	carded := server.message(casey, channelID, "under two")["id"]
	server.rpc(casey, edit, map[string]any{"messageId": carded, "content": "still under two megabytes " + site.URL + "/two"}).expect(t, "ok")
	if got := previews("under two"); len(got) != 1 {
		t.Errorf("an edit that kept the link left %d cards", len(got))
	}
	server.rpc(casey, edit, map[string]any{"messageId": carded, "content": "under two megabytes, link gone"}).expect(t, "ok")
	if got := previews("under two"); len(got) != 0 {
		t.Errorf("an edit that removed the link kept its card: %v", got)
	}
	server.rpc(casey, settings, map[string]any{"linkPreviews": true}).expect(t, "ok")
	server.send(casey, channelID, "back on "+site.URL+"/on").expect(t, "ok")
	for deadline := time.Now().Add(10 * time.Second); len(previews("back on")) == 0; time.Sleep(50 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("no preview after link previews were turned back on")
		}
	}
	if got := previews("while off"); len(got) != 0 {
		t.Errorf("a link posted while previews were off made a preview: %v", got)
	}

	server.rpc(casey, settings, map[string]any{"linkPreviewHtmlMb": 0}).expect(t, "ok")
	if megabytes() != 1 {
		t.Errorf("cleared linkPreviewHtmlMb = %v, want the environment's 1", megabytes())
	}
}

// Preview fetches go through the saved SOCKS5 proxy: the name is looked
// up through it and the proxy is asked for the address. Only an admin
// sets or reads it.
func TestE2ELinkPreviewProxy(t *testing.T) {
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<title>Proxied</title>"))
	}))
	defer site.Close()
	resolver := socks5test.StartResolver(t, map[string]string{"preview.invalid": "203.0.113.7"})
	relay := socks5test.Start(t)
	relay.Route("203.0.113.7:80", site.Listener.Addr().String())
	// A plain-http resolver is only taken with private fetches allowed.
	server := newHarness(t, "STOOP_UNFURL_ALLOW_PRIVATE", "true", "STOOP_LINK_PREVIEW_RESOLVER", resolver)
	casey := server.person("casey")
	ada := server.person("ada")
	_, channelID := server.space(casey, "Porch")
	const read = "stoop.instance.v1.InstanceService/GetReachability"
	const update = "stoop.instance.v1.InstanceService/UpdateSettings"
	proxy := "socks5://" + relay.Addr

	// A refused proxy saves nothing else sent with it.
	refused := server.rpc(casey, update, map[string]any{"linkPreviewProxy": "http://proxy.example:3128", "linkPreviews": false}).expect(t, "invalid_argument", "socks5://host:port")
	if got := refused.field(); got != "link_preview_proxy" {
		t.Errorf("the refusal names field %q", got)
	}
	if on, _ := server.rpc("", "stoop.instance.v1.InstanceService/GetInstanceStatus", map[string]any{}).expect(t, "ok").body["linkPreviews"].(bool); !on {
		t.Error("a refused proxy still turned previews off")
	}
	server.rpc(ada, update, map[string]any{"linkPreviewProxy": proxy}).expect(t, "permission_denied")
	server.rpc(casey, update, map[string]any{"linkPreviewProxy": proxy}).expect(t, "ok")
	if got := server.rpc(casey, read, map[string]any{}).expect(t, "ok").str("linkPreviewProxy"); got != proxy {
		t.Errorf("saved proxy reads back as %q", got)
	}
	server.rpc(ada, read, map[string]any{}).expect(t, "permission_denied")
	if status := server.rpc("", "stoop.instance.v1.InstanceService/GetInstanceStatus", map[string]any{}).expect(t, "ok"); strings.Contains(status.raw, relay.Addr) {
		t.Error("the public status carries the proxy address")
	}

	// The name resolves only at the test resolver, to an address only
	// the proxy routes: a preview can only have come through the proxy.
	server.send(casey, channelID, "look http://preview.invalid/page").expect(t, "ok")
	previews := func() []any {
		list, _ := server.message(casey, channelID, "look")["linkPreviews"].([]any)
		return list
	}
	for deadline := time.Now().Add(10 * time.Second); len(previews()) == 0; time.Sleep(50 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("no preview through the proxy")
		}
	}
	if title := previews()[0].(map[string]any)["title"]; title != "Proxied" {
		t.Errorf("preview title = %v", title)
	}
	asked := relay.Hosts()
	if len(asked) != 2 || asked[1] != "203.0.113.7:80" {
		t.Errorf("the proxy was asked for %v, want the resolver then the checked address", asked)
	}

	server.rpc(casey, update, map[string]any{"linkPreviewProxy": ""}).expect(t, "ok")
	if got := server.rpc(casey, read, map[string]any{}).expect(t, "ok").str("linkPreviewProxy"); got != "" {
		t.Errorf("cleared proxy reads back as %q", got)
	}
}
