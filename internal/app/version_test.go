package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/getstoop/stoop/internal/buildinfo"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/webui"
)

func TestVersionHandler(t *testing.T) {
	prev := buildinfo.Version
	buildinfo.Version = "v0.4.0"
	t.Cleanup(func() { buildinfo.Version = prev })

	rec := httptest.NewRecorder()
	versionHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/version", nil))
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/json" || rec.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("code=%d content-type=%q cache-control=%q", rec.Code, rec.Header().Get("Content-Type"), rec.Header().Get("Cache-Control"))
	}
	var got struct {
		Name      string `json:"name"`
		Version   string `json:"version"`
		Bridge    int    `json:"bridge"`
		Migration int64  `json:"migration"`
		Floor     int64  `json:"floor"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	newest, _ := db.Newest()
	if got.Name != "stoop" || got.Version != "0.4.0" || got.Bridge != webui.Bridge || got.Migration != newest || got.Floor != db.Floor {
		t.Errorf("got %+v", got)
	}
}
