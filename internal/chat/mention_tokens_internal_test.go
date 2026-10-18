package chat

import (
	"regexp"
	"strings"
	"testing"
)

const (
	caseyID     = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a8b"
	gardenersID = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a8c"
	gardenID    = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a8d"
)

// tokenRE is the token grammar written as a pattern, for tokenLength to
// agree with.
var tokenRE = regexp.MustCompile(`<@[ug]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z0-9_]{3,32}>|<#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z0-9_-]{1,32}>`)

func TestMentionTokensReadAsText(t *testing.T) {
	stored := "<@u:" + caseyID + ":casey> and <@g:" + gardenersID + ":gardeners>"
	renamed := mentionNames{
		people: map[string]string{caseyID: "casey_k"},
		groups: map[string]string{gardenersID: "growers"},
	}
	if got, want := plainText(renamed.current(stored)), "@casey_k and @growers"; got != want {
		t.Errorf("renamed: got %q, want %q", got, want)
	}
	// Someone or something not found reads as its saved handle.
	if got, want := plainText((mentionNames{}).current(stored)), "@casey and @gardeners"; got != want {
		t.Errorf("not found: got %q, want %q", got, want)
	}
	// A handle's "__" is part of it, not underline.
	underlined := mentionNames{people: map[string]string{caseyID: "a__b__c"}}
	if got, want := plainText(underlined.current(stored)), "@a__b__c and @gardeners"; got != want {
		t.Errorf("underscores: got %q, want %q", got, want)
	}
	// Not a token: the ID has the wrong shape.
	if in := "<@u:------------------------------------:casey>"; (mentionNames{}).current(in) != in {
		t.Errorf("%q should stay as written", in)
	}
}

func TestChannelTokensReadAsText(t *testing.T) {
	stored := "see <#" + gardenID + ":garden> and <@u:" + caseyID + ":casey>"
	renamed := mentionNames{channels: map[string]string{gardenID: "the-garden"}}
	if got, want := plainText(renamed.current(stored)), "see #the-garden and @casey"; got != want {
		t.Errorf("renamed: got %q, want %q", got, want)
	}
	if got, want := plainText((mentionNames{}).current(stored)), "see #garden and @casey"; got != want {
		t.Errorf("not found: got %q, want %q", got, want)
	}
	if got := writtenLength(stored); got != len("see #garden and @casey") {
		t.Errorf("written length = %d", got)
	}
}

// A channel token is kept only where it was given a current name, and is
// text where the message shows text.
func TestStoredFormChannelTokens(t *testing.T) {
	garden := "<#" + gardenID + ":garden>"
	current := map[string]string{channelToken + gardenID: "the-garden"}
	tests := map[string]string{
		"go to " + garden:                     "go to <#" + gardenID + ":the-garden>",
		"`" + garden + "`":                    "`#garden`",
		"||" + garden + "||":                  "||#garden||",
		"[" + garden + "](https://x.example)": "[#garden](https://x.example)",
	}
	for in, want := range tests {
		if got := storedForm(in, readMentions(in).tokens, current); got != want {
			t.Errorf("%q:\n got %q\nwant %q", in, got, want)
		}
	}
	// A channel not found (private, elsewhere, gone) is its name, as text.
	if got, want := storedForm(garden, readMentions(garden).tokens, nil), "#garden"; got != want {
		t.Errorf("not found: got %q, want %q", got, want)
	}
}

func TestWrittenLengthCountsTokensAsHandles(t *testing.T) {
	if got := writtenLength("hi <@u:" + caseyID + ":casey>"); got != len("hi @casey") {
		t.Errorf("written length = %d, want %d", got, len("hi @casey"))
	}
}

