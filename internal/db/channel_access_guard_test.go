package db_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// channelReadsWithoutTheView names the queries that read the channels
// table without asking channel_readers who may read each one, and why
// that is right for each. A new query that reads channels for a person
// joins the view; one that has a reason not to is added here with it.
var channelReadsWithoutTheView = map[string]string{
	"GetChannel":                 "one row by id; every caller checks access itself (accessChannel, requireManageChannel)",
	"LockChannel":                "a row lock inside DeleteChannel and the message deletes, after their permission checks (internal/chat/seq.go)",
	"ShareChannel":               "a shared row lock inside MarkChannelRead and MarkThreadRead, after accessChannel",
	"CountPublicChannelsInSpace": "counts the channels everyone sees, for the last-channel rule",
	"ListChannelIDsByKind":       "a space's voice rooms to clear on a kick; ids only, never returned to a client",
	"ListAllChannelsBySpace":     "Space settings for channels.manage: every channel, with who is in each",
	"ListLinkableChannelsByIDs":  "a sent message's channel links: public channels only, of the space the sender is posting in",
	"ListChannelNamesByIDs":      "previews' channel links: public text channels only, whatever ID a stored token holds",
}

var (
	queryName     = regexp.MustCompile(`(?m)^-- name: (\w+) :\w+\n`)
	readsChannels = regexp.MustCompile(`(?i)\b(FROM|JOIN)\s+channels\b`)
	isRead        = regexp.MustCompile(`(?is)^\s*(SELECT|WITH)\b`)
)

// Who may read a channel is written once, in the channel_readers view.
// This fails when a query reads channels for someone without it, or
// names the people list of a private channel outside its own file.
func TestQueriesAskTheViewWhoMayReadAChannel(t *testing.T) {
	files, err := filepath.Glob("queries/*/*.sql")
	if err != nil || len(files) == 0 {
		t.Fatalf("no query files found: %v", err)
	}
	excused := map[string]bool{}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		text := string(raw)
		if strings.Contains(text, "channel_members") && filepath.Base(file) != "channel_members.sql" {
			t.Errorf("%s names channel_members: only queries/chat/channel_members.sql and the channel_readers view may", file)
		}
		starts := queryName.FindAllStringSubmatchIndex(text, -1)
		for index, start := range starts {
			name := text[start[2]:start[3]]
			end := len(text)
			if index+1 < len(starts) {
				end = starts[index+1][0]
			}
			body := stripComments(text[start[1]:end])
			if !isRead.MatchString(body) || !readsChannels.MatchString(body) {
				continue
			}
			if strings.Contains(body, "channel_readers") || strings.Contains(body, "dm_members") {
				continue
			}
			if _, ok := channelReadsWithoutTheView[name]; ok {
				excused[name] = true
				continue
			}
			t.Errorf("%s (%s) reads channels without channel_readers: join the view, or add it to channelReadsWithoutTheView with the reason", name, file)
		}
	}
	for name := range channelReadsWithoutTheView {
		if !excused[name] {
			t.Errorf("%s is excused in channelReadsWithoutTheView but no longer needs to be: remove it", name)
		}
	}
}

func stripComments(sql string) string {
	var kept []string
	for _, line := range strings.Split(sql, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\n")
}
