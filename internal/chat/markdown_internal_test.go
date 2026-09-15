package chat

import (
	"reflect"
	"testing"
)

// The same cases as web/src/api/markdown.test.ts, "plainText mirrors the
// server" and "plainText": the two implementations are held to one answer.
func TestPlainTextMirrorsTheClient(t *testing.T) {
	cases := []struct{ in, want string }{
		{"**bold** and *italic*", "bold and italic"},
		{"__under__ ~~gone~~ `code`", "under gone code"},
		{"***both***", "both"},
		{"> quoted\n> lines", "quoted lines"},
		{"```go\nfmt.Println()\n```", "fmt.Println()"},
		{"```one liner```", "one liner"},
		{"2 * 3 * 4", "2 * 3 * 4"},
		{"@ada_w said hi", "@ada_w said hi"},
		{`\*not bold\*`, "*not bold*"},
		{"first\nsecond", "first second"},
		{"plain", "plain"},
		{"", ""},
		{"- milk\n- eggs", "milk eggs"},
		{"* milk\n* eggs", "milk eggs"},
		{"1. first\n2. second", "first second"},
		{"1) first\n2) second", "first second"},
		{"  - nested", "nested"},
		{"||the butler did it||", "the butler did it"},
		{"it was ||him|| all along", "it was him all along"},
		{"- a ||secret|| item", "a secret item"},
		{"**bold** and ||hidden||", "bold and hidden"},
		{"*italic* line", "italic line"},
		{"a || b", "a || b"},
		{`\- not a list`, "- not a list"},
		{"  a\n\n  b  ", "a b"},
		{"> quoted\n- item\n```\ncode\n```", "quoted item code"},
		{"see https://example.com now", "see https://example.com now"},
	}
	for _, c := range cases {
		if got := plainText(c.in); got != c.want {
			t.Errorf("plainText(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// The five answers the regex version got wrong (STOOP-231). The client
// renders the message, so its answer is the one a preview must give.
func TestPlainTextAgreesWhereTheServerDiffered(t *testing.T) {
	cases := []struct{ in, want string }{
		{"`a *b* c`", "a *b* c"},
		{"```\n- a\n```", "- a"},
		{"https://example.com/**not**", "https://example.com/**not**"},
		{"a *b\nc* d", "a *b c* d"},
		{"> - item", "- item"},
	}
	for _, c := range cases {
		if got := plainText(c.in); got != c.want {
			t.Errorf("plainText(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestParseInlineShape(t *testing.T) {
	text := func(s string) inlineNode { return inlineNode{kind: inlineText, text: s} }
	styled := func(children ...inlineNode) inlineNode { return inlineNode{kind: inlineStyled, children: children} }
	cases := []struct {
		in   string
		want []inlineNode
	}{
		{"", nil},
		{"plain", []inlineNode{text("plain")}},
		{"a **b** c", []inlineNode{text("a "), styled(text("b")), text(" c")}},
		{"***both***", []inlineNode{styled(styled(text("both")))}},
		{"*a **b** c*", []inlineNode{styled(text("a "), styled(text("b")), text(" c"))}},
		{"**open", []inlineNode{text("**open")}},
		{"** no**", []inlineNode{text("** no**")}},
		{"**no **", []inlineNode{text("**no **")}},
		{"``", []inlineNode{text("``")}},
		{"`x *y*`", []inlineNode{{kind: inlineCode, text: "x *y*"}}},
		{`\*lit\*`, []inlineNode{text("*lit*")}},
		{"see https://a.b/c.", []inlineNode{text("see "), {kind: inlineLink, text: "https://a.b/c"}, text(".")}},
		{"https://a.b/x_(y)", []inlineNode{{kind: inlineLink, text: "https://a.b/x_(y)"}}},
		{"https://a.b/**x**", []inlineNode{{kind: inlineLink, text: "https://a.b/**x**"}}},
	}
	for _, c := range cases {
		if got := parseInline(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("parseInline(%q) = %+v, want %+v", c.in, got, c.want)
		}
	}
}

func TestParseMarkdownBlocks(t *testing.T) {
	kinds := func(s string) []blockKind {
		var out []blockKind
		for _, b := range parseMarkdown(s) {
			out = append(out, b.kind)
		}
		return out
	}
	cases := []struct {
		in   string
		want []blockKind
	}{
		{"a\nb", []blockKind{blockLines}},
		{"> a\n> b", []blockKind{blockQuote}},
		{"> a\nb", []blockKind{blockQuote, blockLines}},
		{"- a\n1. b", []blockKind{blockList}},
		{"       - seven spaces", []blockKind{blockLines}},
		{"*italic* line", []blockKind{blockLines}},
		{"```\nx\n```\nafter", []blockKind{blockCode, blockLines}},
		{"```\nnever closed", []blockKind{blockCode}},
		{"> - item", []blockKind{blockQuote}},
	}
	for _, c := range cases {
		if got := kinds(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("parseMarkdown(%q) kinds = %v, want %v", c.in, got, c.want)
		}
	}
}
