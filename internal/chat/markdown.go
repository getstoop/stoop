package chat

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Messages are stored as the Markdown subset the web client renders. The
// server never renders it; the one thing it needs is a plain-text form for
// previews, and that comes from the same parse the client does, ported
// from web/src/api/markdown.ts so a preview never says something the
// message does not. The two test files carry the same cases.

type inlineKind int

const (
	inlineText inlineKind = iota
	inlineCode
	inlineLink
	inlineStyled
)

type inlineNode struct {
	kind     inlineKind
	text     string // the text, the code, or the href
	children []inlineNode
}

type blockKind int

const (
	blockLines blockKind = iota
	blockQuote
	blockList
	blockCode
)

type block struct {
	kind  blockKind
	lines [][]inlineNode // lines and quote
	items [][]inlineNode // list rows, bullets dropped
	text  string         // a fence's body
}

var (
	fenceOpen    = regexp.MustCompile("^\\s*```(\\w*)\\s*$")
	fenceClose   = regexp.MustCompile("^\\s*```\\s*$")
	fenceOneLine = regexp.MustCompile("^\\s*```(.+?)```\\s*$")
	quoteLine    = regexp.MustCompile(`^>\s?(.*)$`)
	// "- item", "* item", "1. item", "1) item", with up to six leading
	// spaces for nesting. A bullet must be followed by a space, so *italic*
	// at the start of a line is still italic.
	listLine     = regexp.MustCompile(`^( {0,6})([-*]|\d{1,9}[.)])\s+(.*)$`)
	urlAt        = regexp.MustCompile(`(?i)^https?://[^\s<]+`)
	trailingPunc = regexp.MustCompile(`[.,;:!?)\]'"]+$`)
	mdWhitespace = regexp.MustCompile(`\s*\n\s*`)
)

const escapable = "\\`*_~>|#[]()-"

// Delimiters longest first so "**" wins over "*".
var delims = []string{"**", "__", "~~", "||", "*"}

func parseMarkdown(content string) []block {
	lines := strings.Split(content, "\n")
	var blocks []block
	last := func(kind blockKind) *block {
		if n := len(blocks); n > 0 && blocks[n-1].kind == kind {
			return &blocks[n-1]
		}
		blocks = append(blocks, block{kind: kind})
		return &blocks[len(blocks)-1]
	}
	for i := 0; i < len(lines); {
		line := lines[i]
		if m := fenceOneLine.FindStringSubmatch(line); m != nil {
			blocks = append(blocks, block{kind: blockCode, text: m[1]})
			i++
			continue
		}
		if fenceOpen.MatchString(line) {
			j := i + 1
			for j < len(lines) && !fenceClose.MatchString(lines[j]) {
				j++
			}
			blocks = append(blocks, block{kind: blockCode, text: strings.Join(lines[i+1:j], "\n")})
			i = j + 1
			continue
		}
		if m := listLine.FindStringSubmatch(line); m != nil {
			b := last(blockList)
			b.items = append(b.items, parseInline(m[3]))
			i++
			continue
		}
		if m := quoteLine.FindStringSubmatch(line); m != nil {
			b := last(blockQuote)
			b.lines = append(b.lines, parseInline(m[1]))
		} else {
			b := last(blockLines)
			b.lines = append(b.lines, parseInline(line))
		}
		i++
	}
	return blocks
}

