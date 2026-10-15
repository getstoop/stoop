package chat

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/getstoop/stoop/internal/dbgen"
)

// everyoneRE matches @channel and @here, the two mentions that stay
// typed words: both are reserved usernames, so nothing clashes with them.
var everyoneRE = regexp.MustCompile(`(?i)(?:^|[^a-z0-9_@])@(channel|here)\b`)

// entireChannelHandle addresses everyone in the channel; hereHandle only those
// currently online. Both need the messages.notify_entire_channel
// permission; without it the word is plain text.
const (
	entireChannelHandle = "channel"
	hereHandle          = "here"
)

// namesEveryone reports whether content holds @channel or @here.
func namesEveryone(content string) bool {
	return everyoneRE.MatchString(content)
}

// mentionResult is who a message's mentions reach.
type mentionResult struct {
	userIDs       []string
	entireChannel bool
	here          bool
}

// resolveMentions turns a message's kept tokens into the people told,
// excluding the author: people first, then the groups' people. When
// @channel or @here applies it decides alone. @channel wins over @here if
// both appear; in a DM both are plain text.
func (s *Service) resolveMentions(ctx context.Context, channel dbgen.Channel, authorID, content string, targets mentionTargets) (mentionResult, error) {
	var wantEntireChannel, wantHere bool
	for _, match := range everyoneRE.FindAllStringSubmatch(content, -1) {
		word := strings.ToLower(match[1])
		wantEntireChannel = wantEntireChannel || word == entireChannelHandle
		wantHere = wantHere || word == hereHandle
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
	reached := map[string]bool{authorID: true}
	reach := func(ids []string) {
		for _, id := range ids {
			if !reached[id] {
				reached[id] = true
				res.userIDs = append(res.userIDs, id)
			}
		}
	}
	reach(targets.people)
	if len(targets.groups) > 0 {
		// A group's people are members of its space by foreign key, so
		// every one of them can read a public channel.
		groupMemberIDs, err := s.q.ListGroupMemberIDsByGroupIDs(ctx, targets.groups)
		if err != nil {
			return mentionResult{}, fmt.Errorf("resolve groups: %w", err)
		}
		reach(groupMemberIDs)
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
