package chat

import (
	"reflect"
	"testing"
)

// Tokens for the parse's shape below; the client's tests use the same.
const (
	sharedToken     = "<@u:00000000-0000-4000-8000-000000000001:casey>"
	underlineHandle = "<@u:00000000-0000-4000-8000-000000000001:a__b__c>"
)

// plainText, block kinds and links are held to the client's answers in
// shared_cases_internal_test.go. The parse's shape is this port's own.
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
