package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/pbtime"
	"github.com/getstoop/stoop/internal/rowid"
	"github.com/getstoop/stoop/internal/text"
)

const (
	maxMessageLen   = 4000
	defaultPageSize = 50
	maxPageSize     = 100
)

// clampPageSize is the requested page size, or fallback when it is zero or
// negative, and never more than maximum.
func clampPageSize(requested, fallback, maximum int32) int32 {
	if requested <= 0 {
		return fallback
	}
	return min(requested, maximum)
}

func (s *Service) SendMessage(ctx context.Context, req *connect.Request[chatv1.SendMessageRequest]) (*connect.Response[chatv1.SendMessageResponse], error) {
	userID := authctx.UserID(ctx)
	content := req.Msg.Content
	// Text is optional when there are attachments; the length cap always
	// applies.
	if (content == "" && len(req.Msg.AttachmentIds) == 0) || utf8.RuneCountInString(content) > maxMessageLen {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("message must be 1-%d characters or carry an attachment", maxMessageLen))
	}
	channel, participants, err := s.writableChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	alsoSend := req.Msg.AlsoSendToChannel
	if alsoSend && req.Msg.ThreadRootId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("also_send_to_channel needs thread_root_id"))
	}
	var threadRoot *messageRow
	if rootID := req.Msg.ThreadRootId; rootID != "" {
		root, err := s.threadRootFor(ctx, channel, rootID)
		if err != nil {
			return nil, err
		}
		threadRoot = &root
	}
	if err := s.requirePostPolicy(ctx, channel); err != nil {
		return nil, err
	}
	attachments, err := s.claimAttachments(ctx, userID, spaceOf(channel), req.Msg.AttachmentIds)
	if err != nil {
		return nil, err
	}

	res, err := s.resolveMentions(ctx, channel, participants, userID, content)
	if err != nil {
		return nil, err
	}
	mentioned := res.userIDs
	// Someone mentioned by name who is not in the channel joins it with
	// the message, so the channel and its badge reach them together.
	brought, err := s.mentionedOutsiders(ctx, channel, userID, res.named)
	if err != nil {
		return nil, err
	}

	// A reply must point at a message in this channel, and in the same
	// thread or the same timeline.
	var replyTo *string
	var parent *messageRow
	if replyID := req.Msg.ReplyToMessageId; replyID != "" {
		found, err := s.q.GetMessage(ctx, replyID)
		if err != nil {
			return nil, apierr.NotFoundOr(err, "message")
		}
		if found.ChannelID != channel.ID {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				errors.New("can only reply to a message in the same channel"))
		}
		if err := checkQuote(found, threadRoot); err != nil {
			return nil, err
		}
		parent, replyTo = &found, &found.ID
	}

	// Read before anything is written: the event needs the authors.
	authorIDs := []string{userID}
	if parent != nil {
		authorIDs = append(authorIDs, parent.AuthorID)
	}
	if alsoSend {
		authorIDs = append(authorIDs, threadRoot.AuthorID)
	}
	authors, err := s.resolveAuthors(ctx, authorIDs)
	if err != nil {
		return nil, err
	}

	// Everything that belongs to the message lands together: a claim that
	// fails (file already used) must not leave a bare message behind.
	var row messageRow
	var linksToFetch []string
	var thread dbgen.Thread
	var threadMarker string
	var threadRootID *string
	if threadRoot != nil {
		threadRootID = &threadRoot.ID
	}
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		created, err := qtx.CreateMessage(ctx, dbgen.CreateMessageParams{
			ID: rowid.New(), ChannelID: channel.ID, AuthorID: userID, Content: content,
			MentionsChannel: res.channel, MentionsHere: res.here, ReplyToMessageID: replyTo,
			ThreadRootID: threadRootID, InChannel: threadRoot == nil || alsoSend,
		})
		if err != nil {
			return fmt.Errorf("create message: %w", err)
		}
		row = messageRow(created)
		// Their marker stops at what was newest before this message, so
		// it arrives unread.
		if brought, err = addMembers(ctx, qtx, channel, brought, &userID, channel.LastMessageID); err != nil {
			return fmt.Errorf("bring in mentioned people: %w", err)
		}
		if err := insertAttachments(ctx, qtx, row.ID, attachments); err != nil {
			return err
		}
		if s.unfurler != nil {
			if linksToFetch, err = s.recordLinks(ctx, qtx, row.ID, extractLinks(content)); err != nil {
				return fmt.Errorf("record links: %w", err)
			}
		}
		if len(mentioned) > 0 {
			if err := qtx.InsertMessageMentions(ctx, dbgen.InsertMessageMentionsParams{MessageID: row.ID, UserIds: mentioned}); err != nil {
				return fmt.Errorf("record mention: %w", err)
			}
		}
		// A thread reply leaves the channel's newest message and the
		// author's channel read marker alone: neither is about the thread,
		// unless it is also sent to the channel. The author has read the
		// thread up to their own reply.
		if threadRoot != nil {
			if thread, err = qtx.RecordThreadReply(ctx, dbgen.RecordThreadReplyParams{
				RootID: threadRoot.ID, ReplyID: &row.ID, ReplyAt: &row.CreatedAt, AuthorID: userID,
			}); err != nil {
				return fmt.Errorf("record thread reply: %w", err)
			}
			if threadMarker, err = qtx.MarkThreadRead(ctx, dbgen.MarkThreadReadParams{
				UserID: userID, RootMessageID: threadRoot.ID, LastReadMessageID: row.ID,
			}); err != nil {
				return fmt.Errorf("mark thread read: %w", err)
			}
			if !alsoSend {
				return nil
			}
		}
		// The channel's newest message, and the author has of course read it.
		if err := qtx.SetChannelLastMessage(ctx, dbgen.SetChannelLastMessageParams{ID: channel.ID, LastMessageID: &row.ID}); err != nil {
			return fmt.Errorf("bump channel: %w", err)
		}
		if err := qtx.UpsertChannelRead(ctx, dbgen.UpsertChannelReadParams{
			UserID: userID, ChannelID: channel.ID, LastReadMessageID: row.ID,
		}); err != nil {
			return fmt.Errorf("mark own message read: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// The message is saved: from here on nothing fails the send.
	msg := toProtoMessage(row, authors, mentioned, spaceOf(channel))
	msg.Attachments = toProtoAttachments(attachments)
	if parent != nil {
		msg.ReplyTo = replyRef(parent.ID, authors[parent.AuthorID], &parent.Content, s.firstAttachmentName(ctx, parent.ID))
	}
	if alsoSend {
		roots := map[string]dbgen.ThreadRootRefsRow{threadRoot.ID: {
			ID: threadRoot.ID, AuthorID: threadRoot.AuthorID, Content: threadRoot.Content,
		}}
		msg.ThreadRoot = s.threadRootRef(ctx, threadRoot.ID, roots, authors)
	}
	// Cached link previews go out with the message itself; ones still to
	// be fetched arrive later as MessageUpdated.
	if s.unfurler != nil {
		if previews, err := s.linkPreviewsByMessage(ctx, []string{row.ID}); err == nil {
			msg.LinkPreviews = previews[row.ID]
		}
	}
	if isDM(channel) {
		s.reopenDM(ctx, channel)
	}
	// Everyone who can see the channel receives the event; clients filter
	// by channel_id. The sender's own client receives it too — one code path.
	s.publishTo(channel, participants, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageCreated{MessageCreated: msg},
	}))
	if threadRoot != nil {
		if ev := s.threadChanged(ctx, channel, threadRoot.ID, &thread); ev != nil {
			s.publishTo(channel, participants, ev)
		}
		s.publishThreadRead(userID, channel, threadRoot.ID, threadMarker)
	}
	s.publishChannelJoined(channel, brought)
	s.recordActivity(ctx, row, channel, participants, parent, mentioned, msg.Author, attachments)
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
	if err := requireChannelAction(ctx, channel, authctx.MessagesRead, authctx.DMsRead); err != nil {
		return nil, err
	}

	limit := clampPageSize(req.Msg.Limit, defaultPageSize, maxPageSize)
	page, err := s.pagerFor(ctx, channel, req.Msg.ThreadId)
	if err != nil {
		return nil, err
	}

	var (
		rows               []dbgen.MessageWithReply
		hasOlder, hasNewer bool
		openThread         string
	)
	switch {
	case req.Msg.BeforeId != "" && req.Msg.AfterId != "",
		req.Msg.AroundId != "" && (req.Msg.BeforeId != "" || req.Msg.AfterId != ""):
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("before_id, after_id and around_id are mutually exclusive"))

	case req.Msg.AfterId != "":
		// Forward paging: the oldest `limit` messages newer than after_id.
		after, err := page.after(req.Msg.AfterId, false, limit)
		if err != nil {
			return nil, fmt.Errorf("list messages: %w", err)
		}
		rows = after
		hasOlder, hasNewer = true, int32(len(after)) == limit

	case req.Msg.AroundId != "":
		// A window centred on one message, which must be in this channel
		// (or this thread). A reply that shows only in its thread centres
		// the channel on its root and names the thread to open.
		target, err := s.q.GetMessage(ctx, req.Msg.AroundId)
		centre := req.Msg.AroundId
		switch {
		case err != nil || target.ChannelID != req.Msg.ChannelId:
			return nil, connect.NewError(connect.CodeNotFound, errors.New("message not found"))
		case page.holds(target):
		case req.Msg.ThreadId == "" && target.ThreadRootID != nil:
			openThread = *target.ThreadRootID
			centre = openThread
		default:
			return nil, connect.NewError(connect.CodeNotFound, errors.New("message not found"))
		}
		older := limit / 2
		newer := limit - older // includes the target itself
		before, err := page.before(&centre, older)
		if err != nil {
			return nil, fmt.Errorf("list messages: %w", err)
		}
		after, err := page.after(centre, true, newer)
		if err != nil {
			return nil, fmt.Errorf("list messages: %w", err)
		}
		slices.Reverse(before)
		rows = append(before, after...)
		hasOlder, hasNewer = int32(len(before)) == older, int32(len(after)) == newer

	default:
		var before *string
		if req.Msg.BeforeId != "" {
			before = &req.Msg.BeforeId
		}
		var err error
		rows, err = page.before(before, limit)
		if err != nil {
			return nil, fmt.Errorf("list messages: %w", err)
		}
		hasOlder, hasNewer = int32(len(rows)) == limit, before != nil
		slices.Reverse(rows)
	}

	messages, err := s.hydrateMessages(ctx, spaceOf(channel), rows)
	if err != nil {
		return nil, err
	}
	if err := s.addThreadViewerStates(ctx, messages); err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.ListMessagesResponse{
		Messages: messages, HasOlder: hasOlder, HasNewer: hasNewer, ThreadRootId: openThread,
	}), nil
}

