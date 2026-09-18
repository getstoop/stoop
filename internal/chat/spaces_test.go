package chat_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
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

// The server admin's Spaces page: every space on the server, the numbers
// it prints, and — the reason the RPC exists — membership reported apart
// from the admin role that is inherited without it.
func TestListAllSpacesForAdmin(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	admin := newUser(t, pool, "operator", authctx.RoleAdmin)

	// Two spaces the admin is not in, one they are. "Bodega" sorts first.
	stoop, err := svc.CreateSpace(casey, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Stoop"}))
	if err != nil {
		t.Fatal(err)
	}
	bodega, err := svc.CreateSpace(ada, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Bodega"}))
	if err != nil {
		t.Fatal(err)
	}
	joined, err := svc.CreateSpace(casey, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "The Landing"}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(admin, connect.NewRequest(&chatv1.JoinSpaceRequest{SpaceId: joined.Msg.Space.Id})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AddMember(casey, connect.NewRequest(&chatv1.AddMemberRequest{
		SpaceId: stoop.Msg.Space.Id, UserId: authctx.UserID(ada),
	})); err != nil {
		t.Fatal(err)
	}

	res, err := svc.ListAllSpaces(admin, connect.NewRequest(&chatv1.ListAllSpacesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]*chatv1.SpaceSummary{}
	names := make([]string, len(res.Msg.Spaces))
	for i, sp := range res.Msg.Spaces {
		got[sp.Name] = sp
		names[i] = sp.Name
	}
	if len(got) != 3 {
		t.Fatalf("spaces = %v, want all three", names)
	}
	if names[0] != "Bodega" {
		t.Errorf("spaces came back %v, want them sorted by name", names)
	}

	// Members are counted, owners are resolved through the directory.
	if n := got["Stoop"].MemberCount; n != 2 {
		t.Errorf("Stoop member count = %d, want 2", n)
	}
	if n := got["Bodega"].MemberCount; n != 1 {
		t.Errorf("Bodega member count = %d, want 1", n)
	}
	if u := got["Bodega"].OwnerUsername; u != "ada" {
		t.Errorf("Bodega owner = %q, want ada", u)
	}
	if got["Bodega"].OwnerId != authctx.UserID(ada) {
		t.Errorf("Bodega owner id does not match ada")
	}
	if got["Stoop"].CreatedAt == nil {
		t.Error("Stoop has no created date")
	}

	// The point of the field: an instance admin holds admin in every
	// space, and is a member of exactly one of these.
	if got["The Landing"].ViewerIsMember != true {
		t.Error("the space the admin joined is not reported as joined")
	}
	if got["Stoop"].ViewerIsMember || got["Bodega"].ViewerIsMember {
		t.Error("inherited admin was reported as membership")
	}
	if got["Bodega"].Id != bodega.Msg.Space.Id {
		t.Errorf("Bodega id does not match the space that was created")
	}

	// instance.read, and nothing weaker. A member of one of these spaces
	// still cannot list the server.
	if _, err := svc.ListAllSpaces(casey, connect.NewRequest(&chatv1.ListAllSpacesRequest{})); code(err) != connect.CodePermissionDenied {
		t.Errorf("a member listed every space: %v", err)
	}
	// A space-scoped credential reaches no instance action at all, so it
	// is refused outright rather than shown the space it is bound to.
	scoped := authctx.WithIdentity(context.Background(), authctx.Identity{
		UserID: authctx.UserID(admin), Role: authctx.RoleAdmin,
		Credential: authctx.Credential{
			ID: uuid.NewString(), Kind: authctx.CredentialPersonalToken,
			Bounded: true, Spaces: []string{joined.Msg.Space.Id},
		},
	})
	if _, err := svc.ListAllSpaces(scoped, connect.NewRequest(&chatv1.ListAllSpacesRequest{})); code(err) != connect.CodePermissionDenied {
		t.Errorf("a space-scoped token listed every space: %v", err)
	}
}

// A space whose owner deleted their account still lists: the page needs
// the row more than it needs the name.
func TestListAllSpacesWithDeletedOwner(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	admin := newUser(t, pool, "operator", authctx.RoleAdmin)

	if _, err := svc.CreateSpace(casey, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Bodega"})); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET deactivated_at = now(), deleted_at = now() WHERE id = $1`, authctx.UserID(casey)); err != nil {
		t.Fatal(err)
	}

	res, err := svc.ListAllSpaces(admin, connect.NewRequest(&chatv1.ListAllSpacesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Msg.Spaces) != 1 {
		t.Fatalf("spaces = %d, want 1", len(res.Msg.Spaces))
	}
	sp := res.Msg.Spaces[0]
	if !sp.OwnerDeleted {
		t.Error("the owner's deleted account was not marked")
	}
	if sp.OwnerUsername != "casey" {
		t.Errorf("owner username = %q, want the username that is left", sp.OwnerUsername)
	}
}
