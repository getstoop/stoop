package chat

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// The client's Markdown parser (web/src/api/markdown/) ported for
// plain-text previews; the two test files carry the same cases. See
// docs/architecture/messaging.md → The server's one involvement.

type inlineKind int

const (
	inlineText inlineKind = iota
	inlineCode
	inlineLink
	inlineStyled
	inlineMention
)

type inlineNode struct {
	kind     inlineKind
	text     string       // the text, the code, the href, or the token
	children []inlineNode // a style's content, or a link's label
	at       int          // a token's byte offset in the content
	spoiler  bool         // a style that is a ||spoiler||
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
	fenceOpen    = regexp.MustCompile("^\\s*```([^\\s`]*)\\s*$")
	fenceClose   = regexp.MustCompile("^\\s*```\\s*$")
	fenceOneLine = regexp.MustCompile("^\\s*```(.+?)```\\s*$")
	quoteLine    = regexp.MustCompile(`^>\s?(.*)$`)
	// "- item", "* item", "1. item", "1) item", with up to six leading
	// spaces for nesting. A bullet must be followed by a space, so *italic*
	// at the start of a line is still italic.
	listLine     = regexp.MustCompile(`^( {0,6})([-*]|\d{1,9}[.)])\s+(.*)$`)
	urlAt        = regexp.MustCompile(`(?i)^https?://[^\s<]+`)
	urlWhole     = regexp.MustCompile(`(?i)^https?://[^\s<]+$`)
	trailingPunc = regexp.MustCompile(`[.,;:!?)\]'"]+$`)
	mdWhitespace = regexp.MustCompile(`\s*\n\s*`)
)

const escapable = "\\`*_~>|#[]().-"

// Delimiters longest first so "**" wins over "*".
var delims = []string{"**", "__", "~~", "||", "*"}

func parseMarkdown(content string) []block {
	lines := strings.Split(content, "\n")
	starts := make([]int, len(lines))
	for i := 1; i < len(lines); i++ {
		starts[i] = starts[i-1] + len(lines[i-1]) + 1
	}
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
			blocks = append(blocks, block{kind: blockCode, text: tokensAsText(m[1])})
			i++
			continue
		}
		if fenceOpen.MatchString(line) {
			j := i + 1
			for j < len(lines) && !fenceClose.MatchString(lines[j]) {
				j++
			}
			blocks = append(blocks, block{kind: blockCode, text: tokensAsText(strings.Join(lines[i+1:j], "\n"))})
			i = j + 1
			continue
		}
		if item := listLine.FindStringSubmatchIndex(line); item != nil {
			b := last(blockList)
			b.items = append(b.items, parseInlineAt(line[item[6]:item[7]], starts[i]+item[6]))
			i++
			continue
		}
		if quoted := quoteLine.FindStringSubmatchIndex(line); quoted != nil {
			b := last(blockQuote)
			b.lines = append(b.lines, parseInlineAt(line[quoted[2]:quoted[3]], starts[i]+quoted[2]))
		} else {
			b := last(blockLines)
			b.lines = append(b.lines, parseInlineAt(line, starts[i]))
		}
		i++
	}
	return blocks
}

// parseInline is the client's parseInline: tokens, code and links kept
// whole, escapes resolved, styles nested.
func parseInline(s string) []inlineNode {
	return parseInlineAt(s, 0)
}

// parseInlineAt is parseInline for source found at offset base in the content,
// so each token knows where it is.
func parseInlineAt(source string, base int) []inlineNode {
	var out []inlineNode
	var text strings.Builder
	flush := func() {
		if text.Len() > 0 {
			out = append(out, inlineNode{kind: inlineText, text: text.String()})
			text.Reset()
		}
	}
	for i := 0; i < len(source); {
		ch := source[i]
		// A token is whole: its handle may hold "__", which isn't underline.
		if ch == '<' {
			if length := tokenLength(source[i:]); length > 0 {
				flush()
				out = append(out, inlineNode{kind: inlineMention, text: source[i : i+length], at: base + i})
				i += length
				continue
			}
		}
		if ch == '\\' && i+1 < len(source) && strings.IndexByte(escapable, source[i+1]) >= 0 {
			text.WriteByte(source[i+1])
			i += 2
			continue
		}
		if ch == '`' {
			if j := strings.IndexByte(source[i+1:], '`'); j > 0 {
				flush()
				out = append(out, inlineNode{kind: inlineCode, text: tokensAsText(source[i+1 : i+1+j])})
				i += j + 2
				continue
			}
		}
		if ch == 'h' || ch == 'H' {
			if m := urlAt.FindString(source[i:]); m != "" {
				href := trimURL(m)
				flush()
				out = append(out, inlineNode{kind: inlineLink, text: href})
				i += len(href)
				continue
			}
		}
		if ch == '[' {
			if node, end, ok := matchLabelled(source, i); ok {
				flush()
				out = append(out, node)
				i = end
				continue
			}
		}
		// ***both*** is bold around italic.
		if strings.HasPrefix(source[i:], "***") {
			if j := findCloser(source, "***", i+3); j != -1 {
				flush()
				out = append(out, inlineNode{kind: inlineStyled, children: []inlineNode{
					{kind: inlineStyled, children: parseInlineAt(source[i+3:j], base+i+3)},
				}})
				i = j + 3
				continue
			}
		}
		if children, end, ok := matchDelimited(source, i, base); ok {
			flush()
			spoiler := strings.HasPrefix(source[i:], "||")
			out = append(out, inlineNode{kind: inlineStyled, children: children, spoiler: spoiler})
			i = end
			continue
		}
		text.WriteByte(ch)
		i++
	}
	flush()
	return out
}

