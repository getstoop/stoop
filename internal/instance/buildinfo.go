package instance

import (
	"context"

	"connectrpc.com/connect"

	instancev1 "github.com/Jhut89/stoop/gen/stoop/instance/v1"
)

// BuildInfo is what the binary knows about itself, wired in internal/app
// from the buildinfo package so this module has nothing to import.
type BuildInfo struct {
	Version, Commit, BuiltAt, GoVersion string
}

func (s *Service) UseBuildInfo(b BuildInfo) { s.build = b }

func (s *Service) GetBuildInfo(ctx context.Context, _ *connect.Request[instancev1.GetBuildInfoRequest]) (*connect.Response[instancev1.GetBuildInfoResponse], error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.GetBuildInfoResponse{
		Version: s.build.Version, Commit: s.build.Commit,
		BuiltAt: s.build.BuiltAt, GoVersion: s.build.GoVersion,
	}), nil
}
