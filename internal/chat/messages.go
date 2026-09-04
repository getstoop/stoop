package chat

import (
	"context"
	"errors"
	"fmt"
	"unicode/utf8"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/Jhut89/stoop/gen/stoop/realtime/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/dbgen"
	"github.com/Jhut89/stoop/internal/events"
)

const (
	maxMessageLen   = 4000
	defaultPageSize = 50
	maxPageSize     = 100
)

func (s *Service) SendMessage(ctx context.Context, req *connect.Request[chatv1.SendMessageRequest]) (*connect.Response[chatv1.SendMessageResponse], error) {
	userID := authctx.UserID(ctx)
	content := req.Msg.Content
	// Text is optional when there are attachments; the length cap always
	// applies.
	if (content == "" && len(req.Msg.AttachmentIds) == 0) || utf8.RuneCountInString(content) > maxMessageLen {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("message must be 1-%d characters or carry an attachment", maxMessageLen))
	}
	channel, err := s.writableChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	attachments, err := s.claimAttachments(ctx, userID, spaceOf(channel), req.Msg.AttachmentIds)
	if err != nil {
		return nil, err
	}

	res, err := s.resolveMentions(ctx, channel, userID, content)
	if err != nil {
		return nil, err
	}
	mentioned := res.userIDs

	// A reply must point at a message in this channel.
	var replyTo *string
	var parent *dbgen.Message
	if id := req.Msg.ReplyToMessageId; id != "" {
		p, err := s.q.GetMessage(ctx, id)
		if err != nil {
			return nil, notFoundOr(err, "message")
		}
		if p.ChannelID != channel.ID {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				errors.New("can only reply to a message in the same channel"))
		}
		parent, replyTo = &p, &p.ID
	}

	// The message and its attachment links land together: a claim that
	// fails (file already used) must not leave a bare message behind.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)
	row, err := qtx.CreateMessage(ctx, dbgen.CreateMessageParams{
		ID: newID(), ChannelID: channel.ID, AuthorID: userID, Content: content,
		MentionsEveryone: res.everyone, MentionsHere: res.here, ReplyToMessageID: replyTo,
	})
	if err != nil {
		return nil, fmt.Errorf("create message: %w", err)
	}
	if err := insertAttachments(ctx, qtx, row.ID, attachments); err != nil {
		return nil, err
	}
	var linksToFetch []string
	if s.unfurler != nil {
		if linksToFetch, err = s.recordLinks(ctx, qtx, row.ID, extractLinks(content)); err != nil {
			return nil, fmt.Errorf("record links: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	for _, id := range mentioned {
		if err := s.q.InsertMessageMention(ctx, dbgen.InsertMessageMentionParams{MessageID: row.ID, UserID: id}); err != nil {
			return nil, fmt.Errorf("record mention: %w", err)
		}
	}
	// The channel's newest message, and the author has of course read it.
	if err := s.q.SetChannelLastMessage(ctx, dbgen.SetChannelLastMessageParams{ID: channel.ID, LastMessageID: &row.ID}); err != nil {
		return nil, fmt.Errorf("bump channel: %w", err)
	}
	if err := s.q.UpsertChannelRead(ctx, dbgen.UpsertChannelReadParams{
		UserID: userID, ChannelID: channel.ID, LastReadMessageID: row.ID,
	}); err != nil {
		return nil, fmt.Errorf("mark own message read: %w", err)
	}

	authorIDs := []string{userID}
	if parent != nil {
		authorIDs = append(authorIDs, parent.AuthorID)
	}
	authors, err := s.resolveAuthors(ctx, authorIDs)
	if err != nil {
		return nil, err
	}
	msg := toProtoMessage(row, authors, mentioned, spaceOf(channel))
	msg.Attachments = toProtoAttachments(attachments)
	if parent != nil {
		msg.ReplyTo = replyRef(parent.ID, authors[parent.AuthorID], &parent.Content, s.firstAttachmentName(ctx, parent.ID))
	}
	var firstAttachment string
	if len(attachments) > 0 {
		firstAttachment = attachments[0].Name
	}
	if err := s.recordMentions(ctx, row, channel.SpaceID, mentioned, msg.Author, firstAttachment); err != nil {
		return nil, err
	}
	if parent != nil {
		if err := s.recordReply(ctx, row, channel.SpaceID, parent.AuthorID, mentioned, msg.Author, firstAttachment); err != nil {
			return nil, err
		}
	}
	if isDM(channel) {
		if err := s.recordDM(ctx, row, channel, parent, mentioned, msg.Author, firstAttachment); err != nil {
			return nil, err
		}
	}

	// Cached link previews go out with the message itself; ones still to
	// be fetched arrive later as MessageUpdated.
	if s.unfurler != nil {
		if previews, err := s.linkPreviewsByMessage(ctx, []string{row.ID}); err == nil {
			msg.LinkPreviews = previews[row.ID]
		}
	}
	// Everyone who can see the channel receives the event; clients filter
	// by channel_id. The sender's own client receives it too — one code path.
	s.publishChannel(ctx, channel, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageCreated{MessageCreated: msg},
	}))
	if s.unfurler != nil {
		s.unfurlLater(row.ID, userID, channel.ID, linksToFetch)
	}

	return connect.NewResponse(&chatv1.SendMessageResponse{Message: msg}), nil
}

