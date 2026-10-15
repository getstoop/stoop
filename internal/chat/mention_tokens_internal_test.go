package chat

import "testing"

const (
	caseyID     = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a8b"
	gardenersID = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a8c"
)

func TestMentionTokensReadAsText(t *testing.T) {
	stored := "<@u:" + caseyID + ":casey> and <@g:" + gardenersID + ":gardeners>"
	renamed := mentionNames{
		people: map[string]string{caseyID: "casey_k"},
		groups: map[string]string{gardenersID: "growers"},
	}
	if got, want := renamed.text(stored), "@casey_k and @growers"; got != want {
		t.Errorf("renamed: got %q, want %q", got, want)
	}
	// Someone or something not found reads as its saved handle.
	if got, want := (mentionNames{}).text(stored), "@casey and @gardeners"; got != want {
		t.Errorf("not found: got %q, want %q", got, want)
	}
	// Not a token: the ID has the wrong shape.
	if in := "<@u:------------------------------------:casey>"; (mentionNames{}).text(in) != in {
		t.Errorf("%q should stay as written", in)
	}
}

func TestWrittenLengthCountsTokensAsHandles(t *testing.T) {
	if got := writtenLength("hi <@u:" + caseyID + ":casey>"); got != len("hi @casey") {
		t.Errorf("written length = %d, want %d", got, len("hi @casey"))
	}
}

func TestCodeAsText(t *testing.T) {
	casey := "<@u:" + caseyID + ":casey>"
	tests := map[string]string{
		"`" + casey + "` and " + casey:                       "`@casey` and " + casey,
		"```\n" + casey + "\n```\nafter " + casey:            "```\n@casey\n```\nafter " + casey,
		"```" + casey + "```":                                "```@casey```",
		"```\nunclosed " + casey:                             "```\nunclosed @casey",
		"\\`not code " + casey + "\\`":                       "\\`not code " + casey + "\\`",
		"https://x.example/`a` " + casey:                     "https://x.example/`a` " + casey,
		"one ` tick " + casey:                                "one ` tick " + casey,
		"> quoted `" + casey + "`\n- listed `" + casey + "`": "> quoted `@casey`\n- listed `@casey`",
	}
	for in, want := range tests {
		if got := codeAsText(in); got != want {
			t.Errorf("%q:\n got %q\nwant %q", in, got, want)
		}
	}
}
