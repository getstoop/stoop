package app_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// How much of a linked page a preview reads: the saved setting, else the
// environment. A page whose title sits past the cap gets no preview.
func TestE2ELinkPreviewHTMLCap(t *testing.T) {
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<head><!--" + strings.Repeat("a", 3<<19) + "--><title>Late title</title></head>"))
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

	server.rpc(casey, settings, map[string]any{"linkPreviewHtmlMb": 0}).expect(t, "ok")
	if megabytes() != 1 {
		t.Errorf("cleared linkPreviewHtmlMb = %v, want the environment's 1", megabytes())
	}
}
