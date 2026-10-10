package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

func channelsOf(t *testing.T, pool *pgxpool.Pool, ctx context.Context) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT c.name FROM channel_members cm JOIN channels c ON c.id = cm.channel_id
		 WHERE cm.user_id = $1 ORDER BY c.name`, authctx.UserID(ctx))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	return names
}

// A new space's first channel is its default and required, and everyone
// who joins the space, by any path, is in its required channels and no
// others.
func TestJoiningASpaceJoinsItsRequiredChannels(t *testing.T) {
	pool, _, svc := newTestService(t)
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	invited := newUser(t, pool, "invited", authctx.RoleMember)
	added := newUser(t, pool, "added", authctx.RoleMember)
	operator := newUser(t, pool, "operator", authctx.RoleAdmin)

	created, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := created.Msg.Space.Id
	if created.Msg.Space.DefaultChannelId != created.Msg.DefaultChannel.Id {
		t.Errorf("default channel = %q, want the first channel %q", created.Msg.Space.DefaultChannelId, created.Msg.DefaultChannel.Id)
	}
	if _, err := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "garden"})); err != nil {
		t.Fatal(err)
	}

	invite, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(invited, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AddMember(operator, connect.NewRequest(&chatv1.AddMemberRequest{SpaceId: spaceID, UserId: authctx.UserID(added)})); err != nil {
		t.Fatal(err)
	}
	// An instance admin joins without an invite.
	if _, err := svc.JoinSpace(operator, connect.NewRequest(&chatv1.JoinSpaceRequest{SpaceId: spaceID})); err != nil {
		t.Fatal(err)
	}

	for name, who := range map[string]context.Context{"invited": invited, "added": added, "operator": operator} {
		if names := channelsOf(t, pool, who); len(names) != 1 || names[0] != "general" {
			t.Errorf("%s is in %v, want [general]", name, names)
		}
	}
	// The owner made #garden, so is in it.
	if names := channelsOf(t, pool, owner); len(names) != 2 {
		t.Errorf("owner is in %v, want [garden general]", names)
	}

	if _, err := svc.KickMember(owner, connect.NewRequest(&chatv1.KickMemberRequest{SpaceId: spaceID, UserId: authctx.UserID(invited)})); err != nil {
		t.Fatal(err)
	}
	if names := channelsOf(t, pool, invited); len(names) != 0 {
		t.Errorf("after a kick they are still in %v", names)
	}
}
