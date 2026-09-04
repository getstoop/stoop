package chat_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/chat"
	"github.com/Jhut89/stoop/internal/db/dbtest"
	"github.com/Jhut89/stoop/internal/events"
)

func ptr[T any](v T) *T { return &v }

func TestSpaceDescriptionAndWelcome(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	if sp.Msg.Space.Description != "" || sp.Msg.Space.Welcome != "" {
		t.Fatalf("a new space starts with neither: %q / %q", sp.Msg.Space.Description, sp.Msg.Space.Welcome)
	}

	welcome := "## Welcome\n\n- #tools is the lending library\n- Say hi in #general"
	res, err := svc.UpdateSpace(owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId:     spaceID,
		Description: ptr("Neighbours between\n  4th and 7th."),
		Welcome:     ptr("  " + welcome + "  "),
	}))
	if err != nil {
		t.Fatal(err)
	}
	// A description is rendered where a line break can only ever be an
	// ellipsis, so it is flattened; the welcome keeps its markdown.
	if got, want := res.Msg.Space.Description, "Neighbours between 4th and 7th."; got != want {
		t.Errorf("description = %q, want %q", got, want)
	}
	if got := res.Msg.Space.Welcome; got != welcome {
		t.Errorf("welcome = %q, want %q", got, welcome)
	}

	// Both reach members through the space list, not just the response.
	list, err := svc.ListSpaces(owner, connect.NewRequest(&chatv1.ListSpacesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Msg.Spaces) != 1 || list.Msg.Spaces[0].Welcome != welcome {
		t.Errorf("ListSpaces did not carry the welcome text")
	}

	// One field at a time: the other is left alone.
	res, err = svc.UpdateSpace(owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: spaceID, Description: ptr(""),
	}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Space.Description != "" {
		t.Errorf("description = %q, want it cleared", res.Msg.Space.Description)
	}
	if res.Msg.Space.Welcome != welcome {
		t.Errorf("clearing the description disturbed the welcome text")
	}

	tooLong := strings.Repeat("x", 201)
	if _, err := svc.UpdateSpace(owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: spaceID, Description: &tooLong,
	})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("201-character description: code = %v, want InvalidArgument", code(err))
	}
	tooLong = strings.Repeat("x", 4001)
	if _, err := svc.UpdateSpace(owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: spaceID, Welcome: &tooLong,
	})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("4001-character welcome: code = %v, want InvalidArgument", code(err))
	}

	// A plain member may read both but change neither.
	inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateSpace(bea, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: spaceID, Description: ptr("mine now"),
	})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member setting the description: code = %v, want PermissionDenied", code(err))
	}
}

func TestSpaceDefaultChannel(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	if sp.Msg.Space.DefaultChannelId != "" {
		t.Errorf("a new space starts without one, got %q", sp.Msg.Space.DefaultChannelId)
	}

	tools, err := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: spaceID, Name: "tools",
	}))
	if err != nil {
		t.Fatal(err)
	}
	swing, err := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: spaceID, Name: "porch-swing", Kind: chatv1.ChannelKind_CHANNEL_KIND_VOICE,
	}))
	if err != nil {
		t.Fatal(err)
	}

	res, err := svc.UpdateSpace(owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: spaceID, DefaultChannelId: ptr(tools.Msg.Channel.Id),
	}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Space.DefaultChannelId != tools.Msg.Channel.Id {
		t.Errorf("default = %q, want #tools", res.Msg.Space.DefaultChannelId)
	}
	// It reaches members through the space list, not just the response.
	list, err := svc.ListSpaces(owner, connect.NewRequest(&chatv1.ListSpacesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Msg.Spaces) != 1 || list.Msg.Spaces[0].DefaultChannelId != tools.Msg.Channel.Id {
		t.Error("ListSpaces did not carry the default channel")
	}

	// A voice channel would open a microphone nobody asked to open.
	if _, err := svc.UpdateSpace(owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: spaceID, DefaultChannelId: ptr(swing.Msg.Channel.Id),
	})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("voice channel as default: code = %v, want InvalidArgument", code(err))
	}
	// A channel from another space would send arrivals somewhere they may
	// not be able to read.
	other, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Basement"}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateSpace(owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: spaceID, DefaultChannelId: ptr(other.Msg.DefaultChannel.Id),
	})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("another space's channel: code = %v, want InvalidArgument", code(err))
	}
	if _, err := svc.UpdateSpace(owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: spaceID, DefaultChannelId: ptr("00000000-0000-0000-0000-000000000000"),
	})); code(err) != connect.CodeNotFound {
		t.Errorf("channel that never existed: code = %v, want NotFound", code(err))
	}

	// None of that disturbed the setting, and neither does an unrelated
	// edit: an absent field is left alone.
	res, err = svc.UpdateSpace(owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: spaceID, Name: ptr("Front Porch"),
	}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Space.DefaultChannelId != tools.Msg.Channel.Id {
		t.Error("renaming the space lost the default channel")
	}

	// A plain member may read it but not set it.
	inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateSpace(bea, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: spaceID, DefaultChannelId: ptr(tools.Msg.Channel.Id),
	})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member setting the default: code = %v, want PermissionDenied", code(err))
	}

	// Empty is a real answer: back to whichever channel sorts first.
	res, err = svc.UpdateSpace(owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: spaceID, DefaultChannelId: ptr(""),
	}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Space.DefaultChannelId != "" {
		t.Errorf("default = %q, want it cleared", res.Msg.Space.DefaultChannelId)
	}
}

