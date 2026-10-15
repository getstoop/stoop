package chat

import (
	"reflect"
	"testing"
)

// The client's tests use the same token.
const (
	sharedToken     = "<@u:00000000-0000-4000-8000-000000000001:casey>"
	underlineHandle = "<@u:00000000-0000-4000-8000-000000000001:a__b__c>"
)

// The same cases as web/src/api/markdown/markdown.test.ts, "plainText
// mirrors the server" and "plainText": the two implementations are held to
// one answer.
func TestPlainTextMirrorsTheClient(t *testing.T) {
	cases := []struct{ in, want string }{
		{"**bold** and *italic*", "bold and italic"},
		{"__under__ ~~gone~~ `code`", "under gone code"},
		{"***both***", "both"},
		{"**hello *world***", "hello world"},
		{"**a *******", "a *****"},
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
		{`1\. not a list`, "1. not a list"},
		{"  a\n\n  b  ", "a b"},
		{"> quoted\n- item\n```\ncode\n```", "quoted item code"},
		{"see https://example.com now", "see https://example.com now"},
		{"see [the docs](https://example.com/a) now", "see the docs now"},
		{"[**bold** words](https://a.b/x_(y))", "bold words"},
		{"[a](not an address)", "[a](not an address)"},
		{"[https://a.example](https://b.example)", "[https://a.example](https://b.example)"},
		{`\[a](https://a.b)`, "[a](https://a.b)"},
		{"hi " + sharedToken, "hi @casey"},
		{underlineHandle + " hi", "@a__b__c hi"},
		{"`" + sharedToken + "`", "@casey"},
		{"```\n" + sharedToken + "\n```", "@casey"},
		{"||" + sharedToken + "||", "@casey"},
		{"[see " + sharedToken + "](https://x.example)", "see @casey"},
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
	mention := func(token string, at int) inlineNode { return inlineNode{kind: inlineMention, text: token, at: at} }
	cases := []struct {
		in   string
		want []inlineNode
	}{
		{"", nil},
		{"plain", []inlineNode{text("plain")}},
		{"a **b** c", []inlineNode{text("a "), styled(text("b")), text(" c")}},
		{"***both***", []inlineNode{styled(styled(text("both")))}},
		{"*a **b** c*", []inlineNode{styled(text("a "), styled(text("b")), text(" c"))}},
		{"**hello *world***", []inlineNode{styled(text("hello "), styled(text("world")))}},
		{"***world* hello**", []inlineNode{styled(styled(text("world")), text(" hello"))}},
		{"**a***", []inlineNode{styled(text("a")), text("*")}},
		{"**open", []inlineNode{text("**open")}},
		{"** no**", []inlineNode{text("** no**")}},
		{"**no **", []inlineNode{text("**no **")}},
		{"``", []inlineNode{text("``")}},
		{"`x *y*`", []inlineNode{{kind: inlineCode, text: "x *y*"}}},
		{`\*lit\*`, []inlineNode{text("*lit*")}},
		{"see https://a.b/c.", []inlineNode{text("see "), {kind: inlineLink, text: "https://a.b/c"}, text(".")}},
		{"https://a.b/x_(y)", []inlineNode{{kind: inlineLink, text: "https://a.b/x_(y)"}}},
		{"https://a.b/**x**", []inlineNode{{kind: inlineLink, text: "https://a.b/**x**"}}},
		{"<https://example.com>", []inlineNode{text("<"), {kind: inlineLink, text: "https://example.com"}, text(">")}},
		{"<https://example.com/a>.", []inlineNode{text("<"), {kind: inlineLink, text: "https://example.com/a"}, text(">.")}},
		{"([a **b**](https://a.b/x_(y)))", []inlineNode{
			text("("),
			{kind: inlineLink, text: "https://a.b/x_(y)", children: []inlineNode{text("a "), styled(text("b"))}},
			text(")"),
		}},
		// [words](<address>) gets no preview, and its words may be the address.
		{"[a](<https://a.b/x_(y)>)", []inlineNode{
			{kind: inlineLink, text: "https://a.b/x_(y)", children: []inlineNode{text("a")}, noPreview: true},
		}},
		{"[https://a.b/x__y](<https://a.b/x__y>).", []inlineNode{
			{kind: inlineLink, text: "https://a.b/x__y", children: []inlineNode{text("https://a.b/x__y")}, noPreview: true}, text("."),
		}},
		{"[https://a.b](<https://c.d>)", []inlineNode{
			text("["), {kind: inlineLink, text: "https://a.b]("}, text("<"), {kind: inlineLink, text: "https://c.d"}, text(">)"),
		}},
		{"[a](<https://a.b)", []inlineNode{text("[a](<"), {kind: inlineLink, text: "https://a.b"}, text(")")}},
		{"[a](ftp://a.b)", []inlineNode{text("[a](ftp://a.b)")}},
		{"[ ](https://a.b)", []inlineNode{text("[ ]("), {kind: inlineLink, text: "https://a.b"}, text(")")}},
		{"[a](https://a.b", []inlineNode{text("[a]("), {kind: inlineLink, text: "https://a.b"}}},
		{"[a", []inlineNode{text("[a")}},
		{"[a]", []inlineNode{text("[a]")}},
		{"hi " + sharedToken, []inlineNode{text("hi "), mention(sharedToken, 3)}},
		{underlineHandle + " hi", []inlineNode{mention(underlineHandle, 0), text(" hi")}},
		{"**" + sharedToken + "**", []inlineNode{styled(mention(sharedToken, 2))}},
		{"`" + sharedToken + "`", []inlineNode{{kind: inlineCode, text: "@casey"}}},
		{"||" + sharedToken + "||", []inlineNode{styled(text("@casey"))}},
		{"[see " + sharedToken + "](https://x.example)", []inlineNode{
			{kind: inlineLink, text: "https://x.example", children: []inlineNode{text("see @casey")}},
		}},
		// A backtick pair never spans a style's edge.
		{"*x `" + sharedToken + "* y`", []inlineNode{styled(text("x `"), mention(sharedToken, 4)), text(" y`")}},
		{"**a `b** c` d " + sharedToken + " `e`", []inlineNode{
			styled(text("a `b")), text(" c"), {kind: inlineCode, text: " d @casey "}, text("e`"),
		}},
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
		{"```c++\nint x;\n```\nafter", []blockKind{blockCode, blockLines}},
		{"```objective-c\nx\n```\nafter", []blockKind{blockCode, blockLines}},
		{"```f#\nx\n```\nafter", []blockKind{blockCode, blockLines}},
		{"> - item", []blockKind{blockQuote}},
		{`1\. x`, []blockKind{blockLines}},
		// Stored before line endings were normalised; the client agrees.
		{"- a\r\n- b", []blockKind{blockList}},
		{"> a\r\n> b", []blockKind{blockQuote}},
		{"```a\rb```", []blockKind{blockCode}},
	}
	for _, c := range cases {
		if got := kinds(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("parseMarkdown(%q) kinds = %v, want %v", c.in, got, c.want)
		}
	}
}
