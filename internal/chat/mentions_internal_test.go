package chat

import "testing"

func TestNamesEveryone(t *testing.T) {
	tests := map[string]bool{
		"@channel heads up":          true,
		"(@Here) anyone?":            true,
		"email me@channel.org":       false,
		"@channels is a person":      false,
		"@@here is not a mention":    false,
		"<@u:" + caseyID + ":casey>": false,
	}
	for in, want := range tests {
		if got := namesEveryone(in); got != want {
			t.Errorf("%q: got %v, want %v", in, got, want)
		}
	}
}
