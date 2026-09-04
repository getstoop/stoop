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
		{"`https://code.example` and ```\nhttps://block.example\n``` but https://ok.example", []string{"https://ok.example"}},
		{"https://dup.example https://dup.example", []string{"https://dup.example"}},
		{"ftp://nope.example no links here", nil},
		{"https://a.example https://b.example https://c.example https://d.example", []string{"https://a.example", "https://b.example", "https://c.example"}},
	} {
		if got := extractLinks(tc.in); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("extractLinks(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