// matchLabelled is "[words](https://address)" at start. The words can't hold
// a link of their own, so a label never shows one address over another.
func matchLabelled(source string, start int) (node inlineNode, end int, ok bool) {
	labelEnd := start + 1
	for labelEnd < len(source) && source[labelEnd] != ']' {
		if source[labelEnd] == '[' {
			return inlineNode{}, 0, false
		}
		if source[labelEnd] == '\\' && labelEnd+1 < len(source) && strings.IndexByte(escapable, source[labelEnd+1]) >= 0 {
			labelEnd++
		}
		labelEnd++
	}
	if !strings.HasPrefix(source[min(labelEnd, len(source)):], "](") {
		return inlineNode{}, 0, false
	}
	label := source[start+1 : labelEnd]
	if strings.TrimSpace(label) == "" {
		return inlineNode{}, 0, false
	}
	// The address ends at the ")" that isn't closing a "(" inside it.
	hrefStart := labelEnd + 2
	hrefEnd, depth := hrefStart, 0
	for ; hrefEnd < len(source); hrefEnd++ {
		if source[hrefEnd] == '(' {
			depth++
		}
		if source[hrefEnd] == ')' {
			if depth == 0 {
				break
			}
			depth--
		}
	}
	if hrefEnd >= len(source) {
		return inlineNode{}, 0, false
	}
	href := source[hrefStart:hrefEnd]
	if !urlWhole.MatchString(href) {
		return inlineNode{}, 0, false
	}
	// A link's words can't mention anyone: a token there reads as its handle.
	children := parseInline(tokensAsText(label))
	if holdsLink(children) {
		return inlineNode{}, 0, false
	}
	return inlineNode{kind: inlineLink, text: href, children: children}, hrefEnd + 1, true
}

func holdsLink(nodes []inlineNode) bool {
	for _, n := range nodes {
		if n.kind == inlineLink || holdsLink(n.children) {
			return true
		}
	}
	return false
}

func matchDelimited(source string, i, base int) (children []inlineNode, end int, ok bool) {
	for _, d := range delims {
		if !strings.HasPrefix(source[i:], d) {
			continue
		}
		start := i + len(d)
		// The opener must be followed by something other than whitespace
		// (or, for "*", another "*": that's an unclosed "**").
		if start >= len(source) || spaceAt(source, start) {
			continue
		}
		if d == "*" && source[start] == '*' {
			continue
		}
		j := findCloser(source, d, start+1)
		if d == "**" {
			if children, end, ok = closeOnStarRun(source, start, j, base); ok {
				return children, end, true
			}
		}
		if j == -1 {
			continue
		}
		// A spoiler can't mention anyone: a token there reads as its handle.
		if d == "||" {
			return parseInline(tokensAsText(source[start:j])), j + len(d), true
		}
		return parseInlineAt(source[start:j], base+start), j + len(d), true
	}
	return nil, 0, false
}

// closeOnStarRun reads "**a *b***": when bold closes on a run of three or
// more stars, the run's first stars can close the italic inside it.
func closeOnStarRun(source string, start, closeAt, base int) (children []inlineNode, end int, ok bool) {
	if closeAt == -1 || !strings.HasPrefix(source[closeAt:], "***") {
		return nil, 0, false
	}
	// A closer inside a run (its first star after a space) takes no part.
	if source[closeAt-1] == '*' {
		return nil, 0, false
	}
	runEnd := closeAt
	for runEnd < len(source) && source[runEnd] == '*' {
		runEnd++
	}
	children = parseInlineAt(source[start:runEnd-2], base+start)
	if len(children) == 0 || children[len(children)-1].kind != inlineStyled {
		return nil, 0, false
	}
	return children, runEnd, true
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
		// A style reads as its content, a link with a label as its label,
		// and a token as its handle.
		switch {
		case n.kind == inlineStyled || len(n.children) > 0:
			sb.WriteString(inlineString(n.children))
		case n.kind == inlineMention:
			_, _, handle := tokenParts(n.text)
			sb.WriteString("@" + handle)
		default:
			sb.WriteString(n.text)
		}
	}
	return sb.String()
}

// walkInline calls visit for each inline node of the parse, a node before
// its children. Code blocks have none.
func walkInline(blocks []block, visit func(inlineNode)) {
	var walk func(nodes []inlineNode)
	walk = func(nodes []inlineNode) {
		for _, node := range nodes {
			visit(node)
			walk(node.children)
		}
	}
	for _, parsed := range blocks {
		for _, line := range parsed.lines {
			walk(line)
		}
		for _, item := range parsed.items {
			walk(item)
		}
	}
}
