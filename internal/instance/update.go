package instance

import (
	"context"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// Update is the newest release, whether it is newer than this server,
// and whether this server is older than the oldest supported release.
type Update struct {
	Latest    string
	Available bool
	Outdated  bool
}

// UpdateChecker is instance's port onto the release index, wired in
// internal/app. Without one the check is off and GetUpdate answers empty.
type UpdateChecker interface {
	LatestRelease(ctx context.Context) Update
}

func (s *Service) UseUpdateChecker(c UpdateChecker) { s.updates = c }

func (s *Service) GetUpdate(ctx context.Context, _ *connect.Request[instancev1.GetUpdateRequest]) (*connect.Response[instancev1.GetUpdateResponse], error) {
	if err := requireAction(ctx, authctx.InstanceRead); err != nil {
		return nil, err
	}
	if s.updates == nil {
		return connect.NewResponse(&instancev1.GetUpdateResponse{}), nil
	}
	u := s.updates.LatestRelease(ctx)
	return connect.NewResponse(&instancev1.GetUpdateResponse{Latest: u.Latest, Available: u.Available, Outdated: u.Outdated}), nil
}