// parseInline is the client's parseStyledInline with the markers dropped
// as it goes: escapes resolved, code and links kept whole, styles nested.
func parseInline(s string) []inlineNode {
	var out []inlineNode
	var text strings.Builder
	flush := func() {
		if text.Len() > 0 {
			out = append(out, inlineNode{kind: inlineText, text: text.String()})
			text.Reset()
		}
	}
	for i := 0; i < len(s); {
		ch := s[i]
		if ch == '\\' && i+1 < len(s) && strings.IndexByte(escapable, s[i+1]) >= 0 {
			text.WriteByte(s[i+1])
			i += 2
			continue
		}
		if ch == '`' {
			if j := strings.IndexByte(s[i+1:], '`'); j > 0 {
				flush()
				out = append(out, inlineNode{kind: inlineCode, text: s[i+1 : i+1+j]})
				i += j + 2
				continue
			}
		}
		if ch == 'h' || ch == 'H' {
			if m := urlAt.FindString(s[i:]); m != "" {
				href := trimURL(m)
				flush()
				out = append(out, inlineNode{kind: inlineLink, text: href})
				i += len(href)
				continue
			}
		}
		// ***both*** is bold around italic.
		if strings.HasPrefix(s[i:], "***") {
			if j := findCloser(s, "***", i+3); j != -1 {
				flush()
				out = append(out, inlineNode{kind: inlineStyled, children: []inlineNode{
					{kind: inlineStyled, children: parseInline(s[i+3 : j])},
				}})
				i = j + 3
				continue
			}
		}
		if inner, end, ok := matchDelimited(s, i); ok {
			flush()
			out = append(out, inlineNode{kind: inlineStyled, children: parseInline(inner)})
			i = end
			continue
		}
		text.WriteByte(ch)
		i++
	}
	flush()
	return out
}

func matchDelimited(s string, i int) (inner string, end int, ok bool) {
	for _, d := range delims {
		if !strings.HasPrefix(s[i:], d) {
			continue
		}
		start := i + len(d)
		// The opener must be followed by something other than whitespace
		// (or, for "*", another "*": that's an unclosed "**").
		if start >= len(s) || spaceAt(s, start) {
			continue
		}
		if d == "*" && s[start] == '*' {
			continue
		}
		j := findCloser(s, d, start+1)
		if j == -1 {
			continue
		}
		return s[start:j], j + len(d), true
	}
	return "", 0, false
}

// findCloser is the first occurrence of d at or after from that follows a
// non-space. A lone "*" never closes on half of a "**" pair.
func findCloser(s, d string, from int) int {
	if from > len(s) {
		return -1
	}
	j := strings.Index(s[from:], d)
	for j != -1 {
		j += from
		halfPair := d == "*" && (s[j-1] == '*' || (j+1 < len(s) && s[j+1] == '*'))
		if !spaceBefore(s, j) && !halfPair {
			return j
		}
		from = j + 1
		if from > len(s) {
			return -1
		}
		j = strings.Index(s[from:], d)
	}
	return -1
}

func spaceAt(s string, i int) bool {
	r, _ := utf8.DecodeRuneInString(s[i:])
	return unicode.IsSpace(r)
}

func spaceBefore(s string, i int) bool {
	r, _ := utf8.DecodeLastRuneInString(s[:i])
	return unicode.IsSpace(r)
}

// Trailing punctuation belongs to the sentence, not the link, except a
// ")" that closes a "(" inside the URL.
func trimURL(raw string) string {
	href := trailingPunc.ReplaceAllString(raw, "")
	rest := raw[len(href):]
	for strings.HasPrefix(rest, ")") && strings.Count(href, "(") > strings.Count(href, ")") {
		href += ")"
		rest = rest[1:]
	}
	return href
}

// plainText is the message with its markup removed, for one-line previews:
// activity lines, reply quotes, webhook payloads. The same projection as
// plainText in the web client.
func plainText(content string) string {
	var parts []string
	for _, b := range parseMarkdown(content) {
		switch b.kind {
		case blockCode:
			parts = append(parts, b.text)
		case blockList:
			// A list reads as its items; the bullets themselves are markup.
			for _, it := range b.items {
				parts = append(parts, inlineString(it))
			}
		default:
			for _, l := range b.lines {
				parts = append(parts, inlineString(l))
			}
		}
	}
	return strings.TrimSpace(mdWhitespace.ReplaceAllString(strings.Join(parts, "\n"), " "))
}

func inlineString(nodes []inlineNode) string {
	var sb strings.Builder
	for _, n := range nodes {
		if n.kind == inlineStyled {
			sb.WriteString(inlineString(n.children))
		} else {
			sb.WriteString(n.text)
		}
	}
	return sb.String()
}
