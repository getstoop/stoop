package files_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/getstoop/stoop/internal/authctx"
)

// A private channel's attachment is served to its people and its
// uploader, and to nobody else in the space: not a member outside the
// channel, and not a server admin.
func TestPrivateChannelAttachmentDownloads(t *testing.T) {
	fixture := setup(t)
	private := uuid.NewString()
	if _, err := fixture.pool.Exec(context.Background(),
		"INSERT INTO channels (id, space_id, name, private) VALUES ($1, $2, 'secret', true)", private, fixture.space); err != nil {
		t.Fatal(err)
	}
	fixture.spaces.privateChannelID = private
	fixture.spaces.privateMembers = map[string]bool{fixture.owner: true}
	fixture.spaces.members[fixture.other] = true
	token := func(credential authctx.Credential) authctx.Identity {
		credential.ID, credential.Kind = "t", authctx.CredentialPersonalToken
		return authctx.Identity{UserID: fixture.member, Role: authctx.RoleMember, Credential: credential}
	}
	read := []authctx.Action{authctx.MessagesRead}
	fixture.sess.users["no-messages"] = token(authctx.Credential{Grants: []authctx.Action{authctx.DMsRead}})
	fixture.sess.users["whole-account"] = token(authctx.Credential{Grants: read})
	fixture.sess.users["this-space"] = token(authctx.Credential{Grants: read, Bounded: true, Spaces: []string{fixture.space}})
	fixture.sess.users["this-channel"] = token(authctx.Credential{Grants: read, Bounded: true, Channels: []string{private}})
	fixture.sess.users["elsewhere"] = token(authctx.Credential{Grants: read, Bounded: true, Spaces: []string{uuid.NewString()}})

	status, body := fixture.upload(t, "owner", private, "flyer.txt", []byte("the 24th"))
	if status != http.StatusCreated {
		t.Fatalf("upload: %d %v", status, body)
	}
	id := body["id"].(string)
	var recorded *string
	if err := fixture.pool.QueryRow(context.Background(), "SELECT private_channel_id::text FROM files WHERE id = $1", id).Scan(&recorded); err != nil {
		t.Fatal(err)
	}
	if recorded == nil || *recorded != private {
		t.Fatalf("the upload did not record its private channel: %v", recorded)
	}

	for user, want := range map[string]int{
		"owner":  http.StatusOK,        // in the channel, and the uploader
		"member": http.StatusForbidden, // in the space, not the channel
		"other":  http.StatusForbidden,
		"admin":  http.StatusForbidden, // no inherited read
	} {
		if res := fixture.get(t, id, user); res.StatusCode != want {
			t.Errorf("private attachment as %s: %d, want %d", user, res.StatusCode, want)
		}
	}

	// The uploader keeps their own file after leaving the channel; someone
	// added to it can read it, with a session or with a token that grants
	// messages.read and reaches the channel.
	fixture.spaces.privateMembers = map[string]bool{fixture.member: true}
	for user, want := range map[string]int{
		"owner":         http.StatusOK,
		"member":        http.StatusOK,
		"whole-account": http.StatusOK,
		"this-space":    http.StatusOK,
		"this-channel":  http.StatusOK,
		"elsewhere":     http.StatusForbidden, // bounded to another space
		"no-messages":   http.StatusForbidden, // no messages.read
	} {
		if res := fixture.get(t, id, user); res.StatusCode != want {
			t.Errorf("after the people changed, as %s: %d, want %d", user, res.StatusCode, want)
		}
	}

	// A public channel's upload records nothing and is served by space.
	status, body = fixture.upload(t, "owner", fixture.spaces.channelID, "note.txt", []byte("hello"))
	if status != http.StatusCreated {
		t.Fatalf("public upload: %d %v", status, body)
	}
	if res := fixture.get(t, body["id"].(string), "member"); res.StatusCode != http.StatusOK {
		t.Errorf("public attachment as a space member: %d", res.StatusCode)
	}
}
