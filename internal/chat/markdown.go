package chat

import (
	"regexp"
	"strings"
)

// Messages are stored as the Markdown subset the web client renders
// (see web/src/api/markdown.ts). The server never renders it; the one
// thing it needs is a plain-text form for one-line previews.

var (
	mdEscape      = regexp.MustCompile(`\\([\\` + "`" + `*_~>|#\[\]()-])`)
	mdFenceLine   = regexp.MustCompile("```([^`\n]+)```")
	mdFenceBlock  = regexp.MustCompile("(?s)```[^\n]*\n?(.*?)```")
	mdInlineCode  = regexp.MustCompile("`([^`\n]+)`")
	mdBoldItalic  = regexp.MustCompile(`\*\*\*(\S(?:.*?\S)?)\*\*\*`)
	mdBold        = regexp.MustCompile(`\*\*(\S(?:.*?\S)?)\*\*`)
	mdUnderline   = regexp.MustCompile(`__(\S(?:.*?\S)?)__`)
	mdStrike      = regexp.MustCompile(`~~(\S(?:.*?\S)?)~~`)
	mdItalic      = regexp.MustCompile(`\*(\S(?:[^*]*?\S)?)\*`)
	mdSpoiler     = regexp.MustCompile(`\|\|(\S(?:.*?\S)?)\|\|`)
	mdQuotePrefix = regexp.MustCompile(`(?m)^>\s?`)
	// "- item", "* item", "1. item" — the bullet is markup, the item is
	// the text. Mirrors LIST in web/src/api/markdown.ts.
	mdListPrefix = regexp.MustCompile(`(?m)^ {0,6}(?:[-*]|\d{1,9}[.)])\s+`)
	mdWhitespace = regexp.MustCompile(`\s*\n\s*`)
)

// Escaped punctuation is parked in the Private Use Area (U+E000 + the
// character) while the marker passes run, so an escaped "*" is never
// mistaken for italics, then restored.
const escapeBase = 0xE000

func parkEscapes(s string) string {
	return mdEscape.ReplaceAllStringFunc(s, func(m string) string {
		return string(rune(escapeBase + int(m[1])))
	})
}

func restoreEscapes(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= escapeBase && r < escapeBase+0x80 {
			return r - escapeBase
		}
		return r
	}, s)
}

// plainText strips Markdown markers for previews: activity lines and
// reply quotes. Mirrors plainText in the web client.
func plainText(s string) string {
	s = parkEscapes(s)
	s = mdFenceLine.ReplaceAllString(s, "$1")
	s = mdFenceBlock.ReplaceAllString(s, "$1")
	s = mdInlineCode.ReplaceAllString(s, "$1")
	s = mdBoldItalic.ReplaceAllString(s, "$1")
	s = mdBold.ReplaceAllString(s, "$1")
	s = mdUnderline.ReplaceAllString(s, "$1")
	s = mdStrike.ReplaceAllString(s, "$1")
	s = mdItalic.ReplaceAllString(s, "$1")
	// A spoiler's text shows in a preview; hiding it in the message is
	// what the marker is for, and an activity preview with a blank line in it
	// would be worse than one that quotes the words.
	s = mdSpoiler.ReplaceAllString(s, "$1")
	s = mdQuotePrefix.ReplaceAllString(s, "")
	s = mdListPrefix.ReplaceAllString(s, "")
	s = restoreEscapes(s)
	s = mdWhitespace.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}
