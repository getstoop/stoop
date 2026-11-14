const { withAndroidManifest } = require("expo/config-plugins");

// Per-machine signing settings, read from mobile/.env.local (gitignored).
//
// STOOP_IOS_BUNDLE_ID builds iOS under another bundle ID, so a developer
// build doesn't register org.getstoop.app to whichever Apple team signs
// it first. STOOP_APPLE_TEAM_ID picks the team Xcode signs with. Neither
// is a secret; both stay out of the repo because they belong to one
// developer's account.
//
// STOOP_ANDROID_CLEARTEXT=1 lets an Android release build speak plain
// HTTP, which only the debug manifests allow otherwise. make
// mobile-android-release sets it, so a release build on a developer's
// phone can reach the dev server; nothing else does.
module.exports = ({ config }) => {
  const next = {
    ...config,
    ios: {
      ...config.ios,
      bundleIdentifier:
        process.env.STOOP_IOS_BUNDLE_ID ?? config.ios.bundleIdentifier,
      ...(process.env.STOOP_APPLE_TEAM_ID && {
        appleTeamId: process.env.STOOP_APPLE_TEAM_ID,
      }),
    },
  };
  if (process.env.STOOP_ANDROID_CLEARTEXT !== "1") return next;
  return withAndroidManifest(next, (mod) => {
    mod.modResults.manifest.application[0].$["android:usesCleartextTraffic"] =
      "true";
    return mod;
  });
};
