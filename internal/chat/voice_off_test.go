package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

// voicePolicy is an instance whose voice can be switched.
type voicePolicy struct{ on bool }

func (*voicePolicy) MembersMayCreateSpaces(context.Context) (bool, error) { return true, nil }
func (*voicePolicy) MessageRetentionDays(context.Context) (int, error)    { return 0, nil }
func (p *voicePolicy) VoiceAvailable() bool                               { return p.on }

// With voice off a voice channel is not listed, counted, searched or
// created, and it is all back when voice is.
func TestVoiceOffHidesVoiceChannels(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	policy := &voicePolicy{on: true}
	svc.UseInstancePolicy(policy)

	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, general := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	newVoice := func(name string) (string, error) {
		res, err := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{
			SpaceId: spaceID, Name: name, Kind: chatv1.ChannelKind_CHANNEL_KIND_VOICE,
		}))
		if err != nil {
			return "", err
		}
		return res.Msg.Channel.Id, nil
	}
	hangout, err := newVoice("hangout")
	if err != nil {
		t.Fatal(err)
	}
	// The only unread message in the space is in the voice channel's chat.
	if _, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: hangout, Content: "tomatoes tonight"})); err != nil {
		t.Fatal(err)
	}

	listed := func() []string {
		t.Helper()
		res, err := svc.ListChannels(bea, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: spaceID}))
		if err != nil {
			t.Fatal(err)
		}
		ids := make([]string, len(res.Msg.Channels))
		for i, c := range res.Msg.Channels {
			ids[i] = c.Id
		}
		return ids
	}
	unread := func() bool {
		t.Helper()
		res, err := svc.ListSpaces(bea, connect.NewRequest(&chatv1.ListSpacesRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Spaces[0].HasUnread
	}
	found := func() int {
		t.Helper()
		res, err := svc.SearchMessages(bea, connect.NewRequest(&chatv1.SearchMessagesRequest{
			Scope: &chatv1.SearchMessagesRequest_SpaceId{SpaceId: spaceID}, Query: "tomatoes",
		}))
		if err != nil {
			t.Fatal(err)
		}
		return len(res.Msg.Messages)
	}
	voiceSpace := func() string {
		t.Helper()
		id, err := svc.VoiceChannelSpace(context.Background(), hangout)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	check := func(when string, wantListed int, wantUnread bool, wantFound int, wantSpace string) {
		t.Helper()
		if got := listed(); len(got) != wantListed {
			t.Errorf("%s: listed %v, want %d channels", when, got, wantListed)
		}
		if got := unread(); got != wantUnread {
			t.Errorf("%s: has_unread = %v, want %v", when, got, wantUnread)
		}
		if got := found(); got != wantFound {
			t.Errorf("%s: search found %d, want %d", when, got, wantFound)
		}
		if got := voiceSpace(); got != wantSpace {
			t.Errorf("%s: voice channel's space = %q, want %q", when, got, wantSpace)
		}
	}
	check("voice on", 2, true, 1, spaceID)

	policy.on = false
	check("voice off", 1, false, 0, "")
	if _, err := newVoice("garage"); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("creating a voice channel with voice off: want failed_precondition, got %v", err)
	}
	// The order is every channel the caller was shown.
	if _, err := svc.ReorderChannels(owner, connect.NewRequest(&chatv1.ReorderChannelsRequest{
		SpaceId: spaceID, ChannelIds: []string{general},
	})); err != nil {
		t.Errorf("reordering the listed channels with voice off: %v", err)
	}
	// The hidden channel does not make the last text channel deletable.
	if _, err := svc.DeleteChannel(owner, connect.NewRequest(&chatv1.DeleteChannelRequest{ChannelId: general})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("deleting the only listed channel: want failed_precondition, got %v", err)
	}

	policy.on = true
	check("voice back on", 2, true, 1, spaceID)
}

// A space's own switch hides its voice channels and ends its calls,
// leaves other spaces alone, and is the space admins' to flip.
func TestSpaceVoiceSwitch(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	rooms := &stubRooms{}
	svc.UseVoiceRooms(rooms)

	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	newSpace := func(name string) (spaceID, voiceID string) {
		t.Helper()
		sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: name}))
		if err != nil {
			t.Fatal(err)
		}
		vc, err := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{
			SpaceId: sp.Msg.Space.Id, Name: "hangout", Kind: chatv1.ChannelKind_CHANNEL_KIND_VOICE,
		}))
		if err != nil {
			t.Fatal(err)
		}
		return sp.Msg.Space.Id, vc.Msg.Channel.Id
	}
	porch, porchVoice := newSpace("Porch")
	garage, garageVoice := newSpace("Garage")
	inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: porch}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}

	set := func(ctx context.Context, on bool) (*chatv1.Space, error) {
		res, err := svc.UpdateSpace(ctx, connect.NewRequest(&chatv1.UpdateSpaceRequest{SpaceId: porch, VoiceEnabled: &on}))
		if err != nil {
			return nil, err
		}
		return res.Msg.Space, nil
	}
	listed := func(spaceID string) int {
		t.Helper()
		res, err := svc.ListChannels(owner, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: spaceID}))
		if err != nil {
			t.Fatal(err)
		}
		return len(res.Msg.Channels)
	}
	voiceSpace := func(channelID string) string {
		t.Helper()
		id, err := svc.VoiceChannelSpace(context.Background(), channelID)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}

	if _, err := set(bea, false); code(err) != connect.CodePermissionDenied {
		t.Errorf("a member turning voice off: want permission_denied, got %v", err)
	}
	space, err := set(owner, false)
	if err != nil {
		t.Fatal(err)
	}
	if space.VoiceEnabled {
		t.Error("the space still says voice is on")
	}
	if len(rooms.closed) != 1 || rooms.closed[0] != porchVoice {
		t.Errorf("closed rooms %v, want the space's one voice channel", rooms.closed)
	}
	if got := listed(porch); got != 1 {
		t.Errorf("the space lists %d channels with voice off, want 1", got)
	}
	if got := voiceSpace(porchVoice); got != "" {
		t.Errorf("a hidden voice channel resolved to space %q", got)
	}
	_, err = svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: porch, Name: "garage", Kind: chatv1.ChannelKind_CHANNEL_KIND_VOICE,
	}))
	if code(err) != connect.CodeFailedPrecondition {
		t.Errorf("creating a voice channel with the space's voice off: want failed_precondition, got %v", err)
	}
	// The other space is untouched.
	if got := listed(garage); got != 2 {
		t.Errorf("the other space lists %d channels, want 2", got)
	}
	if got := voiceSpace(garageVoice); got != garage {
		t.Errorf("the other space's voice channel resolved to %q", got)
	}

	if space, err = set(owner, true); err != nil || !space.VoiceEnabled {
		t.Fatalf("turning voice back on: %v, %+v", err, space)
	}
	if got := listed(porch); got != 2 {
		t.Errorf("the space lists %d channels with voice back on, want 2", got)
	}
}
