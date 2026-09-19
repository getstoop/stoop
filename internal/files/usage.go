package files

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	filesv1 "github.com/getstoop/stoop/gen/stoop/files/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// Usage is the upload disk as this module accounts it: live files only,
// against the operator's quota (0 is unlimited).
type Usage struct {
	Bytes, Files, Quota int64
}

// StorageUsage is the one place the numbers come from; the admin RPC and
// the Health panel's storage check both read it.
func (s *Service) StorageUsage(ctx context.Context) (Usage, error) {
	u, err := s.q.StorageUsage(ctx)
	if err != nil {
		return Usage{}, fmt.Errorf("storage usage: %w", err)
	}
	quota, err := s.quota(ctx)
	if err != nil {
		return Usage{}, err
	}
	return Usage{Bytes: u.Bytes, Files: u.Files, Quota: quota}, nil
}

func (s *Service) GetStorageUsage(ctx context.Context, _ *connect.Request[filesv1.GetStorageUsageRequest]) (*connect.Response[filesv1.GetStorageUsageResponse], error) {
	if err := requireAction(ctx, authctx.InstanceRead); err != nil {
		return nil, err
	}
	u, err := s.StorageUsage(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&filesv1.GetStorageUsageResponse{
		UsedBytes: u.Bytes, FileCount: u.Files, QuotaBytes: u.Quota,
	}), nil
}
