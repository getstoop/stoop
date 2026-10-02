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
func (policy *voicePolicy) VoiceAvailable() bool                          { return policy.on }

// With voice off a voice channel is not listed, counted, searched or
// created, and it is all back when voice is.
func TestVoiceOffHidesVoiceChannels(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	policy := &voicePolicy{on: true}
	svc.UseInstancePolicy(policy)

	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	created, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, general := created.Msg.Space.Id, created.Msg.DefaultChannel.Id
	invited, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invited.Msg.Invite.Code})); err != nil {
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
		for index, channel := range res.Msg.Channels {
			ids[index] = channel.Id
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
	// Knowing its id is no way in: every member-facing call says not found.
	byID := map[string]func() error{
		"SendMessage": func() error {
			_, err := svc.SendMessage(bea, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: hangout, Content: "anyone here?"}))
			return err
		},
		"ListMessages": func() error {
			_, err := svc.ListMessages(bea, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: hangout}))
			return err
		},
		"ListPinnedMessages": func() error {
			_, err := svc.ListPinnedMessages(bea, connect.NewRequest(&chatv1.ListPinnedMessagesRequest{ChannelId: hangout}))
			return err
		},
		"MarkChannelRead": func() error {
			_, err := svc.MarkChannelRead(bea, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: hangout}))
			return err
		},
		"an upload": func() error {
			_, err := svc.ChannelSpaceToPostIn(bea, authctx.UserID(bea), hangout)
			return err
		},
	}
	for name, call := range byID {
		if err := call(); code(err) != connect.CodeNotFound {
			t.Errorf("%s in a hidden channel: want not_found, got %v", name, err)
		}
	}
	// The hidden channel does not make the last text channel deletable.
	if _, err := svc.DeleteChannel(owner, connect.NewRequest(&chatv1.DeleteChannelRequest{ChannelId: general})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("deleting the only listed channel: want failed_precondition, got %v", err)
	}

	policy.on = true
	check("voice back on", 2, true, 1, spaceID)
	for name, call := range byID {
		if err := call(); err != nil {
			t.Errorf("%s with voice back on: %v", name, err)
		}
	}
}
