package app

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/getstoop/stoop/internal/buildinfo"
	"github.com/getstoop/stoop/internal/webui"
)

// versionHandler answers GET /version for a client that has to know what
// it is talking to before anyone logs in: the desktop shell confirms the
// name, refuses a server older than it supports, and reads the bridge
// level the served web app speaks. Disclosing the version is deliberate;
// the app's asset hashes give it away anyway.
func versionHandler() http.Handler {
	body, err := json.Marshal(struct {
		Name    string `json:"name"`
		Version string `json:"version"`
		Bridge  int    `json:"bridge"`
	}{
		Name:    "stoop",
		Version: strings.TrimPrefix(buildinfo.Version, "v"),
		Bridge:  webui.Bridge,
	})
	if err != nil {
		panic(err)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(body)
	})
}
