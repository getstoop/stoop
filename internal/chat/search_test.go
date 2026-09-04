package chat_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

type denyAll struct{}

func (denyAll) Allow(string) bool { return false }

func TestSearchMessages(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	outsider := newUser(t, pool, "outsider", authctx.RoleMember)
	sp, _ := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	spaceID, general := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	garden, _ := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "garden"}))
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	// A second space the outsider owns, with the same words in it.
	other, _ := svc.CreateSpace(outsider, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Elsewhere"}))

	post := func(ctx context.Context, channelID, content string) string {
		t.Helper()
		res, err := svc.SendMessage(ctx, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: content}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message.Id
	}
	m1 := post(owner, general, "Restarted the LiveKit container at 3am")
	m2 := post(bea, general, "anyone else get a LiveKit token error?")
	m3 := post(bea, garden.Msg.Channel.Id, "tomatoes are in, LiveKit is not")
	post(outsider, other.Msg.DefaultChannel.Id, "LiveKit over here too")

	search := func(ctx context.Context, query string, beforeID string, limit int32) (*chatv1.SearchMessagesResponse, error) {
		res, err := svc.SearchMessages(ctx, connect.NewRequest(&chatv1.SearchMessagesRequest{
			Scope: &chatv1.SearchMessagesRequest_SpaceId{SpaceId: spaceID}, Query: query, BeforeId: beforeID, Limit: limit,
		}))
		if err != nil {
			return nil, err
		}
		return res.Msg, nil
	}
	ids := func(res *chatv1.SearchMessagesResponse) []string {
		out := make([]string, len(res.Messages))
		for i, m := range res.Messages {
			out[i] = m.Id
		}
		return out
	}

	// A word, newest first, only this space.
	res, err := search(bea, "livekit", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(res); fmt.Sprint(got) != fmt.Sprint([]string{m3, m2, m1}) || res.HasOlder {
		t.Errorf("livekit: got %v has_older=%v", got, res.HasOlder)
	}
	// Prefix on the last word; a phrase; negation.
	if res, _ = search(bea, "restart", "", 0); fmt.Sprint(ids(res)) != fmt.Sprint([]string{m1}) {
		t.Errorf("prefix: got %v", ids(res))
	}
	if res, _ = search(bea, `"token error"`, "", 0); fmt.Sprint(ids(res)) != fmt.Sprint([]string{m2}) {
		t.Errorf("phrase: got %v", ids(res))
	}
	if res, _ = search(bea, "livekit -token -tomatoes", "", 0); fmt.Sprint(ids(res)) != fmt.Sprint([]string{m1}) {
		t.Errorf("negation: got %v", ids(res))
	}
	// Filters.
	if res, _ = search(bea, "in:#garden livekit", "", 0); fmt.Sprint(ids(res)) != fmt.Sprint([]string{m3}) {
		t.Errorf("in: got %v", ids(res))
	}
	if res, _ = search(bea, "from:@Owner livekit", "", 0); fmt.Sprint(ids(res)) != fmt.Sprint([]string{m1}) {
		t.Errorf("from: got %v", ids(res))
	}
	if _, err := search(bea, "in:#nowhere livekit", "", 0); code(err) != connect.CodeNotFound {
		t.Errorf("unknown channel: %v", err)
	}
	if _, err := search(bea, "from:outsider livekit", "", 0); code(err) != connect.CodeNotFound {
		t.Errorf("non-member handle: %v", err)
	}
	// Paging by cursor: no gaps, no repeats.
	page1, _ := search(bea, "livekit", "", 2)
	if fmt.Sprint(ids(page1)) != fmt.Sprint([]string{m3, m2}) || !page1.HasOlder {
		t.Fatalf("page 1: %v has_older=%v", ids(page1), page1.HasOlder)
	}
	page2, _ := search(bea, "livekit", m2, 2)
	if fmt.Sprint(ids(page2)) != fmt.Sprint([]string{m1}) || page2.HasOlder {
		t.Errorf("page 2: %v has_older=%v", ids(page2), page2.HasOlder)
	}
	// Bad input.
	if _, err := search(bea, "   ", "", 0); code(err) != connect.CodeInvalidArgument {
		t.Errorf("empty: %v", err)
	}
	if _, err := search(bea, "from:bea", "", 0); code(err) != connect.CodeInvalidArgument {
		t.Errorf("filters only: %v", err)
	}
	if _, err := svc.SearchMessages(bea, connect.NewRequest(&chatv1.SearchMessagesRequest{Query: "x"})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("no scope: %v", err)
	}
	// Not a member.
	if _, err := search(outsider, "livekit", "", 0); code(err) != connect.CodePermissionDenied {
		t.Errorf("outsider: %v", err)
	}
	// Throttled.
	svc.UseSearchThrottle(denyAll{})
	if _, err := search(bea, "livekit", "", 0); code(err) != connect.CodeResourceExhausted {
		t.Errorf("throttled: %v", err)
	}
}
