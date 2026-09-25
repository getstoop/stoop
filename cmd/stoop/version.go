package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/getstoop/stoop/internal/buildinfo"
	"github.com/getstoop/stoop/internal/db"
)

// runVersion implements `stoop version`. `--json` adds what the binary
// knows about the schema, for the upgrade tool; it needs no database.
func runVersion(args []string, out io.Writer) int {
	if len(args) == 0 {
		_, _ = fmt.Fprintln(out, "stoop", buildinfo.String())
		return 0
	}
	if len(args) != 1 || args[0] != "--json" {
		fmt.Fprintln(os.Stderr, "usage: stoop version [--json]")
		return 2
	}
	newest, err := db.Newest()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	info := buildinfo.Get()
	body, err := json.Marshal(struct {
		Version   string `json:"version"`
		Commit    string `json:"commit"`
		Date      string `json:"date"`
		Migration int64  `json:"migration"`
		Floor     int64  `json:"floor"`
	}{strings.TrimPrefix(info.Version, "v"), info.Commit, info.Date, newest, db.Floor})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	_, _ = fmt.Fprintln(out, string(body))
	return 0
}
