// Package pbtime renders an optional time as a proto timestamp.
package pbtime

import (
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

// OrNil is the proto timestamp of at, or nil when at is nil.
func OrNil(at *time.Time) *timestamppb.Timestamp {
	if at == nil {
		return nil
	}
	return timestamppb.New(*at)
}

// OrZero is the proto timestamp of at, or nil when at is the zero time.
func OrZero(at time.Time) *timestamppb.Timestamp {
	if at.IsZero() {
		return nil
	}
	return timestamppb.New(at)
}
