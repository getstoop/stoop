const {
  withEntitlementsPlist,
  withInfoPlist,
} = require("expo/config-plugins");

// The one group the app shares with its notification service extension,
// "group.<bundle ID>": the push keys' keychain items and the shared
// store's files are both kept under it (modules/stoop-push-keys).
//
// An app group is also a keychain access group, so nothing is added to
// keychain-access-groups. That keeps one name instead of two, needs no
// team prefix (so a build without a team is the same build), and leaves
// the app's default keychain group alone: the first entry of
// keychain-access-groups is where every keychain write that names no
// group lands, and the session tokens expo-secure-store writes must
// stay in the app's own group, out of the extension's reach.
//
// The name follows the bundle ID, which a developer's machine may
// change (app.config.js), so this runs after that is settled. Native
// code reads the name from Info.plist (StoopAppGroup). The push
// entitlement itself (aps-environment) is the expo-notifications
// plugin's, with enableRemoteNotifications on (app.json).
const APP_GROUPS = "com.apple.security.application-groups";

function appGroup(config) {
  const bundle = config.ios?.bundleIdentifier;
  if (!bundle) throw new Error("withPushKeys: ios.bundleIdentifier is not set.");
  return `group.${bundle}`;
}

module.exports = (config) => {
  const withGroup = withEntitlementsPlist(config, (mod) => {
    const group = appGroup(mod);
    const had = mod.modResults[APP_GROUPS] ?? [];
    if (!had.includes(group)) mod.modResults[APP_GROUPS] = [...had, group];
    return mod;
  });
  return withInfoPlist(withGroup, (mod) => {
    mod.modResults.StoopAppGroup = appGroup(mod);
    return mod;
  });
};
