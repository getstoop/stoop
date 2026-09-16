package instance

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// The retention settings: how many days messages and attachments are kept.
// 0, or nothing saved, keeps them forever. Chat and files read them through
// their policy ports and sweep hourly. See docs/proposals/retention.md.

const (
	keyMessageRetention    = "message_retention_days"
	keyAttachmentRetention = "attachment_retention_days"
	// MaxRetentionDays bounds both settings: ten years.
	MaxRetentionDays = 3650
)

// RetentionCounter answers PreviewRetention: what a sweep with a given
// period would delete now. Chat counts messages, files counts attachments;
// both are wired in internal/app.
type RetentionCounter interface {
	CountExpiredMessages(ctx context.Context, now time.Time, days int) (int64, error)
	CountExpiringAttachments(ctx context.Context, now time.Time, days int) (files, bytes int64, err error)
}

// UseRetentionCounter wires the counts behind PreviewRetention.
func (s *Service) UseRetentionCounter(c RetentionCounter) { s.retention = c }

// MessageRetentionDays is chat's port: 0 keeps messages forever.
func (s *Service) MessageRetentionDays(ctx context.Context) (int, error) {
	return s.retentionDays(ctx, keyMessageRetention)
}

// AttachmentRetentionDays is files' port: 0 keeps attachments forever.
func (s *Service) AttachmentRetentionDays(ctx context.Context) (int, error) {
	return s.retentionDays(ctx, keyAttachmentRetention)
}

func (s *Service) retentionDays(ctx context.Context, key string) (int, error) {
	var days int
	if _, err := s.readJSON(ctx, key, &days); err != nil {
		return 0, err
	}
	return max(days, 0), nil
}

func validRetention(d *int32) bool {
	return d == nil || (*d >= 0 && *d <= MaxRetentionDays)
}

func errRetentionRange() error {
	return connect.NewError(connect.CodeInvalidArgument,
		fmt.Errorf("retention must be 1-%d days, or 0 to keep forever", MaxRetentionDays))
}

func (s *Service) PreviewRetention(ctx context.Context, req *connect.Request[instancev1.PreviewRetentionRequest]) (*connect.Response[instancev1.PreviewRetentionResponse], error) {
	if err := requireAction(ctx, authctx.InstanceSettingsManage); err != nil {
		return nil, err
	}
	m, a := req.Msg.MessageRetentionDays, req.Msg.AttachmentRetentionDays
	if !validRetention(&m) || !validRetention(&a) {
		return nil, errRetentionRange()
	}
	if s.retention == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("retention is not available"))
	}
	now := time.Now()
	out := &instancev1.PreviewRetentionResponse{}
	var err error
	if out.Messages, err = s.retention.CountExpiredMessages(ctx, now, int(m)); err != nil {
		return nil, fmt.Errorf("count messages: %w", err)
	}
	if out.Attachments, out.AttachmentBytes, err = s.retention.CountExpiringAttachments(ctx, now, int(a)); err != nil {
		return nil, fmt.Errorf("count attachments: %w", err)
	}
	return connect.NewResponse(out), nil
}
