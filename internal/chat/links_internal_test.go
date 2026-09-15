package chat

import (
	"reflect"
	"testing"
)

func TestExtractLinks(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want []string
	}{
		{"see https://example.com/a?b=1.", []string{"https://example.com/a?b=1"}},
		{"(https://example.com/x) and http://foo.test/", []string{"https://example.com/x", "http://foo.test/"}},
		// Code is skipped: a span, and a fence on lines of its own, which
		// is the only fence the client recognises.
		{"`https://code.example` and\n```\nhttps://block.example\n```\nbut https://ok.example", []string{"https://ok.example"}},
		{"https://dup.example https://dup.example", []string{"https://dup.example"}},
		{"ftp://nope.example no links here", nil},
		{"https://example.com/wiki/Ada_(mathematician)", []string{"https://example.com/wiki/Ada_(mathematician)"}},
		{"(see https://example.com/wiki/Ada_(mathematician)).", []string{"https://example.com/wiki/Ada_(mathematician)"}},
		{"https://a.example https://b.example https://c.example https://d.example", []string{"https://a.example", "https://b.example", "https://c.example"}},
	} {
		if got := extractLinks(tc.in); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("extractLinks(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
