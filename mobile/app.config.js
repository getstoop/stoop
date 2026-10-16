// Per-machine signing settings, read from mobile/.env.local (gitignored).
//
// STOOP_IOS_BUNDLE_ID builds iOS under another bundle ID, so a developer
// build doesn't register org.getstoop.app to whichever Apple team signs
// it first. STOOP_APPLE_TEAM_ID picks the team Xcode signs with. Neither
// is a secret; both stay out of the repo because they belong to one
// developer's account.
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    bundleIdentifier:
      process.env.STOOP_IOS_BUNDLE_ID ?? config.ios.bundleIdentifier,
    ...(process.env.STOOP_APPLE_TEAM_ID && {
      appleTeamId: process.env.STOOP_APPLE_TEAM_ID,
    }),
  },
});