// pager pages one timeline: a channel's, or one thread's replies.
type pager struct {
	before func(beforeID *string, limit int32) ([]dbgen.MessageWithReply, error)
	after  func(afterID string, inclusive bool, limit int32) ([]dbgen.MessageWithReply, error)
	holds  func(messageRow) bool
}

// pagerFor is the channel's timeline, or the thread under rootID when it
// is set; a root that is not a top-level message in the channel is
// NotFound, like a message that does not exist.
func (s *Service) pagerFor(ctx context.Context, channel dbgen.Channel, rootID string) (pager, error) {
	if rootID == "" {
		return pager{
			before: func(beforeID *string, limit int32) ([]dbgen.MessageWithReply, error) {
				return s.q.ListMessagesBefore(ctx, dbgen.ListMessagesBeforeParams{ChannelID: channel.ID, BeforeID: beforeID, Limit: limit})
			},
			after: func(afterID string, inclusive bool, limit int32) ([]dbgen.MessageWithReply, error) {
				return s.q.ListMessagesAfter(ctx, dbgen.ListMessagesAfterParams{ChannelID: channel.ID, AfterID: afterID, Inclusive: inclusive, Limit: limit})
			},
			holds: func(m messageRow) bool { return m.InChannel },
		}, nil
	}
	root, err := s.q.GetMessage(ctx, rootID)
	if err != nil || root.ChannelID != channel.ID || root.ThreadRootID != nil {
		return pager{}, connect.NewError(connect.CodeNotFound, errors.New("thread not found"))
	}
	return pager{
		before: func(beforeID *string, limit int32) ([]dbgen.MessageWithReply, error) {
			return s.q.ListThreadBefore(ctx, dbgen.ListThreadBeforeParams{RootID: root.ID, BeforeID: beforeID, Limit: limit})
		},
		after: func(afterID string, inclusive bool, limit int32) ([]dbgen.MessageWithReply, error) {
			return s.q.ListThreadAfter(ctx, dbgen.ListThreadAfterParams{RootID: root.ID, AfterID: afterID, Inclusive: inclusive, Limit: limit})
		},
		holds: func(m messageRow) bool { return m.ThreadRootID != nil && *m.ThreadRootID == root.ID },
	}, nil
}