func (s *Service) ListMessages(ctx context.Context, req *connect.Request[chatv1.ListMessagesRequest]) (*connect.Response[chatv1.ListMessagesResponse], error) {
	channel, err := s.accessChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}

	limit := req.Msg.Limit
	if limit <= 0 {
		limit = defaultPageSize
	} else if limit > maxPageSize {
		limit = maxPageSize
	}

	var (
		rows               []dbgen.ListMessagesBeforeRow
		hasOlder, hasNewer bool
	)
	switch {
	case req.Msg.BeforeId != "" && req.Msg.AfterId != "",
		req.Msg.AroundId != "" && (req.Msg.BeforeId != "" || req.Msg.AfterId != ""):
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("before_id, after_id and around_id are mutually exclusive"))

	case req.Msg.AfterId != "":
		// Forward paging: the oldest `limit` messages newer than after_id.
		after, err := s.q.ListMessagesAfter(ctx, dbgen.ListMessagesAfterParams{
			ChannelID: req.Msg.ChannelId, AfterID: req.Msg.AfterId, Limit: limit,
		})
		if err != nil {
			return nil, fmt.Errorf("list messages: %w", err)
		}
		rows = newestFirst(after)
		hasOlder, hasNewer = true, int32(len(after)) == limit

	case req.Msg.AroundId != "":
		// A window centred on one message, which must be in this channel.
		target, err := s.q.GetMessage(ctx, req.Msg.AroundId)
		if err != nil || target.ChannelID != req.Msg.ChannelId {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("message not found"))
		}
		older := limit / 2
		newer := limit - older // includes the target itself
		before, err := s.q.ListMessagesBefore(ctx, dbgen.ListMessagesBeforeParams{
			ChannelID: req.Msg.ChannelId, BeforeID: &req.Msg.AroundId, Limit: older,
		})
		if err != nil {
			return nil, fmt.Errorf("list messages: %w", err)
		}
		after, err := s.q.ListMessagesAfter(ctx, dbgen.ListMessagesAfterParams{
			ChannelID: req.Msg.ChannelId, AfterID: req.Msg.AroundId, Inclusive: true, Limit: newer,
		})
		if err != nil {
			return nil, fmt.Errorf("list messages: %w", err)
		}
		rows = append(newestFirst(after), before...)
		hasOlder, hasNewer = int32(len(before)) == older, int32(len(after)) == newer

	default:
		var before *string
		if req.Msg.BeforeId != "" {
			before = &req.Msg.BeforeId
		}
		var err error
		rows, err = s.q.ListMessagesBefore(ctx, dbgen.ListMessagesBeforeParams{
			ChannelID: req.Msg.ChannelId, BeforeID: before, Limit: limit,
		})
		if err != nil {
			return nil, fmt.Errorf("list messages: %w", err)
		}
		hasOlder, hasNewer = int32(len(rows)) == limit, before != nil
	}

	messages, err := s.hydrateMessages(ctx, spaceOf(channel), rows)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.ListMessagesResponse{
		Messages: messages, HasOlder: hasOlder, HasNewer: hasNewer,
	}), nil
}

