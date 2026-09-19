package instance

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/diag"
)

// The Right now and Database panels (docs/proposals/diagnostics.md).

func (s *Service) GetLiveStats(ctx context.Context, _ *connect.Request[instancev1.GetLiveStatsRequest]) (*connect.Response[instancev1.GetLiveStatsResponse], error) {
	if err := requireAction(ctx, authctx.InstanceRead); err != nil {
		return nil, err
	}
	snap := diag.Default.Snapshot()
	resp := &instancev1.GetLiveStatsResponse{
		StepSeconds: int32(diag.SampleStep / time.Second),
		At:          timestamppb.New(snap.At),
	}
	for _, g := range snap.Gauges {
		resp.Gauges = append(resp.Gauges, &instancev1.Gauge{Name: g.Name, Value: g.Value, Series: g.Series})
	}
	for _, c := range snap.Counters {
		resp.Gauges = append(resp.Gauges, &instancev1.Gauge{Name: c.Name, Value: float64(c.Value)})
	}
	return connect.NewResponse(resp), nil
}

func (s *Service) GetDatabaseStats(ctx context.Context, _ *connect.Request[instancev1.GetDatabaseStatsRequest]) (*connect.Response[instancev1.GetDatabaseStatsResponse], error) {
	if err := requireAction(ctx, authctx.InstanceRead); err != nil {
		return nil, err
	}
	start := time.Now()
	if err := s.pool.Ping(ctx); err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, err)
	}
	ping := time.Since(start)
	facts, err := s.q.GetDatabaseFacts(ctx)
	if err != nil {
		return nil, err
	}
	st := s.pool.Stat()
	return connect.NewResponse(&instancev1.GetDatabaseStatsResponse{
		PoolMax:             st.MaxConns(),
		PoolAcquired:        st.AcquiredConns(),
		PoolIdle:            st.IdleConns(),
		AcquireWaits:        st.EmptyAcquireCount(),
		AcquireWaitMs:       st.AcquireDuration().Milliseconds(),
		PingUs:              int32(ping.Microseconds()),
		DatabaseBytes:       facts.DatabaseBytes,
		BackendsActive:      facts.BackendsActive,
		BackendsIdle:        facts.BackendsIdle,
		OldestTransactionMs: int32(facts.OldestTransactionMs),
		ServerVersion:       facts.ServerVersion,
		SchemaVersion:       facts.SchemaVersion,
		SchemaFloor:         facts.SchemaFloor,
	}), nil
}