// messageRow is a messages row without its search vector, which the
// queries leave out (queries/chat/messages.sql). The other queries' row
// types convert to it.
type messageRow = dbgen.GetMessageRow

// listedMessage is the message in a list row, without the reply columns.
func listedMessage(row dbgen.MessageWithReply) messageRow {
	return messageRow{
		ID: row.ID, ChannelID: row.ChannelID, AuthorID: row.AuthorID, Content: row.Content,
		CreatedAt: row.CreatedAt, MentionsEveryone: row.MentionsEveryone,
		ReplyToMessageID: row.ReplyToMessageID, MentionsHere: row.MentionsHere, EditedAt: row.EditedAt,
		ThreadRootID: row.ThreadRootID, InChannel: row.InChannel, DeletedAt: row.DeletedAt,
		MentionsChannel: row.MentionsChannel,
	}
}

// hydrateMessages turns rows into protos, in the same order, with authors,
// mentions, reactions, attachments, link previews, reply quotes and
// thread summaries.
func (s *Service) hydrateMessages(ctx context.Context, spaceID string, rows []dbgen.MessageWithReply) ([]*chatv1.Message, error) {
	authorIDs := make([]string, 0, len(rows))
	seen := map[string]bool{}
	addAuthor := func(id string) {
		if id != "" && !seen[id] {
			seen[id] = true
			authorIDs = append(authorIDs, id)
		}
	}
	for _, row := range rows {
		addAuthor(row.AuthorID)
		if row.ReplyAuthorID != nil {
			addAuthor(*row.ReplyAuthorID)
		}
		for _, id := range row.ThreadRecentAuthorIds {
			addAuthor(id)
		}
	}
	roots, err := s.threadRootsOf(ctx, rows)
	if err != nil {
		return nil, err
	}
	for _, root := range roots {
		if root.DeletedAt == nil {
			addAuthor(root.AuthorID)
		}
	}
	authors, err := s.resolveAuthors(ctx, authorIDs)
	if err != nil {
		return nil, err
	}
	messageIDs := make([]string, len(rows))
	for index, row := range rows {
		messageIDs[index] = row.ID
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
	pinned, err := s.pinnedByMessage(ctx, messageIDs)
	if err != nil {
		return nil, err
	}
	// Quoted messages without text preview as their first attachment.
	var replyFileIDs []string
	for _, row := range rows {
		if row.ReplyFirstFileID != "" {
			replyFileIDs = append(replyFileIDs, row.ReplyFirstFileID)
		}
	}
	replyFiles, err := s.fileRecords(ctx, replyFileIDs)
	if err != nil {
		return nil, err
	}

	messages := make([]*chatv1.Message, len(rows))
	rootRefs := map[string]*chatv1.ReplyRef{}
	for index, row := range rows {
		message := toProtoMessage(listedMessage(row), authors, mentions[row.ID], spaceID)
		message.Reactions = reactions[row.ID]
		message.Attachments = attachments[row.ID]
		message.LinkPreviews = previews[row.ID]
		message.Pinned = pinned[row.ID]
		message.Thread = toProtoThread(row.ThreadReplyCount, row.ThreadLastReplyAt, row.ThreadRecentAuthorIds, authors)
		if row.InChannel && row.ThreadRootID != nil {
			ref, ok := rootRefs[*row.ThreadRootID]
			if !ok { // once per root, however many of its replies the page holds
				ref = s.threadRootRef(ctx, *row.ThreadRootID, roots, authors)
				rootRefs[*row.ThreadRootID] = ref
			}
			message.ThreadRoot = ref
		}
		if row.ReplyToMessageID != nil {
			var author *chatv1.MessageAuthor
			if row.ReplyAuthorID != nil {
				author = authors[*row.ReplyAuthorID]
			}
			message.ReplyTo = replyRef(*row.ReplyToMessageID, author, row.ReplyContent, replyFiles[row.ReplyFirstFileID].label())
		}
		messages[index] = message
	}
	return messages, nil
}

// loadMessage reads one message and hydrates it, for the events that resend
// a message after it changes.
func (s *Service) loadMessage(ctx context.Context, messageID, spaceID string) (*chatv1.Message, error) {
	row, err := s.q.GetMessageWithReply(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("load message: %w", err)
	}
	messages, err := s.hydrateMessages(ctx, spaceID, []dbgen.MessageWithReply{row})
	if err != nil {
		return nil, err
	}
	return messages[0], nil
}

func (s *Service) EditMessage(ctx context.Context, req *connect.Request[chatv1.EditMessageRequest]) (*connect.Response[chatv1.EditMessageResponse], error) {
	content := req.Msg.Content
	if content == "" || utf8.RuneCountInString(content) > maxMessageLen {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("message must be 1-%d characters", maxMessageLen))
	}
	msg, err := s.q.GetMessage(ctx, req.Msg.MessageId)
	if err != nil {
		return nil, apierr.NotFoundOr(err, "message")
	}
	if msg.DeletedAt != nil {
		return nil, placeholderError()
	}
	if msg.AuthorID != authctx.UserID(ctx) {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("you can only edit your own messages"))
	}
	// Authorship is not enough: a kicked, banned or blocked author is
	// still the author, and an edit republishes the message and unfurls
	// its links.
	channel, participants, err := s.writableChannel(ctx, msg.ChannelID)
	if err != nil {
		return nil, err
	}
	// Editing is posting again: a member's old message in what is now an
	// announcement channel stays as it was, though they may delete it.
	if err := s.requirePostPolicy(ctx, channel); err != nil {
		return nil, err
	}
	// Mentions are not re-resolved on edit: no new activity, and the
	// original recipients stay recorded. Links are: the previews follow
	// the text, and land with it.
	var linksToFetch []string
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		if _, err := qtx.UpdateMessageContent(ctx, dbgen.UpdateMessageContentParams{ID: msg.ID, Content: content}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return placeholderError()
			}
			return fmt.Errorf("edit message: %w", err)
		}
		if s.unfurler != nil {
			if linksToFetch, err = s.recordLinks(ctx, qtx, msg.ID, extractLinks(content)); err != nil {
				return fmt.Errorf("record links: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	// The edit is saved: a failed reload answers with no message and
	// sends no event, rather than reporting the save as failed.
	out, err := s.loadMessage(ctx, msg.ID, spaceOf(channel))
	if err != nil {
		slog.Default().Warn("edit: could not reload message", "message_id", msg.ID, "err", err)
	} else {
		s.publishTo(channel, participants, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_MessageUpdated{MessageUpdated: out},
		}))
	}
	if s.unfurler != nil {
		s.unfurlLater(msg.ID, msg.AuthorID, channel.ID, linksToFetch)
	}
	return connect.NewResponse(&chatv1.EditMessageResponse{Message: out}), nil
}

