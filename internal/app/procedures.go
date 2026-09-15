package app

import (
	"github.com/getstoop/stoop/gen/stoop/auth/v1/authv1connect"
	"github.com/getstoop/stoop/gen/stoop/chat/v1/chatv1connect"
	"github.com/getstoop/stoop/gen/stoop/files/v1/filesv1connect"
	"github.com/getstoop/stoop/gen/stoop/instance/v1/instancev1connect"
	"github.com/getstoop/stoop/gen/stoop/integrations/v1/integrationsv1connect"
	"github.com/getstoop/stoop/gen/stoop/voice/v1/voicev1connect"
	"github.com/getstoop/stoop/internal/authctx"
)

var (
	public    = authctx.Rule{Public: true}
	anyCaller = authctx.Rule{}
)

func needs(a ...authctx.Action) authctx.Rule { return authctx.Rule{AnyOf: a} }

// procedures classifies every Connect procedure for the credential gate. A
// procedure serving both space channels and direct messages lists both
// actions; the handler narrows to one once it knows which. The identity
// gate stays in the owning module. procedures_test.go fails on any
// procedure missing here.
var procedures = map[string]authctx.Rule{
	authv1connect.AuthServiceRegisterProcedure:            public,
	authv1connect.AuthServiceLoginProcedure:               public,
	authv1connect.AuthServiceLogoutProcedure:              anyCaller,
	authv1connect.AuthServiceGetMeProcedure:               anyCaller,
	authv1connect.AuthServiceGetUserProfileProcedure:      anyCaller,
	authv1connect.AuthServiceUpdateProfileProcedure:       needs(authctx.ProfileManage),
	authv1connect.AuthServiceSetDoNotDisturbProcedure:     needs(authctx.ProfileManage),
	authv1connect.AuthServiceChangePasswordProcedure:      needs(authctx.AccountSecurity),
	authv1connect.AuthServiceListIdentitiesProcedure:      needs(authctx.AccountSecurity),
	authv1connect.AuthServiceUnlinkIdentityProcedure:      needs(authctx.AccountSecurity),
	authv1connect.AuthServiceCreatePersonalTokenProcedure: needs(authctx.AccountSecurity),
	authv1connect.AuthServiceListPersonalTokensProcedure:  needs(authctx.AccountSecurity),
	authv1connect.AuthServiceRevokePersonalTokenProcedure: needs(authctx.AccountSecurity),

	// The setup and login screens need it before anyone has an account.
	instancev1connect.InstanceServiceGetInstanceStatusProcedure:    public,
	instancev1connect.InstanceServiceGetBuildInfoProcedure:         needs(authctx.InstanceRead),
	instancev1connect.InstanceServiceListUsersProcedure:            needs(authctx.InstanceRead),
	instancev1connect.InstanceServiceGetReachabilityProcedure:      needs(authctx.InstanceRead),
	instancev1connect.InstanceServiceGetLoginProvidersProcedure:    needs(authctx.InstanceRead),
	instancev1connect.InstanceServiceUpdateSettingsProcedure:       needs(authctx.InstanceSettingsManage),
	instancev1connect.InstanceServiceUpdateReachabilityProcedure:   needs(authctx.InstanceSettingsManage),
	instancev1connect.InstanceServiceUpdateLoginProvidersProcedure: needs(authctx.InstanceSettingsManage),
	instancev1connect.InstanceServiceSetUserRoleProcedure:          needs(authctx.InstanceUsersManage),
	instancev1connect.InstanceServiceSetUserActiveProcedure:        needs(authctx.InstanceUsersManage),
	instancev1connect.InstanceServiceResetUserPasswordProcedure:    needs(authctx.InstanceUsersManage),
	instancev1connect.InstanceServiceRenameUserProcedure:           needs(authctx.InstanceUsersManage),
	instancev1connect.InstanceServiceSetUsernameFrozenProcedure:    needs(authctx.InstanceUsersManage),
	instancev1connect.InstanceServiceClearUserProfileProcedure:     needs(authctx.InstanceUsersManage),
	instancev1connect.InstanceServiceListUserTokensProcedure:       needs(authctx.InstanceUsersManage),
	instancev1connect.InstanceServiceRevokeUserTokenProcedure:      needs(authctx.InstanceUsersManage),

	// Members read a space's hooks; the handler requires
	// instance.integrations.manage for the server-wide list.
	integrationsv1connect.IntegrationServiceListWebhooksProcedure:       needs(authctx.SpaceRead),
	integrationsv1connect.IntegrationServiceCreateIncomingProcedure:     needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceCreateOutgoingProcedure:     needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceUpdateIncomingProcedure:     needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceUpdateOutgoingProcedure:     needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceDeleteWebhookProcedure:      needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceRotateSecretProcedure:       needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceTestWebhookProcedure:        needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceListDeliveriesProcedure:     needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceRedeliverDeliveryProcedure:  needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceListBotsProcedure:           needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceCreateBotProcedure:          needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceUpdateBotProcedure:          needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceAddBotToSpaceProcedure:      needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceRemoveBotFromSpaceProcedure: needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceDeactivateBotProcedure:      needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceCreateBotTokenProcedure:     needs(authctx.InstanceIntegrationsManage),
	integrationsv1connect.IntegrationServiceRevokeBotTokenProcedure:     needs(authctx.InstanceIntegrationsManage),

	filesv1connect.FileServiceUploadAvatarProcedure:    needs(authctx.ProfileManage),
	filesv1connect.FileServiceUploadBotAvatarProcedure: needs(authctx.InstanceIntegrationsManage),
	filesv1connect.FileServiceUploadSpaceIconProcedure: needs(authctx.SpaceManage),
	filesv1connect.FileServiceGetStorageUsageProcedure: needs(authctx.InstanceRead),
	filesv1connect.FileServiceSweepFilesProcedure:      needs(authctx.InstanceFilesManage),

	voicev1connect.VoiceServiceJoinVoiceChannelProcedure: needs(authctx.VoiceJoin),

	chatv1connect.ChatServiceCreateSpaceProcedure: needs(authctx.SpacesCreate),
	chatv1connect.ChatServiceListSpacesProcedure:  anyCaller,
	chatv1connect.ChatServiceGetSpaceProcedure:    needs(authctx.SpaceRead),
	// By invite for anyone; by space id only with spaces.join_any, which
	// the handler checks.
	chatv1connect.ChatServiceJoinSpaceProcedure:         anyCaller,
	chatv1connect.ChatServiceLeaveSpaceProcedure:        needs(authctx.PreferencesManage),
	chatv1connect.ChatServiceUpdateSpaceProcedure:       needs(authctx.SpaceManage),
	chatv1connect.ChatServiceTransferOwnershipProcedure: needs(authctx.SpaceTransfer),
	chatv1connect.ChatServiceDeleteSpaceProcedure:       needs(authctx.SpaceDelete),

	chatv1connect.ChatServiceCreateInviteProcedure: needs(authctx.InvitesCreate),
	chatv1connect.ChatServiceListInvitesProcedure:  needs(authctx.InvitesCreate),
	chatv1connect.ChatServiceRevokeInviteProcedure: needs(authctx.InvitesCreate),
	// An invited stranger sees the space behind their code before they
	// have an account to see it with.
	chatv1connect.ChatServiceLookupInviteProcedure: public,

	chatv1connect.ChatServiceGetMemberProcedure:     needs(authctx.SpaceRead),
	chatv1connect.ChatServiceListMembersProcedure:   needs(authctx.SpaceRead),
	chatv1connect.ChatServiceSetMemberRoleProcedure: needs(authctx.MembersManage),
	chatv1connect.ChatServiceKickMemberProcedure:    needs(authctx.MembersManage),
	chatv1connect.ChatServiceAddMemberProcedure:     needs(authctx.MembersManage),
	chatv1connect.ChatServiceBanMemberProcedure:     needs(authctx.MembersManage),
	chatv1connect.ChatServiceUnbanMemberProcedure:   needs(authctx.MembersManage),
	chatv1connect.ChatServiceListBansProcedure:      needs(authctx.MembersManage),

	chatv1connect.ChatServiceBlockUserProcedure:        needs(authctx.PreferencesManage),
	chatv1connect.ChatServiceUnblockUserProcedure:      needs(authctx.PreferencesManage),
	chatv1connect.ChatServiceListBlockedUsersProcedure: needs(authctx.PreferencesManage),
	chatv1connect.ChatServiceSetChannelMutedProcedure:  needs(authctx.PreferencesManage),
	chatv1connect.ChatServiceSetSpaceMutedProcedure:    needs(authctx.PreferencesManage),
	chatv1connect.ChatServiceMarkChannelReadProcedure:  needs(authctx.PreferencesManage),

	chatv1connect.ChatServiceCreateChannelProcedure:    needs(authctx.ChannelsManage),
	chatv1connect.ChatServiceListChannelsProcedure:     needs(authctx.SpaceRead),
	chatv1connect.ChatServiceUpdateChannelProcedure:    needs(authctx.ChannelsManage),
	chatv1connect.ChatServiceDeleteChannelProcedure:    needs(authctx.ChannelsManage),
	chatv1connect.ChatServiceReorderChannelsProcedure:  needs(authctx.ChannelsManage),
	chatv1connect.ChatServiceSetMessagePinnedProcedure: needs(authctx.ChannelsManage),

	chatv1connect.ChatServiceSendMessageProcedure:        needs(authctx.MessagesPost, authctx.DMsPost),
	chatv1connect.ChatServiceEditMessageProcedure:        needs(authctx.MessagesPost, authctx.DMsPost),
	chatv1connect.ChatServiceDeleteMessageProcedure:      needs(authctx.MessagesPost, authctx.DMsPost),
	chatv1connect.ChatServiceToggleReactionProcedure:     needs(authctx.MessagesPost, authctx.DMsPost),
	chatv1connect.ChatServiceListMessagesProcedure:       needs(authctx.MessagesRead, authctx.DMsRead),
	chatv1connect.ChatServiceListPinnedMessagesProcedure: needs(authctx.MessagesRead, authctx.DMsRead),
	chatv1connect.ChatServiceSearchMessagesProcedure:     needs(authctx.MessagesRead),

	chatv1connect.ChatServiceOpenDirectMessageProcedure:           needs(authctx.DMsPost),
	chatv1connect.ChatServiceListDirectMessagesProcedure:          needs(authctx.DMsRead),
	chatv1connect.ChatServiceListDirectMessageCandidatesProcedure: needs(authctx.DMsRead),

	chatv1connect.ChatServiceListActivityProcedure:     needs(authctx.ActivityRead),
	chatv1connect.ChatServiceMarkActivityReadProcedure: needs(authctx.ActivityRead),
}
