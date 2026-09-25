package main

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/getstoop/stoop/internal/buildinfo"
	"github.com/getstoop/stoop/internal/db"
)

func TestRunVersion(t *testing.T) {
	prev := buildinfo.Version
	buildinfo.Version = "v0.3.0"
	t.Cleanup(func() { buildinfo.Version = prev })

	var out bytes.Buffer
	if code := runVersion(nil, &out); code != 0 || !bytes.HasPrefix(out.Bytes(), []byte("stoop v0.3.0")) {
		t.Errorf("plain: exit %d, %q", code, out.String())
	}
	out.Reset()
	if code := runVersion([]string{"--json"}, &out); code != 0 {
		t.Fatalf("--json: exit %d, %q", code, out.String())
	}
	var got struct {
		Version   string `json:"version"`
		Migration int64  `json:"migration"`
		Floor     int64  `json:"floor"`
	}
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	newest, _ := db.Newest()
	if got.Version != "0.3.0" || got.Migration != newest || got.Floor != db.Floor {
		t.Errorf("got %+v", got)
	}
	if code := runVersion([]string{"--yaml"}, &out); code != 2 {
		t.Errorf("unknown flag: exit %d", code)
	}
}
