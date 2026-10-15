package chat

import (
	"context"
	"fmt"
	"maps"
	"regexp"
	"slices"
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

// resolveMentions turns a message's targets into the people told,
// excluding the author: @handles first, then @@handles, which name groups
// in public channels only. When @channel or @here applies it decides
// alone, for groups as for @handles.
func (s *Service) resolveMentions(ctx context.Context, channel dbgen.Channel, authorID, content string, targets mentionTargets) (mentionResult, error) {
	res, err := s.resolvePersonMentions(ctx, channel, authorID, parseMentionHandles(content), targets)
	if err != nil || res.entireChannel || res.here || len(targets.groups) == 0 {
		return res, err
	}
	// A group's people are members of its space by foreign key, so every
	// one of them can read a public channel.
	groupMemberIDs, err := s.q.ListGroupMemberIDsByHandles(ctx, dbgen.ListGroupMemberIDsByHandlesParams{
		SpaceID: *channel.SpaceID, Handles: slices.Collect(maps.Keys(targets.groups)),
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

// resolvePersonMentions maps @handles to the people in the channel they
// name, excluding the author. Others are silently ignored: a mention is
// an address, not a permission. @channel wins over @here if both appear;
// in a DM both are plain text.
func (s *Service) resolvePersonMentions(ctx context.Context, channel dbgen.Channel, authorID string, handles []string, targets mentionTargets) (mentionResult, error) {
	var wantEntireChannel, wantHere bool
	for _, h := range handles {
		wantEntireChannel = wantEntireChannel || h == entireChannelHandle
		wantHere = wantHere || h == hereHandle
	}
	if (wantEntireChannel || wantHere) && !isDM(channel) && s.mayNotifyEntireChannel(ctx, channel) {
		recipients := targets.readers
		if !wantEntireChannel {
			var err error
			if s.presence == nil {
				recipients = nil
			} else if recipients, err = s.presence.OnlineUserIDs(ctx, targets.readers); err != nil {
				return mentionResult{}, fmt.Errorf("list online members: %w", err)
			}
		}
		res := mentionResult{entireChannel: wantEntireChannel, here: !wantEntireChannel}
		for _, id := range recipients {
			if id != authorID {
				res.userIDs = append(res.userIDs, id)
			}
		}
		return res, nil
	}

	var res mentionResult
	for _, h := range handles {
		if id, ok := targets.people[h]; ok && id != authorID {
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