func (s *Service) DeleteMessage(ctx context.Context, req *connect.Request[chatv1.DeleteMessageRequest]) (*connect.Response[chatv1.DeleteMessageResponse], error) {
	msg, err := s.q.GetMessage(ctx, req.Msg.MessageId)
	if err != nil {
		return nil, apierr.NotFoundOr(err, "message")
	}
	channel, err := s.q.GetChannel(ctx, msg.ChannelID)
	if err != nil {
		return nil, apierr.NotFoundOr(err, "channel")
	}
	if msg.AuthorID != authctx.UserID(ctx) {
		// In a DM there is no moderator: each person deletes only their own.
		if isDM(channel) {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("you can only delete your own messages"))
		}
		if err := s.requirePermission(ctx, *channel.SpaceID, authctx.MessagesModerate); err != nil {
			return nil, err
		}
	} else if err := requireChannelAction(ctx, channel, authctx.MessagesPost, authctx.DMsPost); err != nil {
		return nil, err
	} else if err := s.requireChannelMember(ctx, channel.ID); err != nil {
		return nil, err
	}
	switch {
	case msg.DeletedAt != nil:
		// Already a placeholder: it goes with its last reply.
	case msg.ThreadRootID != nil:
		err = s.deleteThreadReply(ctx, msg, channel)
	default:
		err = s.deleteTopLevel(ctx, msg, channel)
	}
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.DeleteMessageResponse{}), nil
}

