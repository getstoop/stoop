package chat

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/getstoop/stoop/internal/dbgen"
)

// Only a token mentions anyone: <@u:ID:handle> for a person,
// <@g:ID:handle> for a group. Content carries them as stored; previews
// read them back as @handle text. See messaging.md → Mentions.

// mentionTokenRE matches a token. The handle is the one current when the
// message was saved, for readers that can't find the person or group.
var mentionTokenRE = regexp.MustCompile(`<@([ug]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([a-z0-9_]{3,32})>`)

const (
	personToken = "u"
	groupToken  = "g"
)

// mentionTargets is who a message's kept tokens name, in the order they
// appear, whether it uses @channel and @here as words, and the channel's
// readers for those.
type mentionTargets struct {
	people              []string
	groups              []string
	readers             []string
	entireChannel, here bool
}

// checkMentions keeps each live token that names a reader of the channel
// or, in a public channel, a group of its space, with its current handle.
// Any other token, and any token the message shows as text (in code, a
// spoiler or a link's words), is saved as its handle, as text. It returns
// the content to store and who the kept tokens name.
func (s *Service) checkMentions(ctx context.Context, channel dbgen.Channel, participants []string, content string) (string, mentionTargets, error) {
	var targets mentionTargets
	hasTokens := false
	eachToken(content, func(_, _ int) { hasTokens = true })
	if !hasTokens && !mayNameEveryone(content) {
		return content, targets, nil
	}
	shown := readMentions(content)
	if !hasTokens && !shown.entireChannel && !shown.here {
		return content, targets, nil
	}
	readers, err := s.channelReaders(ctx, channel, participants)
	if err != nil {
		return "", mentionTargets{}, err
	}
	targets.readers = readers
	targets.entireChannel, targets.here = shown.entireChannel, shown.here
	if !hasTokens {
		return content, targets, nil
	}
	var personIDs, groupIDs []string
	for _, token := range shown.tokens {
		kind, id, _ := tokenParts(token.text)
		switch {
		case kind == personToken && slices.Contains(readers, id) && !slices.Contains(personIDs, id):
			personIDs = append(personIDs, id)
		case kind == groupToken && !slices.Contains(groupIDs, id):
			groupIDs = append(groupIDs, id)
		}
	}
	current := map[string]string{}
	if len(personIDs) > 0 {
		records, err := s.users.GetUsers(ctx, personIDs)
		if err != nil {
			return "", mentionTargets{}, fmt.Errorf("read mentioned people: %w", err)
		}
		for _, record := range records {
			current[personToken+record.ID] = strings.ToLower(record.Username)
		}
	}
	if len(groupIDs) > 0 && !isDM(channel) && !channel.Private {
		rows, err := s.q.ListSpaceGroupsByIDs(ctx, dbgen.ListSpaceGroupsByIDsParams{SpaceID: *channel.SpaceID, Ids: groupIDs})
		if err != nil {
			return "", mentionTargets{}, fmt.Errorf("read mentioned groups: %w", err)
		}
		for _, row := range rows {
			current[groupToken+row.ID] = row.Handle
		}
	}
	stored := storedForm(content, shown.tokens, current)
	// Who is told is read from what is stored, since rewriting a token
	// can change how the rest of the message reads.
	if stored != content {
		shown = readMentions(stored)
		targets.entireChannel, targets.here = shown.entireChannel, shown.here
	}
	for _, token := range shown.tokens {
		kind, id, _ := tokenParts(token.text)
		if kind == personToken && !slices.Contains(targets.people, id) {
			targets.people = append(targets.people, id)
		}
		if kind == groupToken && !slices.Contains(targets.groups, id) {
			targets.groups = append(targets.groups, id)
		}
	}
	return stored, targets, nil
}

// shownMentions is what a message shows as mentions: its tokens, in
// order, and whether @channel or @here is a word of its text.
type shownMentions struct {
	tokens              []inlineNode
	entireChannel, here bool
}

// readMentions reads them off the parse, as the client draws them: a
// token in code, a spoiler or a link's words is text, and code and an
// address hold no words.
func readMentions(content string) shownMentions {
	var shown shownMentions
	walkInline(parseMarkdown(content), func(node inlineNode) {
		switch node.kind {
		case inlineMention:
			shown.tokens = append(shown.tokens, node)
		case inlineText:
			if !strings.Contains(node.text, "@") {
				return
			}
			for _, match := range everyoneRE.FindAllStringSubmatch(node.text, -1) {
				word := strings.ToLower(match[1])
				shown.entireChannel = shown.entireChannel || word == entireChannelHandle
				shown.here = shown.here || word == hereHandle
			}
		}
	})
	return shown
}

// storedForm is content as saved: each live token found in current, by
// kind and ID, carries that handle; every other token is its handle, as
// text.
func storedForm(content string, live []inlineNode, current map[string]string) string {
	liveAt := make(map[int]bool, len(live))
	for _, token := range live {
		liveAt[token.at] = true
	}
	var out strings.Builder
	written := 0
	eachToken(content, func(start, end int) {
		kind, id, handle := tokenParts(content[start:end])
		out.WriteString(content[written:start])
		if name, kept := current[kind+id]; kept && liveAt[start] {
			out.WriteString("<@" + kind + ":" + id + ":" + name + ">")
		} else {
			out.WriteString("@" + handle)
		}
		written = end
	})
	out.WriteString(content[written:])
	return out.String()
}