// newestFirst flips an ascending forward page into the newest-first order the
// hydrator expects. The two sqlc row types are structurally identical.
func newestFirst(asc []dbgen.ListMessagesAfterRow) []dbgen.ListMessagesBeforeRow {
	out := make([]dbgen.ListMessagesBeforeRow, len(asc))
	for i, r := range asc {
		out[len(asc)-1-i] = dbgen.ListMessagesBeforeRow(r)
	}
	return out
}

// hydrateMessages turns newest-first rows into oldest-first protos with
// authors, mentions, reactions, attachments, link previews and reply quotes.
func (s *Service) hydrateMessages(ctx context.Context, spaceID string, rows []dbgen.ListMessagesBeforeRow) ([]*chatv1.Message, error) {
	authorIDs := make([]string, 0, len(rows))
	seen := map[string]bool{}
	for _, r := range rows {
		for _, id := range []*string{&r.Message.AuthorID, r.ReplyAuthorID} {
			if id != nil && *id != "" && !seen[*id] {
				seen[*id] = true
				authorIDs = append(authorIDs, *id)
			}
		}
	}
	authors, err := s.resolveAuthors(ctx, authorIDs)
	if err != nil {
		return nil, err
	}
	messageIDs := make([]string, len(rows))
	for i, r := range rows {
		messageIDs[i] = r.Message.ID
	}
	mentions, err := s.mentionsByMessage(ctx, messageIDs)
	if err != nil {
		return nil, err
	}
	reactions, err := s.reactionsByMessage(ctx, messageIDs)
	if err != nil {
		return nil, err
	}
	attachments, err := s.attachmentsByMessage(ctx, messageIDs)
	if err != nil {
		return nil, err
	}
	previews, err := s.linkPreviewsByMessage(ctx, messageIDs)
	if err != nil {
		return nil, err
	}
	// Quoted messages without text preview as their first attachment.
	var replyFileIDs []string
	for _, r := range rows {
		if r.ReplyFirstFileID != "" {
			replyFileIDs = append(replyFileIDs, r.ReplyFirstFileID)
		}
	}
	replyFiles, err := s.fileRecords(ctx, replyFileIDs)
	if err != nil {
		return nil, err
	}

	// Rows come newest-first; return oldest-first for rendering.
	messages := make([]*chatv1.Message, len(rows))
	for i, r := range rows {
		m := toProtoMessage(r.Message, authors, mentions[r.Message.ID], spaceID)
		m.Reactions = reactions[r.Message.ID]
		m.Attachments = attachments[r.Message.ID]
		m.LinkPreviews = previews[r.Message.ID]
		if r.Message.ReplyToMessageID != nil {
			var author *chatv1.MessageAuthor
			if r.ReplyAuthorID != nil {
				author = authors[*r.ReplyAuthorID]
			}
			m.ReplyTo = replyRef(*r.Message.ReplyToMessageID, author, r.ReplyContent, replyFiles[r.ReplyFirstFileID].Name)
		}
		messages[len(rows)-1-i] = m
	}
	return messages, nil
}

func (s *Service) EditMessage(ctx context.Context, req *connect.Request[chatv1.EditMessageRequest]) (*connect.Response[chatv1.EditMessageResponse], error) {
	content := req.Msg.Content
	if content == "" || utf8.RuneCountInString(content) > maxMessageLen {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("message must be 1-%d characters", maxMessageLen))
	}
	msg, err := s.q.GetMessage(ctx, req.Msg.MessageId)
	if err != nil {
		return nil, notFoundOr(err, "message")
	}
	if msg.AuthorID != authctx.UserID(ctx) {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("you can only edit your own messages"))
	}
	// Authorship is not enough: a kicked, banned or blocked author is
	// still the author, and an edit republishes the message and unfurls
	// its links.
	channel, err := s.writableChannel(ctx, msg.ChannelID)
	if err != nil {
		return nil, err
	}
	row, err := s.q.UpdateMessageContent(ctx, dbgen.UpdateMessageContentParams{ID: msg.ID, Content: content})
	if err != nil {
		return nil, fmt.Errorf("edit message: %w", err)
	}
	// Mentions are not re-resolved on edit: no new activity, and the
	// original recipients stay recorded. Links are: the previews follow
	// the text.
	var linksToFetch []string
	if s.unfurler != nil {
		if linksToFetch, err = s.recordLinks(ctx, s.q, row.ID, extractLinks(content)); err != nil {
			return nil, fmt.Errorf("record links: %w", err)
		}
	}
	out, err := s.loadMessage(ctx, row, spaceOf(channel))
	if err != nil {
		return nil, err
	}
	s.publishChannel(ctx, channel, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageUpdated{MessageUpdated: out},
	}))
	if s.unfurler != nil {
		s.unfurlLater(row.ID, msg.AuthorID, channel.ID, linksToFetch)
	}
	return connect.NewResponse(&chatv1.EditMessageResponse{Message: out}), nil
}

