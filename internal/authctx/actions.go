package authctx

// Action is one entry in the closed vocabulary that roles hold and
// credentials are granted. See docs/proposals/access-model.md.
type Action string

// Actions on the instance, held by instance admins. Members also hold
// spaces.create when the instance allows it; chat applies that policy.
const (
	InstanceRead               Action = "instance.read"
	InstanceSettingsManage     Action = "instance.settings.manage"
	InstanceUsersManage        Action = "instance.users.manage"
	InstanceFilesManage        Action = "instance.files.manage"
	InstanceIntegrationsManage Action = "instance.integrations.manage"
	SpacesCreate               Action = "spaces.create"
	SpacesJoinAny              Action = "spaces.join_any"
	DMsReachAnyone             Action = "dms.reach_anyone"
)

// Actions on a space, held through a space role (internal/chat).
const (
	SpaceRead              Action = "space.read"
	MessagesRead           Action = "messages.read"
	MessagesPost           Action = "messages.post"
	MessagesNotifyEveryone Action = "messages.notify_everyone"
	MessagesModerate       Action = "messages.moderate"
	VoiceJoin              Action = "voice.join"
	InvitesCreate          Action = "invites.create"
	InvitesManage          Action = "invites.manage"
	ChannelsManage         Action = "channels.manage"
	MembersManage          Action = "members.manage"
	SpaceManage            Action = "space.manage"
	SpaceTransfer          Action = "space.transfer"
	SpaceDelete            Action = "space.delete"
)

// Actions on the caller's own account, held by everyone.
const (
	ProfileManage     Action = "profile.manage"
	PreferencesManage Action = "preferences.manage"
	ActivityRead      Action = "activity.read"
	DMsRead           Action = "dms.read"
	DMsPost           Action = "dms.post"
	// AccountSecurity is never grantable: only a session carries it.
	AccountSecurity Action = "account.security"
)

var descriptions = map[Action]string{
	InstanceRead:               "view this server's administration",
	InstanceSettingsManage:     "change this server's settings",
	InstanceUsersManage:        "manage accounts on this server",
	InstanceFilesManage:        "manage this server's file storage",
	InstanceIntegrationsManage: "manage integrations",
	SpacesCreate:               "create spaces",
	SpacesJoinAny:              "join a space without an invite",
	DMsReachAnyone:             "message people you don't share a space with",

	SpaceRead:              "see this space",
	MessagesRead:           "read messages",
	MessagesPost:           "post messages",
	MessagesNotifyEveryone: "mention everyone in this space",
	MessagesModerate:       "delete other people's messages",
	VoiceJoin:              "join voice",
	InvitesCreate:          "create invites for this space",
	InvitesManage:          "revoke other people's invites",
	ChannelsManage:         "manage channels in this space",
	MembersManage:          "manage members of this space",
	SpaceManage:            "change this space's settings",
	SpaceTransfer:          "transfer ownership of this space",
	SpaceDelete:            "delete this space",

	ProfileManage:     "change your profile",
	PreferencesManage: "change your preferences",
	ActivityRead:      "read your activity",
	DMsRead:           "read direct messages",
	DMsPost:           "send direct messages",
	AccountSecurity:   "change your password, linked accounts or tokens",
}

// Describe is the action in words, for a refusal.
func (a Action) Describe() string { return descriptions[a] }

// Known reports whether a is in the vocabulary.
func (a Action) Known() bool { _, ok := descriptions[a]; return ok }

// Grantable reports whether a credential other than a session may carry a.
func (a Action) Grantable() bool { return a.Known() && a != AccountSecurity }

var instanceAdminActions = map[Action]bool{
	InstanceRead: true, InstanceSettingsManage: true, InstanceUsersManage: true,
	InstanceFilesManage: true, InstanceIntegrationsManage: true,
	SpacesCreate: true, SpacesJoinAny: true, DMsReachAnyone: true,
}

var ownActions = map[Action]bool{
	ProfileManage: true, PreferencesManage: true, ActivityRead: true,
	DMsRead: true, DMsPost: true, AccountSecurity: true,
}

// RoleHolds is the identity gate for actions on the instance or on the
// caller's own account. Space actions are answered by chat.
func RoleHolds(r Role, a Action) bool {
	return ownActions[a] || (r == RoleAdmin && instanceAdminActions[a])
}