// eachToken calls visit with where each token in content starts and ends.
func eachToken(content string, visit func(start, end int)) {
	for from := 0; ; {
		at := strings.Index(content[from:], "<@")
		if at == -1 {
			return
		}
		start := from + at
		if length := tokenLength(content[start:]); length > 0 {
			visit(start, start+length)
			from = start + length
		} else {
			from = start + 1
		}
	}
}

// tokenLength is the length of the token text starts with, or 0: the
// match mentionTokenRE makes, by hand, since the parse asks at every "<".
func tokenLength(text string) int {
	const idEnd = len("<@u:") + 36
	if len(text) < idEnd+len(":abc>") || text[0] != '<' || text[1] != '@' || (text[2] != personToken[0] && text[2] != groupToken[0]) || text[3] != ':' {
		return 0
	}
	for index := len("<@u:"); index < idEnd; index++ {
		char := text[index]
		switch index - len("<@u:") {
		case 8, 13, 18, 23:
			if char != '-' {
				return 0
			}
		default:
			if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
				return 0
			}
		}
	}
	if text[idEnd] != ':' {
		return 0
	}
	end := idEnd + 1
	for end < len(text) && end-idEnd <= 33 && isHandleChar(text[end]) {
		end++
	}
	if handle := end - idEnd - 1; handle < 3 || handle > 32 || end == len(text) || text[end] != '>' {
		return 0
	}
	return end + 1
}

func isHandleChar(char byte) bool {
	return (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '_'
}

// tokenParts splits a whole token: "<@", the kind, ":", the
// 36-character ID, ":", the handle, ">".
func tokenParts(token string) (kind, id, handle string) {
	return token[2:3], token[4:40], token[41 : len(token)-1]
}

// tokensAsText is text with each token as the @handle it was saved with.
func tokensAsText(text string) string {
	if !strings.Contains(text, "<@") {
		return text
	}
	var out strings.Builder
	written := 0
	eachToken(text, func(start, end int) {
		_, _, handle := tokenParts(text[start:end])
		out.WriteString(text[written:start] + "@" + handle)
		written = end
	})
	out.WriteString(text[written:])
	return out.String()
}

// channelReaders is who can read the channel: the space's members, or
// the people of a private channel or a DM (passed in).
func (s *Service) channelReaders(ctx context.Context, channel dbgen.Channel, participants []string) ([]string, error) {
	if isDM(channel) || channel.Private {
		return participants, nil
	}
	rows, err := s.q.ListSpaceMembers(ctx, *channel.SpaceID)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}
	ids := make([]string, len(rows))
	for index, row := range rows {
		ids[index] = row.UserID
	}
	return ids, nil
}

// writtenLength is content's length as people read it, each token
// counted as its handle, for the message length limit.
func writtenLength(content string) int {
	return utf8.RuneCountInString(tokensAsText(content))
}

// mentionNames is the current handle behind each token, by ID.
type mentionNames struct {
	people map[string]string
	groups map[string]string
}

// mentionNames looks up the current handles behind a batch of stored
// contents, for previews: one call for the people, one query for the
// groups.
func (s *Service) mentionNames(ctx context.Context, contents ...string) (mentionNames, error) {
	names := mentionNames{people: map[string]string{}, groups: map[string]string{}}
	var userIDs, groupIDs []string
	seen := map[string]bool{}
	for _, content := range contents {
		for _, match := range mentionTokenRE.FindAllStringSubmatch(content, -1) {
			kind, id := match[1], match[2]
			if seen[id] {
				continue
			}
			seen[id] = true
			if kind == personToken {
				userIDs = append(userIDs, id)
			} else {
				groupIDs = append(groupIDs, id)
			}
		}
	}
	if len(userIDs) > 0 {
		records, err := s.users.GetUsers(ctx, userIDs)
		if err != nil {
			return mentionNames{}, fmt.Errorf("read mentioned people: %w", err)
		}
		for _, record := range records {
			names.people[record.ID] = strings.ToLower(record.Username)
		}
	}
	if len(groupIDs) > 0 {
		rows, err := s.q.ListGroupHandlesByIDs(ctx, groupIDs)
		if err != nil {
			return mentionNames{}, fmt.Errorf("read mentioned groups: %w", err)
		}
		for _, row := range rows {
			names.groups[row.ID] = row.Handle
		}
	}
	return names, nil
}

// current is stored content with each token carrying its current
// handle, or its saved one when its person or group is gone. A preview
// reads the tokens after the markup, so a handle's "__" stays as written.
func (n mentionNames) current(content string) string {
	if !strings.Contains(content, "<@") {
		return content
	}
	var out strings.Builder
	written := 0
	eachToken(content, func(start, end int) {
		kind, id, handle := tokenParts(content[start:end])
		names := n.people
		if kind == groupToken {
			names = n.groups
		}
		if name, ok := names[id]; ok {
			handle = name
		}
		out.WriteString(content[written:start] + "<@" + kind + ":" + id + ":" + handle + ">")
		written = end
	})
	out.WriteString(content[written:])
	return out.String()
}

// currentOf is current for an optional content.
func (n mentionNames) currentOf(content *string) *string {
	if content == nil {
		return nil
	}
	shown := n.current(*content)
	return &shown
}