func (s *Service) DeleteMessage(ctx context.Context, req *connect.Request[chatv1.DeleteMessageRequest]) (*connect.Response[chatv1.DeleteMessageResponse], error) {
	msg, err := s.q.GetMessage(ctx, req.Msg.MessageId)
	if err != nil {
		return nil, notFoundOr(err, "message")
	}
	channel, err := s.q.GetChannel(ctx, msg.ChannelID)
	if err != nil {
		return nil, notFoundOr(err, "channel")
	}
	if msg.AuthorID != authctx.UserID(ctx) {
		// In a DM there is no moderator: each person deletes only their own.
		if isDM(channel) {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("you can only delete your own messages"))
		}
		if err := s.requirePermission(ctx, *channel.SpaceID, PermDeleteAnyMessage); err != nil {
			return nil, err
		}
	} else if err := s.requireChannelMember(ctx, channel.ID); err != nil {
		return nil, err
	}
	// The link rows cascade with the message; the files themselves are
	// deleted through the port afterwards.
	fileIDs, err := s.q.ListAttachmentFileIDsForMessage(ctx, msg.ID)
	if err != nil {
		return nil, fmt.Errorf("list attachments: %w", err)
	}
	if err := s.q.DeleteMessage(ctx, msg.ID); err != nil {
		return nil, fmt.Errorf("delete message: %w", err)
	}
	if err := s.q.RecomputeChannelLastMessage(ctx, channel.ID); err != nil {
		return nil, fmt.Errorf("recompute channel: %w", err)
	}
	s.deleteMessageFiles(ctx, fileIDs)
	s.publishChannel(ctx, channel, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageDeleted{
			MessageDeleted: &realtimev1.MessageDeleted{
				MessageId: msg.ID, ChannelId: channel.ID, SpaceId: spaceOf(channel),
			},
		},
	}))
	return connect.NewResponse(&chatv1.DeleteMessageResponse{}), nil
}

// replyRef builds the quote snapshot; a deleted original leaves only the
// ID. firstAttachment names the original's first file, the preview when
// it has no text.
func replyRef(id string, author *chatv1.MessageAuthor, content *string, firstAttachment string) *chatv1.ReplyRef {
	ref := &chatv1.ReplyRef{MessageId: id, Author: author}
	if content != nil {
		ref.Preview = truncate(previewText(*content, firstAttachment), previewLen)
	}
	return ref
}

// firstAttachmentName resolves a message's first attachment name for a
// preview; "" when it has none (or the port isn't wired).
func (s *Service) firstAttachmentName(ctx context.Context, messageID string) string {
	ids, err := s.q.ListAttachmentFileIDsForMessage(ctx, messageID)
	if err != nil || len(ids) == 0 {
		return ""
	}
	records, err := s.fileRecords(ctx, ids[:1])
	if err != nil {
		return ""
	}
	return records[ids[0]].Name
}

func toProtoMessage(m dbgen.Message, authors map[string]*chatv1.MessageAuthor, mentions []string, spaceID string) *chatv1.Message {
	author := authors[m.AuthorID]
	if author == nil {
		author = &chatv1.MessageAuthor{Id: m.AuthorID, Username: "unknown"}
	}
	out := &chatv1.Message{
		Id: m.ID, ChannelId: m.ChannelID, Author: author,
		Content: m.Content, CreatedAt: timestamppb.New(m.CreatedAt),
		MentionUserIds: mentions, SpaceId: spaceID,
		MentionsEveryone: m.MentionsEveryone, MentionsHere: m.MentionsHere,
	}
	if m.EditedAt != nil {
		out.EditedAt = timestamppb.New(*m.EditedAt)
	}
	return out
}