// replyRef builds the quote snapshot; a deleted original leaves only the
// ID. firstAttachment names the original's first file, the preview when
// it has no text.
func replyRef(id string, author *chatv1.MessageAuthor, content *string, firstAttachment string) *chatv1.ReplyRef {
	ref := &chatv1.ReplyRef{MessageId: id, Author: author}
	if content != nil {
		ref.Preview = text.Truncate(previewText(*content, firstAttachment), previewLen)
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
	return records[ids[0]].label()
}

func toProtoMessage(row messageRow, authors map[string]*chatv1.MessageAuthor, mentions []string, spaceID string) *chatv1.Message {
	out := &chatv1.Message{
		Id: row.ID, ChannelId: row.ChannelID, Author: authorOrUnknown(authors, row.AuthorID),
		Content: row.Content, CreatedAt: timestamppb.New(row.CreatedAt),
		MentionUserIds: mentions, SpaceId: spaceID,
		MentionsEveryone: row.MentionsEveryone, MentionsHere: row.MentionsHere, MentionsChannel: row.MentionsChannel,
		InChannel: row.InChannel, Deleted: row.DeletedAt != nil,
	}
	if row.ThreadRootID != nil {
		out.ThreadRootId = *row.ThreadRootID
	}
	out.EditedAt = pbtime.OrNil(row.EditedAt)
	return out
}
