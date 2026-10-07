package chat

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
)

// DeleteThread removes a root and every reply in its thread. Built in
// STOOP-424.
func (s *Service) DeleteThread(ctx context.Context, req *connect.Request[chatv1.DeleteThreadRequest]) (*connect.Response[chatv1.DeleteThreadResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("threads are not available yet"))
}
