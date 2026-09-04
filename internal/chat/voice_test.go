package chat_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/chat"
	"github.com/Jhut89/stoop/internal/db/dbtest"
	"github.com/Jhut89/stoop/internal/events"
)

// stubRooms records what chat asked the SFU to do.
type stubRooms struct {
	removed []string // "channel/user"
	closed  []string
	err     error
	ctxErrs []error // ctx.Err() as each call saw it
	onCall  func()  // runs once a call is recorded
}

func (r *stubRooms) RemoveParticipant(ctx context.Context, channelID, userID string) error {
	r.removed = append(r.removed, channelID+"/"+userID)
	r.note(ctx)
	return r.err
}

func (r *stubRooms) CloseRoom(ctx context.Context, channelID string) error {
	r.closed = append(r.closed, channelID)
	r.note(ctx)
	return r.err
}

func (r *stubRooms) note(ctx context.Context) {
	r.ctxErrs = append(r.ctxErrs, ctx.Err())
	if r.onCall != nil {
		r.onCall()
	}
}

// A kick, ban, leave or delete has to reach the SFU, not just the rows.
func TestVoiceRoomsFollowMembership(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	rooms := &stubRooms{}
	svc.UseVoiceRooms(rooms)

	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	beaID := authctx.UserID(bea)

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	join := func() {
		t.Helper()
		inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}
	newChannel := func(name string, kind chatv1.ChannelKind) string {
		t.Helper()
		res, err := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{
			SpaceId: spaceID, Name: name, Kind: kind,
		}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Channel.Id
	}
	hangout := newChannel("hangout", chatv1.ChannelKind_CHANNEL_KIND_VOICE)
	garage := newChannel("garage", chatv1.ChannelKind_CHANNEL_KIND_VOICE)
	newChannel("chatter", chatv1.ChannelKind_CHANNEL_KIND_TEXT)

	// Every voice channel: which one they are in is client-reported.
	want := []string{hangout + "/" + beaID, garage + "/" + beaID}
	equal := func(t *testing.T, got, want []string) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("got %v, want %v", got, want)
		}
		for i := range got {
			if got[i] != want[i] {
				t.Fatalf("got %v, want %v", got, want)
			}
		}
	}

	join()
	if _, err := svc.KickMember(owner, connect.NewRequest(&chatv1.KickMemberRequest{SpaceId: spaceID, UserId: beaID})); err != nil {
		t.Fatal(err)
	}
	equal(t, rooms.removed, want)

	rooms.removed = nil
	join()
	if _, err := svc.LeaveSpace(bea, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: spaceID})); err != nil {
		t.Fatal(err)
	}
	equal(t, rooms.removed, want)

	rooms.removed = nil
	join()
	if _, err := svc.BanMember(owner, connect.NewRequest(&chatv1.BanMemberRequest{SpaceId: spaceID, UserId: beaID})); err != nil {
		t.Fatal(err)
	}
	equal(t, rooms.removed, want)

	// A deleted voice channel takes its room with it.
	if _, err := svc.DeleteChannel(owner, connect.NewRequest(&chatv1.DeleteChannelRequest{ChannelId: hangout})); err != nil {
		t.Fatal(err)
	}
	equal(t, rooms.closed, []string{hangout})

	// And so does a deleted space, for the channels it still had.
	if _, err := svc.DeleteSpace(owner, connect.NewRequest(&chatv1.DeleteSpaceRequest{SpaceId: spaceID})); err != nil {
		t.Fatal(err)
	}
	equal(t, rooms.closed, []string{hangout, garage})
}

// The membership change has already committed, so an unreachable sidecar
// must not fail the kick.
func TestKickSurvivesAnUnreachableSFU(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	rooms := &stubRooms{err: errors.New("connection refused")}
	svc.UseVoiceRooms(rooms)

	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	beaID := authctx.UserID(bea)

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	if _, err := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: spaceID, Name: "hangout", Kind: chatv1.ChannelKind_CHANNEL_KIND_VOICE,
	})); err != nil {
		t.Fatal(err)
	}
	inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.KickMember(owner, connect.NewRequest(&chatv1.KickMemberRequest{SpaceId: spaceID, UserId: beaID})); err != nil {
		t.Errorf("kick failed because the SFU was down: %v", err)
	}
	if len(rooms.removed) == 0 {
		t.Error("the SFU was never asked")
	}
}

// Enforcement runs after the commit, so a moderator whose connection drops
// in that window must not cancel it and leave the member in the call.
func TestEvictionOutlivesTheCaller(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	rooms := &stubRooms{}
	svc.UseVoiceRooms(rooms)

	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	beaID := authctx.UserID(bea)

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	for _, name := range []string{"hangout", "garage"} {
		if _, err := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{
			SpaceId: spaceID, Name: name, Kind: chatv1.ChannelKind_CHANNEL_KIND_VOICE,
		})); err != nil {
			t.Fatal(err)
		}
	}
	inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}

	kickCtx, cancel := context.WithCancel(owner)
	defer cancel()
	rooms.onCall = cancel // the moderator hangs up part-way through
	if _, err := svc.KickMember(kickCtx, connect.NewRequest(&chatv1.KickMemberRequest{
		SpaceId: spaceID, UserId: beaID,
	})); err != nil {
		t.Fatal(err)
	}
	if len(rooms.removed) != 2 {
		t.Errorf("a cancelled caller stopped the eviction: %v", rooms.removed)
	}
	for i, err := range rooms.ctxErrs {
		if err != nil {
			t.Errorf("call %d ran on a cancelled context: %v", i, err)
		}
	}
}
