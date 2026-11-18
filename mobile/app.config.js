const fs = require("node:fs");
const path = require("node:path");
const {
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");
const withNotificationService = require("./plugins/withNotificationService");
const withPushKeys = require("./plugins/withPushKeys");

// R8 rules a release build needs on top of the template's, written into
// the generated android/app/proguard-rules.pro.
//
// LiveKit's WebRTC library keeps livekit.org.jni_zero.JniZero, whose
// setJniClassLoader names a JniZeroJni class the library does not ship.
// R8 stops a release build on the missing class; this is the rule it
// asks for.
const PROGUARD_RULES = ["-dontwarn livekit.org.jni_zero.JniZeroJni"];

const withProguardRules = (config) =>
  withDangerousMod(config, [
    "android",
    (mod) => {
      const file = path.join(
        mod.modRequest.platformProjectRoot,
        "app",
        "proguard-rules.pro",
      );
      const had = fs.readFileSync(file, "utf8");
      const missing = PROGUARD_RULES.filter((rule) => !had.includes(rule));
      if (missing.length > 0) {
        fs.writeFileSync(file, `${had.trimEnd()}\n\n${missing.join("\n")}\n`);
      }
      return mod;
    },
  ]);

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
  // withPushKeys names the app group after the bundle ID, so it goes on
  // once that is settled.
  const next = withPushKeys(
    withProguardRules({
      ...config,
      ios: {
        ...config.ios,
        bundleIdentifier:
          process.env.STOOP_IOS_BUNDLE_ID ?? config.ios.bundleIdentifier,
        ...(process.env.STOOP_APPLE_TEAM_ID && {
          appleTeamId: process.env.STOOP_APPLE_TEAM_ID,
        }),
      },
    }),
  );
  // The notification service extension is named after the bundle ID
  // too, and shares the app group withPushKeys set up.
  const built = withNotificationService(next);
  if (process.env.STOOP_ANDROID_CLEARTEXT !== "1") return built;
  return withAndroidManifest(built, (mod) => {
    mod.modResults.manifest.application[0].$["android:usesCleartextTraffic"] =
      "true";
    return mod;
  });
};
