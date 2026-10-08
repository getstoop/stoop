package chat

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
)

// Thread mutes and read markers (STOOP-433). Stubs until the server half
// lands.

func (s *Service) SetThreadMuted(context.Context, *connect.Request[chatv1.SetThreadMutedRequest]) (*connect.Response[chatv1.SetThreadMutedResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("thread mutes are not available yet"))
}

func (s *Service) ListThreadMutes(context.Context, *connect.Request[chatv1.ListThreadMutesRequest]) (*connect.Response[chatv1.ListThreadMutesResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("thread mutes are not available yet"))
}

func (s *Service) MarkThreadRead(context.Context, *connect.Request[chatv1.MarkThreadReadRequest]) (*connect.Response[chatv1.MarkThreadReadResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("thread read markers are not available yet"))
}
