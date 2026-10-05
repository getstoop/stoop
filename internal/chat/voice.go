package chat

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Losing a place in a space has to reach the SFU as well as the database;
// see docs/architecture/voice.md.

// voiceCleanupTimeout bounds one eviction or close, whatever it covers.
const voiceCleanupTimeout = 15 * time.Second

// VoiceRooms is chat's port onto the SFU; implemented by the voice module
// and wired in internal/app. Nil means voice is not configured.
type VoiceRooms interface {
	// RemoveParticipant disconnects one user from one voice channel.
	RemoveParticipant(ctx context.Context, channelID, userID string) error
	// CloseRoom disconnects everyone in a voice channel.
	CloseRoom(ctx context.Context, channelID string) error
}

// UseVoiceRooms wires the SFU port.
func (s *Service) UseVoiceRooms(v VoiceRooms) { s.rooms = v }

var (
	errVoiceOff = connect.NewError(connect.CodeFailedPrecondition,
		errors.New("voice is turned off on this server"))
	errSpaceVoiceOff = connect.NewError(connect.CodeFailedPrecondition,
		errors.New("voice is turned off in this space"))
)

// voiceAvailable reports whether the instance has voice at all.
func (s *Service) voiceAvailable() bool { return s.policy == nil || s.policy.VoiceAvailable() }

// requireVoice refuses while a space's voice channels are not in use:
// the instance has no voice, or the space turned it off. While they are
// not in use they are hidden: see docs/architecture/voice.md → Turning
// voice off.
func (s *Service) requireVoice(ctx context.Context, spaceID string) error {
	if !s.voiceAvailable() {
		return errVoiceOff
	}
	on, err := s.q.SpaceVoiceEnabled(ctx, spaceID)
	if err != nil {
		return apierr.NotFoundOr(err, "space")
	}
	if !on {
		return errSpaceVoiceOff
	}
	return nil
}

// voiceOn is requireVoice as a yes or no.
func (s *Service) voiceOn(ctx context.Context, spaceID string) (bool, error) {
	switch err := s.requireVoice(ctx, spaceID); {
	case err == nil:
		return true, nil
	case errors.Is(err, errVoiceOff), errors.Is(err, errSpaceVoiceOff):
		return false, nil
	default:
		return false, err
	}
}

func isVoice(channel dbgen.Channel) bool {
	return chatv1.ChannelKind(channel.Kind) == chatv1.ChannelKind_CHANNEL_KIND_VOICE
}

// hiddenChannel reports whether a channel is a voice channel while voice
// is off for its space. Its members are then answered as if it did not
// exist.
func (s *Service) hiddenChannel(ctx context.Context, channel dbgen.Channel) (bool, error) {
	if !isVoice(channel) {
		return false, nil
	}
	on, err := s.voiceOn(ctx, spaceOf(channel))
	return !on, err
}

// cleanupCtx detaches this work from the caller, who has already committed
// the change it enforces, and bounds what an unreachable sidecar can cost.
func cleanupCtx(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), voiceCleanupTimeout)
}

// evictFromSpaceVoice disconnects a user from every voice channel in a
// space; which one they were in is client-reported and not trustworthy.
// Best-effort: the membership change has already committed.
func (s *Service) evictFromSpaceVoice(ctx context.Context, spaceID, userID string) {
	if s.rooms == nil {
		return
	}
	ctx, cancel := cleanupCtx(ctx)
	defer cancel()
	for _, channelID := range s.voiceChannelIDs(ctx, spaceID) {
		if err := s.rooms.RemoveParticipant(ctx, channelID, userID); err != nil {
			slog.Default().Warn("could not remove a departed member from a voice room",
				"space_id", spaceID, "channel_id", channelID, "user_id", userID, "err", err)
		}
	}
}

// closeVoiceRooms ends deleted voice channels' rooms.
func (s *Service) closeVoiceRooms(ctx context.Context, channelIDs ...string) {
	if s.rooms == nil || len(channelIDs) == 0 {
		return
	}
	ctx, cancel := cleanupCtx(ctx)
	defer cancel()
	for _, channelID := range channelIDs {
		if err := s.rooms.CloseRoom(ctx, channelID); err != nil {
			slog.Default().Warn("could not close a deleted channel's voice room",
				"channel_id", channelID, "err", err)
		}
	}
}

// voiceChannelIDs lists a space's voice channels, whose ids are their
// LiveKit room names. None when voice is off or the lookup fails.
func (s *Service) voiceChannelIDs(ctx context.Context, spaceID string) []string {
	if s.rooms == nil {
		return nil
	}
	ids, err := s.q.ListChannelIDsByKind(ctx, dbgen.ListChannelIDsByKindParams{
		SpaceID: spaceID, Kind: int16(chatv1.ChannelKind_CHANNEL_KIND_VOICE),
	})
	if err != nil {
		slog.Default().Warn("could not list a space's voice channels", "space_id", spaceID, "err", err)
		return nil
	}
	return ids
}
