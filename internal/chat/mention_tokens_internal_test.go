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
