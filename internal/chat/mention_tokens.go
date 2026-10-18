package chat

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/getstoop/stoop/internal/dbgen"
)

// Only a token mentions anyone: <@u:ID:handle> for a person,
// <@g:ID:handle> for a group. <#ID:name> links a channel and tells
// nobody. Content carries them as stored; previews read them back as
// @handle and #name text. See messaging.md → Mentions and Channel links.
// The handle or name is the one current when the message was saved, for
// readers that can't find the person, group or channel.

// The kind of a token, as tokenParts gives it: the letter after "<@", or
// channelToken for "<#".
const (
	personToken  = "u"
	groupToken   = "g"
	channelToken = "c"
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
// or, in a public channel, a group or a public text channel of its space,
// with its current handle or name. Any other token, and any token the
// message shows as text (in code, a spoiler or a link's words), is saved
// as its handle or name, as text. It returns the content to store and who
// the kept tokens name; a channel link names nobody.
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
	var personIDs, groupIDs, channelIDs []string
	for _, token := range shown.tokens {
		kind, id, _ := tokenParts(token.text)
		switch {
		case kind == personToken && slices.Contains(readers, id) && !slices.Contains(personIDs, id):
			personIDs = append(personIDs, id)
		case kind == groupToken && !slices.Contains(groupIDs, id):
			groupIDs = append(groupIDs, id)
		case kind == channelToken && !slices.Contains(channelIDs, id):
			channelIDs = append(channelIDs, id)
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
	// A channel link can be followed by anyone who reads the message, so
	// it is kept only in a public channel and only to a public one. A
	// name saved before the naming rule can't be written in a token.
	if len(channelIDs) > 0 && !isDM(channel) && !channel.Private {
		rows, err := s.q.ListLinkableChannelsByIDs(ctx, dbgen.ListLinkableChannelsByIDsParams{SpaceID: *channel.SpaceID, Ids: channelIDs})
		if err != nil {
			return "", mentionTargets{}, fmt.Errorf("read linked channels: %w", err)
		}
		for _, row := range rows {
			if validChannelName(row.Name) {
				current[channelToken+row.ID] = row.Name
			}
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
// kind and ID, carries that handle or name; every other token is its
// handle or name, as text.
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
			out.WriteString(tokenText(kind, id, name))
		} else {
			out.WriteString(tokenAsText(kind, handle))
		}
		written = end
	})
	out.WriteString(content[written:])
	return out.String()
}

// eachToken calls visit with where each token in content starts and ends.
func eachToken(content string, visit func(start, end int)) {
	for from := 0; ; {
		at := strings.IndexByte(content[from:], '<')
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

// tokenLength is the length of the token text starts with, or 0. By
// hand, since the parse asks at every "<": "<@u:" or "<@g:" then a
// 36-character ID, ":", a handle of 3 to 32 of a-z, 0-9 and _, and ">";
// or "<#" then the ID, ":", a channel name of 1 to 32 of a-z, 0-9, - and
// _, and ">".
func tokenLength(text string) int {
	prefix, minName, nameChar := len("<@u:"), 3, isHandleChar
	switch {
	case len(text) >= 2 && text[0] == '<' && text[1] == '#':
		prefix, minName, nameChar = len("<#"), 1, isChannelNameChar
	case len(text) < 4 || text[0] != '<' || text[1] != '@' || (text[2] != personToken[0] && text[2] != groupToken[0]) || text[3] != ':':
		return 0
	}
	idEnd := prefix + 36
	if len(text) < idEnd+len(":")+minName+len(">") {
		return 0
	}
	for index := prefix; index < idEnd; index++ {
		char := text[index]
		switch index - prefix {
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
	for end < len(text) && end-idEnd <= 33 && nameChar(text[end]) {
		end++
	}
	if name := end - idEnd - 1; name < minName || name > 32 || end == len(text) || text[end] != '>' {
		return 0
	}
	return end + 1
}

func isHandleChar(char byte) bool {
	return (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '_'
}

func isChannelNameChar(char byte) bool {
	return isHandleChar(char) || char == '-'
}

// tokenParts splits a whole token: "<@", the kind, ":", the
// 36-character ID, ":", the handle, ">"; or "<#", the ID, ":", the
// channel's name, ">", whose kind is channelToken.
func tokenParts(token string) (kind, id, handle string) {
	if token[1] == '#' {
		return channelToken, token[2:38], token[39 : len(token)-1]
	}
	return token[2:3], token[4:40], token[41 : len(token)-1]
}

// tokenText writes a token of kind for id, carrying handle.
func tokenText(kind, id, handle string) string {
	if kind == channelToken {
		return "<#" + id + ":" + handle + ">"
	}
	return "<@" + kind + ":" + id + ":" + handle + ">"
}

// tokenAsText is how a token of kind reads as text: @handle, or #name for
// a channel.
func tokenAsText(kind, handle string) string {
	if kind == channelToken {
		return "#" + handle
	}
	return "@" + handle
}

// tokensAsText is text with each token as the @handle or #name it was
// saved with.
func tokensAsText(text string) string {
	if !strings.Contains(text, "<") {
		return text
	}
	var out strings.Builder
	written := 0
	eachToken(text, func(start, end int) {
		kind, _, handle := tokenParts(text[start:end])
		out.WriteString(text[written:start] + tokenAsText(kind, handle))
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
// counted as its @handle or #name, for the message length limit.
func writtenLength(content string) int {
	return utf8.RuneCountInString(tokensAsText(content))
}

// mentionNames is the current handle or name behind each token, by ID.
type mentionNames struct {
	people   map[string]string
	groups   map[string]string
	channels map[string]string
}

// mentionNames looks up the current handles and names behind a batch of
// stored contents, for previews: one call for the people, one query each
// for the groups and the channels.
func (s *Service) mentionNames(ctx context.Context, contents ...string) (mentionNames, error) {
	names := mentionNames{people: map[string]string{}, groups: map[string]string{}, channels: map[string]string{}}
	var userIDs, groupIDs, channelIDs []string
	seen := map[string]bool{}
	for _, content := range contents {
		eachToken(content, func(start, end int) {
			kind, id, _ := tokenParts(content[start:end])
			if seen[id] {
				return
			}
			seen[id] = true
			switch kind {
			case personToken:
				userIDs = append(userIDs, id)
			case groupToken:
				groupIDs = append(groupIDs, id)
			default:
				channelIDs = append(channelIDs, id)
			}
		})
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
	if len(channelIDs) > 0 {
		rows, err := s.q.ListChannelNamesByIDs(ctx, channelIDs)
		if err != nil {
			return mentionNames{}, fmt.Errorf("read linked channels: %w", err)
		}
		for _, row := range rows {
			if validChannelName(row.Name) {
				names.channels[row.ID] = row.Name
			}
		}
	}
	return names, nil
}

// current is stored content with each token carrying its current
// handle or name, or its saved one when its person, group or channel is
// gone. A preview reads the tokens after the markup, so a handle's "__"
// stays as written.
func (n mentionNames) current(content string) string {
	if !strings.Contains(content, "<") {
		return content
	}
	var out strings.Builder
	written := 0
	eachToken(content, func(start, end int) {
		kind, id, handle := tokenParts(content[start:end])
		names := n.people
		switch kind {
		case groupToken:
			names = n.groups
		case channelToken:
			names = n.channels
		}
		if name, ok := names[id]; ok {
			handle = name
		}
		out.WriteString(content[written:start] + tokenText(kind, id, handle))
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
