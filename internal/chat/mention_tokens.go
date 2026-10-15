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
// appear, and the channel's readers for @channel and @here.
type mentionTargets struct {
	people  []string
	groups  []string
	readers []string
}

// checkMentions keeps each token that names a reader of the channel or,
// in a public channel, a group of its space, with its current handle.
// Any other token, and any token in code, is saved as its handle, as
// text. It returns the content to store and who the kept tokens name.
func (s *Service) checkMentions(ctx context.Context, channel dbgen.Channel, participants []string, content string) (string, mentionTargets, error) {
	var targets mentionTargets
	content = codeAsText(content)
	matches := mentionTokenRE.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 && !namesEveryone(content) {
		return content, targets, nil
	}
	readers, err := s.channelReaders(ctx, channel, participants)
	if err != nil {
		return "", mentionTargets{}, err
	}
	targets.readers = readers
	var personIDs, groupIDs []string
	for _, match := range matches {
		kind, id := match[1], match[2]
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
	stored := mentionTokenRE.ReplaceAllStringFunc(content, func(token string) string {
		match := mentionTokenRE.FindStringSubmatch(token)
		kind, id, handle := match[1], match[2], match[3]
		name, kept := current[kind+id]
		if !kept {
			return "@" + handle
		}
		if kind == personToken && !slices.Contains(targets.people, id) {
			targets.people = append(targets.people, id)
		}
		if kind == groupToken && !slices.Contains(targets.groups, id) {
			targets.groups = append(targets.groups, id)
		}
		return "<@" + kind + ":" + id + ":" + name + ">"
	})
	return stored, targets, nil
}

// codeAsText saves each token inside code as its handle: a mention
// doesn't work in code, and code shows what was written.
func codeAsText(content string) string {
	if !strings.Contains(content, "<@") || !strings.Contains(content, "`") {
		return content
	}
	code := codeRanges(content)
	var out strings.Builder
	written := 0
	for _, match := range mentionTokenRE.FindAllStringSubmatchIndex(content, -1) {
		start, end := match[0], match[1]
		if !slices.ContainsFunc(code, func(span [2]int) bool { return start >= span[0] && start < span[1] }) {
			continue
		}
		out.WriteString(content[written:start])
		out.WriteString("@" + content[match[6]:match[7]])
		written = end
	}
	out.WriteString(content[written:])
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
	return utf8.RuneCountInString(mentionNames{}.text(content))
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
			names.people[record.ID] = record.Username
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

// text is stored content as a preview reads it: each token as its current
// @handle, or as its saved handle when its person or group is gone.
func (n mentionNames) text(content string) string {
	if !strings.Contains(content, "<@") {
		return content
	}
	return mentionTokenRE.ReplaceAllStringFunc(content, func(token string) string {
		match := mentionTokenRE.FindStringSubmatch(token)
		kind, id, handle := match[1], match[2], match[3]
		current := n.people
		if kind == groupToken {
			current = n.groups
		}
		if name, ok := current[id]; ok {
			handle = name
		}
		return "@" + handle
	})
}

// textOf is text for an optional content.
func (n mentionNames) textOf(content *string) *string {
	if content == nil {
		return nil
	}
	shown := n.text(*content)
	return &shown
}