// Only a token the message shows as a mention is kept as a token: one in
// code, a spoiler or a link's words is saved as text, as the client
// shows it. Every token here names someone who can be told.
func TestStoredFormKeepsLiveTokens(t *testing.T) {
	casey := "<@u:" + caseyID + ":casey>"
	everyone := map[string]string{personToken + caseyID: "casey"}
	tests := map[string]string{
		"`" + casey + "` and " + casey:                       "`@casey` and " + casey,
		"```\n" + casey + "\n```\nafter " + casey:            "```\n@casey\n```\nafter " + casey,
		"```" + casey + "```":                                "```@casey```",
		"```\nunclosed " + casey:                             "```\nunclosed @casey",
		"\\`not code " + casey + "\\`":                       "\\`not code " + casey + "\\`",
		"https://x.example/`a` " + casey:                     "https://x.example/`a` " + casey,
		"one ` tick " + casey:                                "one ` tick " + casey,
		"> quoted `" + casey + "`\n- listed `" + casey + "`": "> quoted `@casey`\n- listed `@casey`",
		"> quoted " + casey + "\n  - listed " + casey:        "> quoted " + casey + "\n  - listed " + casey,
		// A backtick pair never spans a style's edge or a link's.
		"*x `" + casey + "* y`":                     "*x `" + casey + "* y`",
		"**a `b** c` d " + casey + " `e`":           "**a `b** c` d @casey `e`",
		"[`a](https://x.example) " + casey + " `b`": "[`a](https://x.example) " + casey + " `b`",
		// A spoiler's or a link's words are text.
		"||" + casey + "||":                          "||@casey||",
		"**||hi " + casey + "||** " + casey:          "**||hi @casey||** " + casey,
		"[see " + casey + "](https://x.example)":     "[see @casey](https://x.example)",
		"[see](https://x.example/" + casey + ")":     "[see](https://x.example/" + casey + ")",
		"**bold " + casey + "** and *" + casey + "*": "**bold " + casey + "** and *" + casey + "*",
	}
	for in, want := range tests {
		if got := storedForm(in, readMentions(in).tokens, everyone); got != want {
			t.Errorf("%q:\n got %q\nwant %q", in, got, want)
		}
	}
}

// A kept token carries the current handle; one for someone not found is
// text.
func TestStoredFormRewritesHandles(t *testing.T) {
	in := "<@u:" + caseyID + ":old> and <@g:" + gardenersID + ":gardeners>"
	current := map[string]string{personToken + caseyID: "casey_k"}
	if got, want := storedForm(in, readMentions(in).tokens, current), "<@u:"+caseyID+":casey_k> and @gardeners"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// Each token knows where it sits, whatever block holds it.
func TestLiveMentionsOffsets(t *testing.T) {
	casey := "<@u:" + caseyID + ":casey>"
	in := "a " + casey + "\n> " + casey + "\n  - **" + casey + "**\n***" + casey + "***"
	var at []int
	for _, token := range readMentions(in).tokens {
		if in[token.at:token.at+len(casey)] != casey {
			t.Errorf("token at %d reads %q", token.at, in[token.at:])
		}
		at = append(at, token.at)
	}
	if len(at) != 4 {
		t.Errorf("found tokens at %v, want 4", at)
	}
}

// tokenLength is tokenRE's match at the start, by hand.
func TestTokenLengthMatchesTheRegexp(t *testing.T) {
	anchored := regexp.MustCompile("^(?:" + tokenRE.String() + ")")
	tests := []string{
		"<@u:" + caseyID + ":casey>",
		"<@g:" + gardenersID + ":gardeners> after",
		"<@u:" + caseyID + ":" + strings.Repeat("a", 32) + ">",
		"<@u:" + caseyID + ":" + strings.Repeat("a", 33) + ">",
		"<@u:" + caseyID + ":ab>",
		"<@u:" + caseyID + ":a__b__c>",
		"<@u:" + caseyID + ":casey",
		"<@u:" + caseyID + ":Casey>",
		"<@x:" + caseyID + ":casey>",
		"<@u:" + strings.ToUpper(caseyID) + ":casey>",
		"<@u:" + strings.ReplaceAll(caseyID, "-", "0") + ":casey>",
		"<@u:" + caseyID[:35] + ":casey>",
		"<@u:------------------------------------:casey>",
		"<@u:",
		"<@",
		"",
		"<#" + gardenID + ":garden>",
		"<#" + gardenID + ":off-topic_2> after",
		"<#" + gardenID + ":a>",
		"<#" + gardenID + ":>",
		"<#" + gardenID + ":" + strings.Repeat("a", 32) + ">",
		"<#" + gardenID + ":" + strings.Repeat("a", 33) + ">",
		"<#" + gardenID + ":Garden>",
		"<#" + gardenID + ":off topic>",
		"<#c:" + gardenID + ":garden>",
		"<@c:" + gardenID + ":garden>",
		"<@u:" + caseyID + ":off-topic>",
		"<#" + gardenID[:35] + ":garden>",
		"<#",
	}
	for _, in := range tests {
		if got, want := tokenLength(in), len(anchored.FindString(in)); got != want {
			t.Errorf("tokenLength(%q) = %d, want %d", in, got, want)
		}
	}
}
