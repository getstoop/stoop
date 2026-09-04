package chat

import "testing"

func TestPlainText(t *testing.T) {
	cases := map[string]string{
		"**bold** and *italic*":       "bold and italic",
		"__under__ ~~gone~~ `code`":   "under gone code",
		"***both***":                  "both",
		"> quoted\n> lines":           "quoted lines",
		"```go\nfmt.Println()\n```":   "fmt.Println()",
		"```one liner```":             "one liner",
		"2 * 3 * 4":                   "2 * 3 * 4",
		"@john_doe said hi":           "@john_doe said hi",
		`\*not bold\*`:                "*not bold*",
		"first\nsecond":               "first second",
		"https://example.com/**not**": "https://example.com/not",
		"plain":                       "plain",
		"":                            "",
	}
	for in, want := range cases {
		if got := plainText(in); got != want {
			t.Errorf("plainText(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPlainTextListsAndSpoilers(t *testing.T) {
	cases := []struct{ in, want string }{
		{"- milk\n- eggs", "milk eggs"},
		{"* milk\n* eggs", "milk eggs"},
		{"1. first\n2. second", "first second"},
		{"1) first\n2) second", "first second"},
		{"  - nested", "nested"},
		{"||the butler did it||", "the butler did it"},
		{"it was ||him|| all along", "it was him all along"},
		{"- a ||secret|| item", "a secret item"},
		{"**bold** and ||hidden||", "bold and hidden"},
		// Not a list: no space after the bullet, so italics survive.
		{"*italic* line", "italic line"},
		// A lone pipe pair with nothing in it is just text.
		{"a || b", "a || b"},
		{`\- not a list`, "- not a list"},
	}
	for _, c := range cases {
		if got := plainText(c.in); got != c.want {
			t.Errorf("plainText(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
