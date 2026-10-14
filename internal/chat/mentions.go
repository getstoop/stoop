package chat

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/getstoop/stoop/internal/dbgen"
)

// mentionRE matches @handle at a word boundary. Handles are the auth
// module's username rules (3-32 of [a-z0-9_]), matched case-insensitively.
var mentionRE = regexp.MustCompile(`(?i)(?:^|[^a-z0-9_@])@([a-z0-9_]{3,32})\b`)

// groupMentionRE matches @@handle, a group. mentionRE never matches it:
// that refuses an @ straight after another.
var groupMentionRE = regexp.MustCompile(`(?i)(?:^|[^a-z0-9_@])@@([a-z0-9_]{3,32})\b`)

// parseMentionHandles returns the distinct, lowercased @handles in content.
func parseMentionHandles(content string) []string {
	return parseHandles(mentionRE, content)
}

// parseGroupHandles returns the distinct, lowercased @@handles in content.
func parseGroupHandles(content string) []string {
	return parseHandles(groupMentionRE, content)
}

func parseHandles(pattern *regexp.Regexp, content string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range pattern.FindAllStringSubmatch(content, -1) {
		h := strings.ToLower(m[1])
		if !seen[h] {
			seen[h] = true
			out = append(out, h)
		}
	}
	return out
}

// entireChannelHandle addresses everyone in the channel; hereHandle only those
// currently online. Both are reserved usernames (auth refuses to register
// them) and need the messages.notify_entire_channel permission; without it the token is
// plain text.
const (
	entireChannelHandle = "channel"
	hereHandle          = "here"
)

// mentionResult is what a message's @tokens resolved to.
type mentionResult struct {
	userIDs       []string
	entireChannel bool
	here          bool
}

// resolveMentions maps a message's mentions to the user IDs they reach,
// excluding the author: @handles first, then @@handles, which reach a
// group's people in public channels only. When @channel or @here
// applies it decides alone, for groups as for @handles.
func (s *Service) resolveMentions(ctx context.Context, channel dbgen.Channel, participants []string, authorID, content string) (mentionResult, error) {
	res, err := s.resolvePersonMentions(ctx, channel, participants, authorID, parseMentionHandles(content))
	if err != nil || res.entireChannel || res.here || isDM(channel) || channel.Private {
		return res, err
	}
	groupHandles := parseGroupHandles(content)
	if len(groupHandles) == 0 {
		return res, nil
	}
	// A group's people are members of its space by foreign key, so every
	// one of them can read a public channel.
	groupMemberIDs, err := s.q.ListGroupMemberIDsByHandles(ctx, dbgen.ListGroupMemberIDsByHandlesParams{
		SpaceID: *channel.SpaceID, Handles: groupHandles,
	})
	if err != nil {
		return mentionResult{}, fmt.Errorf("resolve groups: %w", err)
	}
	reached := map[string]bool{authorID: true}
	for _, id := range res.userIDs {
		reached[id] = true
	}
	for _, id := range groupMemberIDs {
		if !reached[id] {
			reached[id] = true
			res.userIDs = append(res.userIDs, id)
		}
	}
	return res, nil
}

// resolvePersonMentions maps @handles to user IDs of people in the
// channel — the space's members, or the people of a private channel or a
// DM (passed in, nil for a public channel) — excluding the author. Others are silently
// ignored: a mention is an address, not a permission. @channel wins over
// @here if both appear; in a DM both are plain text.
func (s *Service) resolvePersonMentions(ctx context.Context, channel dbgen.Channel, participants []string, authorID string, handles []string) (mentionResult, error) {
	if len(handles) == 0 {
		return mentionResult{}, nil
	}
	var ids []string
	var err error
	if isDM(channel) || channel.Private {
		ids = participants
	} else {
		rows, err := s.q.ListSpaceMembers(ctx, *channel.SpaceID)
		if err != nil {
			return mentionResult{}, fmt.Errorf("list members: %w", err)
		}
		ids = make([]string, len(rows))
		for i, r := range rows {
			ids[i] = r.UserID
		}
	}

	var wantEntireChannel, wantHere bool
	for _, h := range handles {
		wantEntireChannel = wantEntireChannel || h == entireChannelHandle
		wantHere = wantHere || h == hereHandle
	}
	if (wantEntireChannel || wantHere) && !isDM(channel) && s.mayNotifyEntireChannel(ctx, channel) {
		targets := ids
		if !wantEntireChannel {
			if s.presence == nil {
				targets = nil
			} else if targets, err = s.presence.OnlineUserIDs(ctx, ids); err != nil {
				return mentionResult{}, fmt.Errorf("list online members: %w", err)
			}
		}
		res := mentionResult{entireChannel: wantEntireChannel, here: !wantEntireChannel}
		for _, id := range targets {
			if id != authorID {
				res.userIDs = append(res.userIDs, id)
			}
		}
		return res, nil
	}

	records, err := s.users.GetUsers(ctx, ids)
	if err != nil {
		return mentionResult{}, fmt.Errorf("resolve members: %w", err)
	}
	byHandle := make(map[string]string, len(records))
	for _, r := range records {
		byHandle[strings.ToLower(r.Username)] = r.ID
	}
	var res mentionResult
	for _, h := range handles {
		if id, ok := byHandle[h]; ok && id != authorID {
			res.userIDs = append(res.userIDs, id)
		}
	}
	return res, nil
}

// mentionsByMessage loads the mention lists for a page of messages.
func (s *Service) mentionsByMessage(ctx context.Context, messageIDs []string) (map[string][]string, error) {
	out := map[string][]string{}
	if len(messageIDs) == 0 {
		return out, nil
	}
	rows, err := s.q.ListMentionsForMessages(ctx, messageIDs)
	if err != nil {
		return nil, fmt.Errorf("list mentions: %w", err)
	}
	for _, r := range rows {
		out[r.MessageID] = append(out[r.MessageID], r.UserID)
	}
	return out, nil
}
