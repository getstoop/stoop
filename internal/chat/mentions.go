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

// parseMentionHandles returns the distinct, lowercased handles in content.
func parseMentionHandles(content string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range mentionRE.FindAllStringSubmatch(content, -1) {
		h := strings.ToLower(m[1])
		if !seen[h] {
			seen[h] = true
			out = append(out, h)
		}
	}
	return out
}

// everyoneHandle addresses the whole space; hereHandle only the members
// currently online. Both are reserved usernames (auth refuses to register
// them) and need the mention_everyone permission; without it the token is
// plain text.
const (
	everyoneHandle = "everyone"
	hereHandle     = "here"
)

// mentionResult is what a message's @tokens resolved to.
type mentionResult struct {
	userIDs  []string
	everyone bool
	here     bool
}

// resolveMentions maps @handles in content to user IDs of people in the
// channel — the space's members, or a DM's participants — excluding the
// author. Others are silently ignored: a mention is an address, not a
// permission. @everyone wins over @here if both appear; in a DM both are
// plain text.
func (s *Service) resolveMentions(ctx context.Context, channel dbgen.Channel, authorID, content string) (mentionResult, error) {
	handles := parseMentionHandles(content)
	if len(handles) == 0 {
		return mentionResult{}, nil
	}
	var ids []string
	var err error
	if isDM(channel) {
		if ids, err = s.q.ListDMMembers(ctx, channel.ID); err != nil {
			return mentionResult{}, fmt.Errorf("list participants: %w", err)
		}
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

	var wantEveryone, wantHere bool
	for _, h := range handles {
		wantEveryone = wantEveryone || h == everyoneHandle
		wantHere = wantHere || h == hereHandle
	}
	if (wantEveryone || wantHere) && !isDM(channel) && s.requirePermission(ctx, *channel.SpaceID, PermMentionEveryone) == nil {
		targets := ids
		if !wantEveryone {
			if s.presence == nil {
				targets = nil
			} else if targets, err = s.presence.OnlineUserIDs(ctx, ids); err != nil {
				return mentionResult{}, fmt.Errorf("list online members: %w", err)
			}
		}
		res := mentionResult{everyone: wantEveryone, here: !wantEveryone}
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
