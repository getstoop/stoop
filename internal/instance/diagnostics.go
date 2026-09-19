package instance

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// The Diagnostics tab's RPCs (docs/proposals/diagnostics.md). Health and
// ListJobs are built; the rest answer Unimplemented until their panel
// lands.

func (s *Service) GetHealth(ctx context.Context, _ *connect.Request[instancev1.GetHealthRequest]) (*connect.Response[instancev1.GetHealthResponse], error) {
	if err := requireAction(ctx, authctx.InstanceRead); err != nil {
		return nil, err
	}
	checks := s.runHealthChecks(ctx)
	resp := &instancev1.GetHealthResponse{Checks: make([]*instancev1.HealthCheck, len(checks))}
	for i, c := range checks {
		resp.Checks[i] = &instancev1.HealthCheck{
			Name: c.Name, State: toProtoCheckState(c.State), Detail: c.Detail,
			FixTab: c.FixTab, CheckedAt: timestamppb.New(c.CheckedAt),
		}
	}
	if !s.startedAt.IsZero() {
		resp.ServerStartedAt = timestamppb.New(s.startedAt)
	}
	return connect.NewResponse(resp), nil
}

func toProtoCheckState(st CheckState) instancev1.CheckState {
	switch st {
	case CheckOK:
		return instancev1.CheckState_CHECK_STATE_OK
	case CheckWarn:
		return instancev1.CheckState_CHECK_STATE_WARN
	case CheckDanger:
		return instancev1.CheckState_CHECK_STATE_DANGER
	case CheckOff:
		return instancev1.CheckState_CHECK_STATE_OFF
	}
	return instancev1.CheckState_CHECK_STATE_UNSPECIFIED
}

var errNotBuilt = errors.New("this panel is not built yet")

func (s *Service) GetLiveStats(ctx context.Context, _ *connect.Request[instancev1.GetLiveStatsRequest]) (*connect.Response[instancev1.GetLiveStatsResponse], error) {
	if err := requireAction(ctx, authctx.InstanceRead); err != nil {
		return nil, err
	}
	return nil, connect.NewError(connect.CodeUnimplemented, errNotBuilt)
}

func (s *Service) GetDatabaseStats(ctx context.Context, _ *connect.Request[instancev1.GetDatabaseStatsRequest]) (*connect.Response[instancev1.GetDatabaseStatsResponse], error) {
	if err := requireAction(ctx, authctx.InstanceRead); err != nil {
		return nil, err
	}
	return nil, connect.NewError(connect.CodeUnimplemented, errNotBuilt)
}

func (s *Service) GetRequestStats(ctx context.Context, _ *connect.Request[instancev1.GetRequestStatsRequest]) (*connect.Response[instancev1.GetRequestStatsResponse], error) {
	if err := requireAction(ctx, authctx.InstanceRead); err != nil {
		return nil, err
	}
	return nil, connect.NewError(connect.CodeUnimplemented, errNotBuilt)
}

func (s *Service) ListJobs(ctx context.Context, _ *connect.Request[instancev1.ListJobsRequest]) (*connect.Response[instancev1.ListJobsResponse], error) {
	if err := requireAction(ctx, authctx.InstanceRead); err != nil {
		return nil, err
	}
	return connect.NewResponse(s.listJobs(ctx)), nil
}
