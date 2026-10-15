package chat

import "testing"

const (
	caseyID     = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a8b"
	adaID       = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a8d"
	gardenersID = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a8c"
)

func tokenTargets() mentionTargets {
	return mentionTargets{
		people: map[string]string{"casey": caseyID, "gardeners": adaID},
		groups: map[string]string{"gardeners": gardenersID},
	}
}

func TestEncodeMentions(t *testing.T) {
	tests := map[string]string{
		"hi @casey":                  "hi <@u:" + caseyID + ":casey>",
		"(@Casey) and @casey's":      "(<@u:" + caseyID + ":casey>) and <@u:" + caseyID + ":casey>'s",
		"@nobody stays":              "@nobody stays",
		"@@gardeners and @gardeners": "<@g:" + gardenersID + ":gardeners> and <@u:" + adaID + ":gardeners>",
		"@@casey is no group":        "@@casey is no group",
		"me@casey.org":               "me@casey.org",
		"`@casey` in code":           "`<@u:" + caseyID + ":casey>` in code",
		"@channel and @here":         "@channel and @here",
		"no mentions":                "no mentions",
	}
	for in, want := range tests {
		if got := encodeMentions(in, tokenTargets()); got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
}

func TestMentionTokensReadBack(t *testing.T) {
	names := mentionNames{
		people: map[string]string{caseyID: "casey", adaID: "gardeners"},
		groups: map[string]string{gardenersID: "gardeners"},
	}
	for _, in := range []string{
		"hi @casey, and (@casey)'s",
		"@@gardeners and @gardeners",
		"`@casey` in code",
		"@nobody, @channel and @here",
	} {
		if got := names.text(encodeMentions(in, tokenTargets())); got != in {
			t.Errorf("%q read back as %q", in, got)
		}
	}
}

func TestMentionTokensReadCurrentNames(t *testing.T) {
	stored := "<@u:" + caseyID + ":casey> and <@g:" + gardenersID + ":gardeners>"
	renamed := mentionNames{
		people: map[string]string{caseyID: "casey_k"},
		groups: map[string]string{gardenersID: "growers"},
	}
	if got, want := renamed.text(stored), "@casey_k and @@growers"; got != want {
		t.Errorf("renamed: got %q, want %q", got, want)
	}
	// Someone or something not found reads as the handle it was written with.
	if got, want := (mentionNames{}).text(stored), "@casey and @@gardeners"; got != want {
		t.Errorf("not found: got %q, want %q", got, want)
	}
	// Not a token: the ID has the wrong shape.
	if in := "<@u:------------------------------------:casey>"; (mentionNames{}).text(in) != in {
		t.Errorf("%q should stay as written", in)
	}
}

func TestTypedTokenIsSavedAsText(t *testing.T) {
	typed := "<@u:" + caseyID + ":someone> and <@g:" + gardenersID + ":crew>@casey"
	if handles := parseMentionHandles(typed); len(handles) != 1 || handles[0] != "casey" {
		t.Errorf("typed tokens parse as handles %v, want only casey", handles)
	}
	want := "@someone and @@crew<@u:" + caseyID + ":casey>"
	if got := encodeMentions(typed, tokenTargets()); got != want {
		t.Errorf("typed tokens encode as %q, want %q", got, want)
	}
}
