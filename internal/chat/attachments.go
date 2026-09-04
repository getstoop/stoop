package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgconn"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	"github.com/Jhut89/stoop/internal/dbgen"
)

const (
	maxAttachments = 10
	fileKindAttach = "attachment"
)

// claimAttachments checks that every id names a pending attachment the
// caller uploaded for this space. "Already used by another message" is
// left to the UNIQUE constraint on insert (see insertAttachments).
func (s *Service) claimAttachments(ctx context.Context, userID, spaceID string, ids []string) ([]FileRecord, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	if len(ids) > maxAttachments {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("at most %d attachments per message", maxAttachments))
	}
	if s.files == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("attachments are not available"))
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if seen[id] {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("duplicate attachment"))
		}
		seen[id] = true
	}
	records, err := s.files.GetFiles(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("look up attachments: %w", err)
	}
	byID := make(map[string]FileRecord, len(records))
	for _, r := range records {
		byID[r.ID] = r
	}
	out := make([]FileRecord, len(ids))
	for i, id := range ids {
		r, ok := byID[id]
		if !ok || r.Kind != fileKindAttach || r.OwnerID != userID || r.SpaceID != spaceID {
			// One message for every failure mode: a forged id must not be
			// distinguishable from an unknown one.
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("unknown attachment"))
		}
		out[i] = r
	}
	return out, nil
}

// insertAttachments links claimed files to a message, in order. A file
// already linked elsewhere trips the UNIQUE constraint.
func insertAttachments(ctx context.Context, q *dbgen.Queries, messageID string, files []FileRecord) error {
	for i, f := range files {
		err := q.InsertMessageAttachment(ctx, dbgen.InsertMessageAttachmentParams{
			MessageID: messageID, FileID: f.ID, Position: int32(i),
		})
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return connect.NewError(connect.CodeInvalidArgument, errors.New("attachment already used"))
			}
			return fmt.Errorf("attach file: %w", err)
		}
	}
	return nil
}

// attachmentsByMessage loads every listed message's attachments with one
// query and one port call.
func (s *Service) attachmentsByMessage(ctx context.Context, messageIDs []string) (map[string][]*chatv1.Attachment, error) {
	out := map[string][]*chatv1.Attachment{}
	if len(messageIDs) == 0 {
		return out, nil
	}
	links, err := s.q.ListAttachmentsForMessages(ctx, messageIDs)
	if err != nil {
		return nil, fmt.Errorf("list attachments: %w", err)
	}
	if len(links) == 0 {
		return out, nil
	}
	fileIDs := make([]string, len(links))
	for i, l := range links {
		fileIDs[i] = l.FileID
	}
	records, err := s.fileRecords(ctx, fileIDs)
	if err != nil {
		return nil, err
	}
	for _, l := range links {
		if r, ok := records[l.FileID]; ok {
			out[l.MessageID] = append(out[l.MessageID], toProtoAttachment(r))
		}
	}
	return out, nil
}

// fileRecords resolves file metadata through the port, keyed by id. A nil
// port (attachments not wired) yields nothing rather than an error.
func (s *Service) fileRecords(ctx context.Context, ids []string) (map[string]FileRecord, error) {
	out := map[string]FileRecord{}
	if s.files == nil || len(ids) == 0 {
		return out, nil
	}
	records, err := s.files.GetFiles(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("resolve attachments: %w", err)
	}
	for _, r := range records {
		out[r.ID] = r
	}
	return out, nil
}

func toProtoAttachment(r FileRecord) *chatv1.Attachment {
	return &chatv1.Attachment{FileId: r.ID, Name: r.Name, ContentType: r.ContentType, Size: r.Size}
}

func toProtoAttachments(records []FileRecord) []*chatv1.Attachment {
	out := make([]*chatv1.Attachment, len(records))
	for i, r := range records {
		out[i] = toProtoAttachment(r)
	}
	return out
}

// previewText is the one-line form of a message for reply quotes and
// activity previews: its text, or the first attachment's name when it has no
// text.
func previewText(content string, firstAttachment string) string {
	if content == "" && firstAttachment != "" {
		return "📎 " + firstAttachment
	}
	return plainText(content)
}

// deleteMessageFiles removes a deleted message's files through the port.
// Best effort: the message is already gone; a failure leaves orphans for
// the GC sweep.
func (s *Service) deleteMessageFiles(ctx context.Context, fileIDs []string) {
	if s.files == nil || len(fileIDs) == 0 {
		return
	}
	if err := s.files.DeleteFiles(ctx, fileIDs); err != nil {
		slog.Warn("could not delete a deleted message's attachments", "err", err)
	}
}

// ReferencedFiles implements the files module's sweep port: which of
// these files chat still points at — attached to a message, a link
// preview's image, or a space's icon.
func (s *Service) ReferencedFiles(ctx context.Context, ids []string) ([]string, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	return s.q.ReferencedFileIDs(ctx, ids)
}
