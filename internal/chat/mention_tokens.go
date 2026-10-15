package chat

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/getstoop/stoop/internal/dbgen"
)

// Stored content names who a mention means, not the handle it was typed
// with: <@u:ID:handle> for a person, <@g:ID:handle> for a group. Content
// is turned back into @handle text before it leaves this module. See
// messaging.md → Mention tokens.

// anyMentionRE matches @handle and @@handle together, so encoding
// reads the text as written in one pass.
var anyMentionRE = regexp.MustCompile(`(?i)(?:^|[^a-z0-9_@])(@@?)([a-z0-9_]{3,32})\b`)

// mentionTokenRE matches a stored token. The handle is the one written,
// read back when its person or group can't be found.
var mentionTokenRE = regexp.MustCompile(`<@([ug]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([a-z0-9_]{3,32})>`)

const (
	personToken = "u"
	groupToken  = "g"
)

// mentionTargets is who a message's handles name, handle → ID, and the
// channel's readers when it has @handles.
type mentionTargets struct {
	people  map[string]string
	groups  map[string]string
	readers []string
}

// lookupMentions finds the @handles that name a reader of the channel
// and, in a public channel, the @@handles that name a group of its
// space.
func (s *Service) lookupMentions(ctx context.Context, channel dbgen.Channel, participants []string, content string) (mentionTargets, error) {
	targets := mentionTargets{people: map[string]string{}, groups: map[string]string{}}
	if handles := parseMentionHandles(content); len(handles) > 0 {
		readers, err := s.channelReaders(ctx, channel, participants)
		if err != nil {
			return mentionTargets{}, err
		}
		records, err := s.users.GetUsers(ctx, readers)
		if err != nil {
			return mentionTargets{}, fmt.Errorf("resolve members: %w", err)
		}
		byHandle := make(map[string]string, len(records))
		for _, record := range records {
			byHandle[strings.ToLower(record.Username)] = record.ID
		}
		for _, handle := range handles {
			if id, ok := byHandle[handle]; ok {
				targets.people[handle] = id
			}
		}
		targets.readers = readers
	}
	if isDM(channel) || channel.Private {
		return targets, nil
	}
	if handles := parseGroupHandles(content); len(handles) > 0 {
		rows, err := s.q.ListGroupsByHandles(ctx, dbgen.ListGroupsByHandlesParams{SpaceID: *channel.SpaceID, Handles: handles})
		if err != nil {
			return mentionTargets{}, fmt.Errorf("resolve groups: %w", err)
		}
		for _, row := range rows {
			targets.groups[row.Handle] = row.ID
		}
	}
	return targets, nil
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

// encodeMentions turns each handle that names someone into its token. A
// handle naming nobody stays text.
func encodeMentions(content string, targets mentionTargets) string {
	matches := anyMentionRE.FindAllStringSubmatchIndex(content, -1)
	if len(matches) == 0 {
		return content
	}
	var out strings.Builder
	written := 0
	for _, match := range matches {
		symbolStart, handleStart, handleEnd := match[2], match[4], match[5]
		handle := strings.ToLower(content[handleStart:handleEnd])
		kind, ids := personToken, targets.people
		if content[symbolStart:handleStart] == "@@" {
			kind, ids = groupToken, targets.groups
		}
		id, ok := ids[handle]
		if !ok {
			continue
		}
		out.WriteString(content[written:symbolStart])
		out.WriteString("<@" + kind + ":" + id + ":" + handle + ">")
		written = handleEnd
	}
	out.WriteString(content[written:])
	return out.String()
}

// mentionNames is the current handle behind each token, by ID.
type mentionNames struct {
	people map[string]string
	groups map[string]string
}

// mentionNames looks up the current handles behind a batch of stored
// contents: one call for the people, one query for the groups.
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

// text is stored content as people read it: each token as its current
// @handle or @@handle, or as the handle it was written with when its
// person or group is gone.
func (n mentionNames) text(content string) string {
	if !strings.Contains(content, "<@") {
		return content
	}
	return mentionTokenRE.ReplaceAllStringFunc(content, func(token string) string {
		match := mentionTokenRE.FindStringSubmatch(token)
		kind, id, handle := match[1], match[2], match[3]
		symbol, current := "@", n.people
		if kind == groupToken {
			symbol, current = "@@", n.groups
		}
		if name, ok := current[id]; ok {
			handle = name
		}
		return symbol + handle
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
