package chat_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

// nextActivityItem skips past anything else on the personal topic (a
// ChannelMuted echo, say) to the next activity item.
func nextActivityItem(t *testing.T, sub *events.Subscription) *realtimev1.ActivityItemCreated {
	t.Helper()
	for {
		if a := nextEvent(t, sub).GetActivityItemCreated(); a != nil {
			return a
		}
	}
}

// The mute stamp on an activity item is the server's, so a client that
// has never opened the space still knows not to badge or banner it.
func TestActivityMuteStamp(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	sub := bus.Subscribe("user:" + authctx.UserID(bea))
	defer sub.Close()

	mention := func(t *testing.T, content string) *chatv1.ActivityItem {
		t.Helper()
		if _, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: channelID, Content: content,
		})); err != nil {
			t.Fatal(err)
		}
		return nextActivityItem(t, sub).Item
	}
	newest := func(t *testing.T) *chatv1.ActivityItem {
		t.Helper()
		list, err := svc.ListActivity(bea, connect.NewRequest(&chatv1.ListActivityRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		if len(list.Msg.Items) == 0 {
			t.Fatal("no activity items")
		}
		return list.Msg.Items[0]
	}

	// Unmuted.
	if item := mention(t, "@bea one"); item.Muted {
		t.Error("unmuted mention: event muted = true")
	}
	if newest(t).Muted {
		t.Error("unmuted mention: listed muted = true")
	}

	// Bea's own channel row.
	if _, err := svc.SetChannelMuted(bea, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: channelID, Muted: true})); err != nil {
		t.Fatal(err)
	}
	if item := mention(t, "@bea two"); !item.Muted {
		t.Error("muted channel: event muted = false")
	}
	if !newest(t).Muted {
		t.Error("muted channel: listed muted = false")
	}

	// Bea's own space row, with the channel unmuted again.
	if _, err := svc.SetChannelMuted(bea, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: channelID, Muted: false})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetSpaceMuted(bea, connect.NewRequest(&chatv1.SetSpaceMutedRequest{SpaceId: spaceID, Muted: true})); err != nil {
		t.Fatal(err)
	}
	if item := mention(t, "@bea three"); !item.Muted {
		t.Error("muted space: event muted = false")
	}
	if !newest(t).Muted {
		t.Error("muted space: listed muted = false")
	}

	// A direct message has no space, so only its own row applies.
	dm, err := svc.OpenDirectMessage(owner, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{authctx.UserID(bea)}}))
	if err != nil {
		t.Fatal(err)
	}
	dmChannel := dm.Msg.DirectMessage.Channel.Id
	if _, err := svc.SetChannelMuted(bea, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: dmChannel, Muted: true})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: dmChannel, Content: "psst"})); err != nil {
		t.Fatal(err)
	}
	if item := nextActivityItem(t, sub).Item; !item.Muted {
		t.Error("muted DM: event muted = false")
	}
	if !newest(t).Muted {
		t.Error("muted DM: listed muted = false")
	}
}

// An activity item previews the message it is about, so a token sees it
// only with the grant that message needs.
func TestActivityListFollowsTheReadGrants(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	beaID := authctx.UserID(bea)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: sp.Msg.Space.Id}))
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	// One mention in the space, one direct message: two items for bea.
	if _, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: sp.Msg.DefaultChannel.Id, Content: "@bea the gate"})); err != nil {
		t.Fatal(err)
	}
	dm, err := svc.OpenDirectMessage(owner, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{beaID}}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: dm.Msg.DirectMessage.Channel.Id, Content: "the secret word"})); err != nil {
		t.Fatal(err)
	}

	asToken := func(grants ...authctx.Action) context.Context {
		return authctx.WithIdentity(context.Background(), authctx.Identity{UserID: beaID, Role: authctx.RoleMember, Kind: authctx.KindPerson,
			Credential: authctx.Credential{ID: uuid.NewString(), Kind: authctx.CredentialPersonalToken, Grants: grants}})
	}
	kinds := func(ctx context.Context) []chatv1.ActivityKind {
		t.Helper()
		list, err := svc.ListActivity(ctx, connect.NewRequest(&chatv1.ListActivityRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		out := []chatv1.ActivityKind{}
		for _, it := range list.Msg.Items {
			out = append(out, it.Kind)
			if it.Kind == chatv1.ActivityKind_ACTIVITY_KIND_DM && !strings.Contains(it.Preview, "secret") {
				t.Errorf("DM preview lost: %q", it.Preview)
			}
		}
		return out
	}
	if got := kinds(bea); len(got) != 2 {
		t.Fatalf("session sees %v, want both", got)
	}
	if got := kinds(asToken(authctx.ActivityRead, authctx.MessagesRead, authctx.DMsRead)); len(got) != 2 {
		t.Errorf("with both reads saw %v, want both", got)
	}
	for _, grants := range [][]authctx.Action{
		{authctx.ActivityRead},
		{authctx.ActivityRead, authctx.MessagesRead},
		{authctx.ActivityRead, authctx.DMsRead},
	} {
		if _, err := svc.ListActivity(asToken(grants...), connect.NewRequest(&chatv1.ListActivityRequest{})); code(err) != connect.CodePermissionDenied {
			t.Errorf("activity with %v: %v", grants, err)
		}
	}
}
