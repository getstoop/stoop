package chat

import (
	"reflect"
	"testing"
)

func TestParseMentionHandles(t *testing.T) {
	tests := map[string][]string{
		"hi @bea":                             {"bea"},
		"@Bea @bea @BEA":                      {"bea"},
		"email me@example.com and @cal":       {"cal"},
		"@ab too short, @abc ok, @a_b_c fine": {"abc", "a_b_c"},
		"no mentions here":                    nil,
		"(@owner) and @owner's thing":         {"owner"},
		"@@double and @-dash":                 nil,
		"punctuation: @bea, @cal. @dan!":      {"bea", "cal", "dan"},
	}
	for in, want := range tests {
		if got := parseMentionHandles(in); !reflect.DeepEqual(got, want) {
			t.Errorf("%q: got %v, want %v", in, got, want)
		}
	}
}

func TestParseGroupHandles(t *testing.T) {
	tests := map[string][]string{
		"hi @@gardeners":                  {"gardeners"},
		"@@Gardeners and @@gardeners":     {"gardeners"},
		"@bea is a person, not a group":   nil,
		"(@@crew), @@crew's turn":         {"crew"},
		"@@@triple and me@@example.com":   nil,
		"@@ab too short, @@sale_crew too": {"sale_crew"},
	}
	for in, want := range tests {
		if got := parseGroupHandles(in); !reflect.DeepEqual(got, want) {
			t.Errorf("%q: got %v, want %v", in, got, want)
		}
	}
}
