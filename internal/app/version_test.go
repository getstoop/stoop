package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/getstoop/stoop/internal/buildinfo"
	"github.com/getstoop/stoop/internal/webui"
)

func TestVersionHandler(t *testing.T) {
	prev := buildinfo.Version
	buildinfo.Version = "v0.4.0"
	t.Cleanup(func() { buildinfo.Version = prev })

	rec := httptest.NewRecorder()
	versionHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/version", nil))
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("code=%d content-type=%q", rec.Code, rec.Header().Get("Content-Type"))
	}
	var got struct {
		Name    string `json:"name"`
		Version string `json:"version"`
		Bridge  int    `json:"bridge"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Name != "stoop" || got.Version != "0.4.0" || got.Bridge != webui.Bridge {
		t.Errorf("got %+v", got)
	}
}
