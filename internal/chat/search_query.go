package chat

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// The query syntax: docs/proposals/message-search.md → What the index
// matches. Filters come out here; the words go to websearch_to_tsquery.
const (
	maxSearchQueryLen = 200
	searchPrefixMin   = 3
)

// searchQuery is a parsed search string.
type searchQuery struct {
	// Words in websearch syntax, without the prefixed term.
	words string
	// The last bare term as a quoted tsquery lexeme with :*, or "".
	prefix string
	// Filter values as typed (handles and names lowercased, sigils
	// stripped); empty when absent.
	from    string
	in      string
	before  *time.Time
	after   *time.Time
	hasText bool
}

// parseSearchQuery splits filters from words. Tokens are separated by
// whitespace; "…" groups a phrase and may follow a filter key. Unknown
// key: tokens stay words.
func parseSearchQuery(q string) (searchQuery, error) {
	var out searchQuery
	if utf8.RuneCountInString(q) > maxSearchQueryLen {
		return out, fmt.Errorf("query must be at most %d characters", maxSearchQueryLen)
	}
	var words []string
	for _, tok := range tokenizeSearch(q) {
		key, val, ok := splitFilter(tok)
		if !ok {
			words = append(words, tok)
			continue
		}
		switch key {
		case "from":
			out.from = strings.ToLower(strings.TrimPrefix(val, "@"))
		case "in":
			out.in = strings.TrimPrefix(val, "#")
		case "before", "after":
			day, err := time.Parse("2006-01-02", val)
			if err != nil {
				return out, fmt.Errorf("%s: wants a date as YYYY-MM-DD", key)
			}
			if key == "before" {
				out.before = &day
			} else {
				next := day.AddDate(0, 0, 1)
				out.after = &next
			}
		default:
			words = append(words, tok)
		}
	}
	if len(words) == 0 {
		return out, errors.New("type a word to search for")
	}
	out.hasText = true

	// The last bare word matches as a prefix: not quoted, not negated,
	// no operator characters, and long enough that the prefix is narrow.
	last := words[len(words)-1]
	if isBareTerm(last) && utf8.RuneCountInString(last) >= searchPrefixMin {
		words = words[:len(words)-1]
		out.prefix = tsqueryLexeme(last) + ":*"
	}
	out.words = strings.Join(words, " ")
	return out, nil
}

// tokenizeSearch splits on whitespace, keeping "quoted phrases" together
// (with their quotes, which websearch_to_tsquery understands), also when
// they follow a key: prefix.
func tokenizeSearch(q string) []string {
	var toks []string
	var cur strings.Builder
	inQuote := false
	flush := func() {
		if cur.Len() > 0 {
			toks = append(toks, cur.String())
			cur.Reset()
		}
	}
	for _, r := range q {
		switch {
		case r == '"':
			inQuote = !inQuote
			cur.WriteRune(r)
		case !inQuote && (r == ' ' || r == '\t' || r == '\n' || r == '\r'):
			flush()
		default:
			cur.WriteRune(r)
		}
	}
	flush()
	return toks
}

// splitFilter recognises key:value where key is letters only and value is
// non-empty; a quoted value loses its quotes.
func splitFilter(tok string) (key, val string, ok bool) {
	i := strings.IndexByte(tok, ':')
	if i <= 0 || i == len(tok)-1 {
		return "", "", false
	}
	key = strings.ToLower(tok[:i])
	for _, r := range key {
		if r < 'a' || r > 'z' {
			return "", "", false
		}
	}
	val = strings.Trim(tok[i+1:], `"`)
	if val == "" {
		return "", "", false
	}
	return key, val, true
}

func isBareTerm(tok string) bool {
	if strings.HasPrefix(tok, "-") || strings.HasPrefix(tok, `"`) {
		return false
	}
	if strings.EqualFold(tok, "or") {
		return false
	}
	return !strings.ContainsAny(tok, ":*&|!()<>")
}

// tsqueryLexeme quotes a term for to_tsquery, which normalises what is
// inside the quotes with the same parser as the column.
func tsqueryLexeme(term string) string {
	term = strings.ReplaceAll(term, `\`, `\\`)
	term = strings.ReplaceAll(term, `'`, `''`)
	return "'" + term + "'"
}
