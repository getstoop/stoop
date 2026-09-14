package files_test

import (
	"net/http"
	"testing"

	"connectrpc.com/connect"

	filesv1 "github.com/getstoop/stoop/gen/stoop/files/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// A download with a personal token follows the token's grant: a direct
// message's attachment needs dms.read, and a token limited to spaces never
// reaches one. Space attachments are chat's call (MayReadSpace), which
// already checks the credential.
func TestDownloadsFollowTheCredential(t *testing.T) {
	f := setup(t)
	token := func(bounded bool, grants ...authctx.Action) authctx.Identity {
		return authctx.Identity{UserID: f.member, Role: authctx.RoleMember, Credential: authctx.Credential{
			ID: "t", Kind: authctx.CredentialPersonalToken, Grants: grants, Bounded: bounded, Spaces: []string{f.space},
		}}
	}
	f.sess.users["member-messages"] = token(false, authctx.MessagesRead)
	f.sess.users["member-dms"] = token(false, authctx.MessagesRead, authctx.DMsRead)
	f.sess.users["member-limited"] = token(true, authctx.MessagesRead, authctx.DMsRead)

	// An attachment with no space: uploaded into a direct message.
	f.spaces.spaceID = ""
	status, body := f.upload(t, "member", f.spaces.channelID, "note.txt", []byte("hello"))
	if status != http.StatusCreated {
		t.Fatalf("upload: %d %v", status, body)
	}
	id := body["id"].(string)

	for user, want := range map[string]int{
		"member":          http.StatusOK, // the session, as before
		"member-dms":      http.StatusOK,
		"member-messages": http.StatusForbidden,
		"member-limited":  http.StatusForbidden,
	} {
		if res := f.get(t, id, user); res.StatusCode != want {
			t.Errorf("DM attachment as %s: %d, want %d", user, res.StatusCode, want)
		}
	}

	// Avatars are visible to any credential, as to any signed-in user.
	f.sess.users["member-nothing"] = token(true)
	avatar, err := f.svc.UploadAvatar(as(f.owner), connect.NewRequest(&filesv1.UploadAvatarRequest{Data: pngBytes(t, 50, 50)}))
	if err != nil {
		t.Fatal(err)
	}
	if res := f.get(t, avatar.Msg.FileId, "member-nothing"); res.StatusCode != http.StatusOK {
		t.Errorf("avatar with an empty token: %d", res.StatusCode)
	}
}
