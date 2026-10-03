// Package text holds the string shaping shared by modules: one line of
// user text, and a cut to a rune budget.
package text

import (
	"strings"
	"unicode/utf8"
)

// OneLine collapses every run of whitespace, newlines included, to a
// single space.
func OneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// Truncate returns s when it has at most limit runes; otherwise the first
// limit-1 runes, trailing spaces and newlines trimmed, ending in an
// ellipsis. limit is at least 1.
func Truncate(s string, limit int) string {
	if utf8.RuneCountInString(s) <= limit {
		return s
	}
	runes := []rune(s)
	return strings.TrimRight(string(runes[:limit-1]), " \n") + "…"
}
