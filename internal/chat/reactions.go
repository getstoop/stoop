package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/rivo/uniseg"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/Jhut89/stoop/gen/stoop/realtime/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/dbgen"
	"github.com/Jhut89/stoop/internal/events"
)

// maxEmojiBytes bounds a reaction: the longest common emoji (a family or
// flag ZWJ sequence with modifiers) fits comfortably, arbitrary text
// does not.
const maxEmojiBytes = 16

// validateEmoji accepts exactly one grapheme cluster of at most
// maxEmojiBytes, so "👍🏽" and "🇨🇦" pass while "ab" and "👍👍" don't. Skin
// tones and other modifiers make distinct reactions, which is the intent.
func validateEmoji(emoji string) error {
	if emoji == "" || len(emoji) > maxEmojiBytes {
		return connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("emoji must be a single character of at most %d bytes", maxEmojiBytes))
	}
	if uniseg.GraphemeClusterCount(emoji) != 1 {
		return connect.NewError(connect.CodeInvalidArgument,
			errors.New("emoji must be a single character"))
	}
	return nil
}

// ToggleReaction adds the caller's reaction if it's absent and removes it
// if it's present, then broadcasts the message's full reaction list.
// Reactions never create activity and never touch unread state.
func (s *Service) ToggleReaction(ctx context.Context, req *connect.Request[chatv1.ToggleReactionRequest]) (*connect.Response[chatv1.ToggleReactionResponse], error) {
	if err := validateEmoji(req.Msg.Emoji); err != nil {
		return nil, err
	}
	userID := authctx.UserID(ctx)
	msg, err := s.q.GetMessage(ctx, req.Msg.MessageId)
	if err != nil {
		return nil, notFoundOr(err, "message")
	}
	channel, err := s.writableChannel(ctx, msg.ChannelID)
	if err != nil {
		return nil, err
	}

	params := dbgen.AddReactionParams{MessageID: msg.ID, UserID: userID, Emoji: req.Msg.Emoji}
	added, err := s.q.AddReaction(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("add reaction: %w", err)
	}
	if added == 0 {
		if _, err := s.q.RemoveReaction(ctx, dbgen.RemoveReactionParams(params)); err != nil {
			return nil, fmt.Errorf("remove reaction: %w", err)
		}
	}

	out, err := s.loadMessage(ctx, msg, spaceOf(channel))
	if err != nil {
		return nil, err
	}
	s.publishChannel(ctx, channel, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ReactionsChanged{
			ReactionsChanged: &realtimev1.ReactionsChanged{
				SpaceId: spaceOf(channel), ChannelId: channel.ID, MessageId: msg.ID,
				Reactions: out.Reactions,
			},
		},
	}))
	return connect.NewResponse(&chatv1.ToggleReactionResponse{Message: out}), nil
}

// reactionsByMessage loads the grouped reactions for a page of messages
// in one query. Groups come back ordered by emoji, users within a group
// in the order they reacted.
func (s *Service) reactionsByMessage(ctx context.Context, messageIDs []string) (map[string][]*chatv1.Reaction, error) {
	out := map[string][]*chatv1.Reaction{}
	if len(messageIDs) == 0 {
		return out, nil
	}
	rows, err := s.q.ListReactionsForMessages(ctx, messageIDs)
	if err != nil {
		return nil, fmt.Errorf("list reactions: %w", err)
	}
	for _, r := range rows {
		groups := out[r.MessageID]
		if n := len(groups); n > 0 && groups[n-1].Emoji == r.Emoji {
			groups[n-1].UserIds = append(groups[n-1].UserIds, r.UserID)
			continue
		}
		out[r.MessageID] = append(groups, &chatv1.Reaction{Emoji: r.Emoji, UserIds: []string{r.UserID}})
	}
	return out, nil
}

// loadMessage renders one stored message in full — author, mentions,
// reply quote, reactions — for RPCs that return a message they didn't
// just build (edit, toggle reaction).
func (s *Service) loadMessage(ctx context.Context, row dbgen.Message, spaceID string) (*chatv1.Message, error) {
	mentions, err := s.mentionsByMessage(ctx, []string{row.ID})
	if err != nil {
		return nil, err
	}
	reactions, err := s.reactionsByMessage(ctx, []string{row.ID})
	if err != nil {
		return nil, err
	}
	authors, err := s.resolveAuthors(ctx, []string{row.AuthorID})
	if err != nil {
		return nil, err
	}
	attachments, err := s.attachmentsByMessage(ctx, []string{row.ID})
	if err != nil {
		return nil, err
	}
	previews, err := s.linkPreviewsByMessage(ctx, []string{row.ID})
	if err != nil {
		return nil, err
	}
	out := toProtoMessage(row, authors, mentions[row.ID], spaceID)
	out.Reactions = reactions[row.ID]
	out.Attachments = attachments[row.ID]
	out.LinkPreviews = previews[row.ID]
	if row.ReplyToMessageID != nil {
		if parent, err := s.q.GetMessage(ctx, *row.ReplyToMessageID); err == nil {
			pa, _ := s.resolveAuthors(ctx, []string{parent.AuthorID})
			out.ReplyTo = replyRef(parent.ID, pa[parent.AuthorID], &parent.Content, s.firstAttachmentName(ctx, parent.ID))
		} else {
			out.ReplyTo = replyRef(*row.ReplyToMessageID, nil, nil, "")
		}
	}
	return out, nil
}