// Deleting the channel a space points at must not leave the space
// pointing at something that is gone: the column clears itself, and
// members are told, so their settings page stops offering it.
func TestDeletingTheDefaultChannelClearsIt(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, general := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	tools, err := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: spaceID, Name: "tools",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateSpace(owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: spaceID, DefaultChannelId: ptr(tools.Msg.Channel.Id),
	})); err != nil {
		t.Fatal(err)
	}

	sub := bus.Subscribe("space:" + spaceID)
	defer sub.Close()
	if _, err := svc.DeleteChannel(owner, connect.NewRequest(&chatv1.DeleteChannelRequest{
		ChannelId: tools.Msg.Channel.Id,
	})); err != nil {
		t.Fatal(err)
	}
	if ev := (<-sub.Events()).GetChannelDeleted(); ev == nil || ev.ChannelId != tools.Msg.Channel.Id {
		t.Fatal("expected ChannelDeleted for #tools")
	}
	ev := (<-sub.Events()).GetSpaceUpdated()
	if ev == nil || ev.Space.DefaultChannelId != "" {
		t.Fatal("expected SpaceUpdated saying the default is gone")
	}
	list, err := svc.ListSpaces(owner, connect.NewRequest(&chatv1.ListSpacesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if got := list.Msg.Spaces[0].DefaultChannelId; got != "" {
		t.Errorf("default = %q after its channel was deleted, want empty", got)
	}
	// The event must carry the row the clear actually wrote, not a
	// snapshot taken beforehand and edited to look right.
	if ev.Space.Id != list.Msg.Spaces[0].Id || ev.Space.Name != list.Msg.Spaces[0].Name {
		t.Errorf("event carried %q/%q, want the persisted %q/%q",
			ev.Space.Id, ev.Space.Name, list.Msg.Spaces[0].Id, list.Msg.Spaces[0].Name)
	}

	// Deleting a channel that was never the default says nothing about
	// the space: only ChannelDeleted goes out, and the default stands.
	if _, err := svc.UpdateSpace(owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: spaceID, DefaultChannelId: ptr(general),
	})); err != nil {
		t.Fatal(err)
	}
	<-sub.Events() // SpaceUpdated from that edit
	spare, err := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: spaceID, Name: "spare",
	}))
	if err != nil {
		t.Fatal(err)
	}
	<-sub.Events() // ChannelCreated
	if _, err := svc.DeleteChannel(owner, connect.NewRequest(&chatv1.DeleteChannelRequest{
		ChannelId: spare.Msg.Channel.Id,
	})); err != nil {
		t.Fatal(err)
	}
	if ev := (<-sub.Events()).GetChannelDeleted(); ev == nil {
		t.Fatal("expected ChannelDeleted for #spare")
	}
	select {
	case ev := <-sub.Events():
		t.Errorf("deleting an ordinary channel published %T as well", ev.Payload)
	default:
	}
	list, err = svc.ListSpaces(owner, connect.NewRequest(&chatv1.ListSpacesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if got := list.Msg.Spaces[0].DefaultChannelId; got != general {
		t.Errorf("default = %q, want #general untouched", got)
	}
}
