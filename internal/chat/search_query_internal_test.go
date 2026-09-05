package chat

import (
	"testing"
	"time"
)

func TestParseSearchQuery(t *testing.T) {
	day := func(s string) *time.Time {
		d, _ := time.Parse("2006-01-02", s)
		return &d
	}
	cases := map[string]struct {
		in   string
		want searchQuery
		err  bool
	}{
		"one word prefixes":       {in: "restart", want: searchQuery{words: "", prefix: "'restart':*", hasText: true}},
		"short last word stays":   {in: "livekit at", want: searchQuery{words: "livekit at", hasText: true}},
		"only last word prefixes": {in: "container restart", want: searchQuery{words: "container", prefix: "'restart':*", hasText: true}},
		"phrase kept whole":       {in: `"livekit container"`, want: searchQuery{words: `"livekit container"`, hasText: true}},
		"negation not prefixed":   {in: "livekit -docker", want: searchQuery{words: "livekit -docker", hasText: true}},
		"or not prefixed":         {in: "turn or", want: searchQuery{words: "turn or", hasText: true}},
		"hand-typed prefix kept":  {in: "rest:*", want: searchQuery{words: "rest:*", hasText: true}},
		"quote escaped":           {in: "it's", want: searchQuery{words: "", prefix: "'it''s':*", hasText: true}},
		"filters stripped": {
			in:   `from:@Casey in:#garden before:2026-09-04 after:2026-08-01 tomato`,
			want: searchQuery{from: "casey", in: "garden", before: day("2026-09-04"), after: day("2026-08-02"), prefix: "'tomato':*", hasText: true},
		},
		"quoted filter value":  {in: `in:"front steps" gate`, want: searchQuery{in: "front steps", prefix: "'gate':*", hasText: true}},
		"unknown key is words": {in: "http://x.test/a", want: searchQuery{words: "http://x.test/a", hasText: true}},
		"filters only":         {in: "from:casey", err: true},
		"empty":                {in: "   ", err: true},
		"bad date":             {in: "before:yesterday x", err: true},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := parseSearchQuery(tc.in)
			if tc.err {
				if err == nil {
					t.Fatalf("want error, got %+v", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.words != tc.want.words || got.prefix != tc.want.prefix || got.from != tc.want.from || got.in != tc.want.in || got.hasText != tc.want.hasText {
				t.Errorf("got %+v, want %+v", got, tc.want)
			}
			if !sameTime(got.before, tc.want.before) || !sameTime(got.after, tc.want.after) {
				t.Errorf("dates: got %v/%v, want %v/%v", got.before, got.after, tc.want.before, tc.want.after)
			}
		})
	}
}

func TestParseSearchQueryLength(t *testing.T) {
	long := make([]byte, maxSearchQueryLen+1)
	for i := range long {
		long[i] = 'a'
	}
	if _, err := parseSearchQuery(string(long)); err == nil {
		t.Error("over-long query accepted")
	}
}

func sameTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}
