package chat

import "testing"

// @channel and @here count as words of the message's text, where the
// client marks them: not in code or an address.
func TestReadMentionsEveryone(t *testing.T) {
	tests := map[string]bool{
		"@channel heads up":                true,
		"(@Here) anyone?":                  true,
		"email me@channel.org":             false,
		"@channels is a person":            false,
		"@@here is not a mention":          false,
		"<@u:" + caseyID + ":casey>":       false,
		"`@here`":                          false,
		"```\n@channel\n```":               false,
		"https://x.example/@here":          false,
		"see https://x.example/@here now":  false,
		"**@here**":                        true,
		"__x__@here":                       true,
		"||@here||":                        true,
		"[ping @here](https://x.example)":  true,
		"> - @channel":                     true,
		"`code` and @here":                 true,
		"<@u:" + caseyID + ":casey>@here":  true,
		"<@u:" + caseyID + ":casey> @here": true,
		"\\`@here\\`":                      true,
	}
	for in, want := range tests {
		shown := readMentions(in)
		if got := shown.entireChannel || shown.here; got != want {
			t.Errorf("%q: got %v, want %v", in, got, want)
		}
		if got := mayNameEveryone(in); want && !got {
			t.Errorf("%q: mayNameEveryone missed it", in)
		}
	}
}
