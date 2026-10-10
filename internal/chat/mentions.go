package chat

import (
	"context"
	"fmt"
	"regexp"
	"slices"
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

// channelHandle addresses everyone in the channel; hereHandle only those
// of them who are online. Both are reserved usernames (auth refuses to
// register them) and need the messages.notify_everyone permission;
// without it the token is plain text.
const (
	channelHandle = "channel"
	hereHandle    = "here"
)

// mentionResult is what a message's @tokens resolved to.
type mentionResult struct {
	// userIDs is everyone the message addresses.
	userIDs []string
	// named are those addressed by their own handle. In a text channel
	// that brings in the ones who are not in it.
	named   []string
	channel bool
	here    bool
}

// resolveMentions maps @handles in content to user IDs, excluding the
// author. A handle is looked up among the space's members, or a DM's
// participants (passed in, nil for a space channel); others are silently
// ignored: a mention is an address, not a permission. @channel and @here
// reach the people in the channel, @channel winning if both appear; in a
// DM both are plain text.
func (s *Service) resolveMentions(ctx context.Context, channel dbgen.Channel, participants []string, authorID, content string) (mentionResult, error) {
	handles := parseMentionHandles(content)
	if len(handles) == 0 {
		return mentionResult{}, nil
	}
	var res mentionResult
	var wantChannel, wantHere, wantNamed bool
	for _, handle := range handles {
		switch handle {
		case channelHandle:
			wantChannel = true
		case hereHandle:
			wantHere = true
		default:
			wantNamed = true
		}
	}
	addressed := map[string]bool{authorID: true}
	if (wantChannel || wantHere) && !isDM(channel) && s.mayNotifyEveryone(ctx, channel) {
		audience, err := s.peopleIn(ctx, channel)
		if err != nil {
			return mentionResult{}, err
		}
		if !wantChannel {
			if s.presence == nil {
				audience = nil
			} else if audience, err = s.presence.OnlineUserIDs(ctx, audience); err != nil {
				return mentionResult{}, fmt.Errorf("list online members: %w", err)
			}
		}
		res.channel, res.here = wantChannel, !wantChannel
		for _, id := range audience {
			if !addressed[id] {
				addressed[id] = true
				res.userIDs = append(res.userIDs, id)
			}
		}
	}
	if !wantNamed {
		return res, nil
	}

	candidates := participants
	if !isDM(channel) {
		rows, err := s.q.ListSpaceMembers(ctx, *channel.SpaceID)
		if err != nil {
			return mentionResult{}, fmt.Errorf("list members: %w", err)
		}
		candidates = make([]string, len(rows))
		for i, row := range rows {
			candidates[i] = row.UserID
		}
	}
	records, err := s.users.GetUsers(ctx, candidates)
	if err != nil {
		return mentionResult{}, fmt.Errorf("resolve members: %w", err)
	}
	byHandle := make(map[string]string, len(records))
	for _, record := range records {
		byHandle[strings.ToLower(record.Username)] = record.ID
	}
	for _, handle := range handles {
		id, ok := byHandle[handle]
		if !ok || id == authorID {
			continue
		}
		res.named = append(res.named, id)
		if !addressed[id] {
			addressed[id] = true
			res.userIDs = append(res.userIDs, id)
		}
	}
	return res, nil
}

// peopleIn is who @channel reaches in a space channel: the people in a
// text channel, or the whole space for a voice channel, which has no
// list of its own.
func (s *Service) peopleIn(ctx context.Context, channel dbgen.Channel) ([]string, error) {
	if hasMembers(channel) {
		ids, err := s.q.ListChannelMemberIDs(ctx, channel.ID)
		if err != nil {
			return nil, fmt.Errorf("list channel members: %w", err)
		}
		return ids, nil
	}
	rows, err := s.q.ListSpaceMembers(ctx, *channel.SpaceID)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}
	ids := make([]string, len(rows))
	for i, row := range rows {
		ids[i] = row.UserID
	}
	return ids, nil
}

// mentionedOutsiders is who a message's named mentions bring into a text
// channel: those not in it yet, less anyone who blocked the author.
func (s *Service) mentionedOutsiders(ctx context.Context, channel dbgen.Channel, authorID string, named []string) ([]string, error) {
	if !hasMembers(channel) || len(named) == 0 {
		return nil, nil
	}
	inside, err := s.q.ChannelMembersAmong(ctx, dbgen.ChannelMembersAmongParams{UserIds: named, ChannelID: channel.ID})
	if err != nil {
		return nil, fmt.Errorf("check channel members: %w", err)
	}
	var outside []string
	for _, id := range named {
		if !slices.Contains(inside, id) {
			outside = append(outside, id)
		}
	}
	return s.withoutBlockers(ctx, authorID, outside)
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
