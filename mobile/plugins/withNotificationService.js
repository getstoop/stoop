const fs = require("node:fs");
const path = require("node:path");
const { withXcodeProject } = require("expo/config-plugins");

// The notification service extension: a second target in the generated
// Xcode project, which decrypts a push and writes its notification
// (extensions/notification-service). mobile/ios is generated, so the
// target, its Info.plist and its entitlements are made here on every
// prebuild; the Swift stays in the repo and the project points at it
// where it lies, so editing it needs a build, not a prebuild.
//
// Everything is named after the app's bundle ID, which a developer's
// machine may change (app.config.js), so this runs after that is
// settled, as withPushKeys does:
//   bundle ID   <app>.NotificationService
//   app group   group.<app>, the app's own (withPushKeys.js): the push
//               keys' keychain items and the shared store are under it
//
// The extension is signed for the app group alone. It has no
// keychain-access-groups, and reads the keys by naming the group. With
// no team set (the simulator, CI) the target has none either, and
// builds as the app does.
const TARGET = "StoopNotificationService";
const SOURCE_ROOT = "extensions/notification-service";
// The pure logic, which the Swift package there tests, and what only
// the extension can compile.
const SOURCE_DIRS = ["Sources/StoopPush", "Extension"];

const escape = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A property list of strings, arrays and dictionaries.
function plistValue(value, indent) {
  if (typeof value === "string") return `${indent}<string>${escape(value)}</string>\n`;
  if (Array.isArray(value)) {
    const items = value.map((item) => plistValue(item, `${indent}\t`)).join("");
    return `${indent}<array>\n${items}${indent}</array>\n`;
  }
  const entries = Object.entries(value)
    .map(([key, entry]) => `${indent}\t<key>${escape(key)}</key>\n${plistValue(entry, `${indent}\t`)}`)
    .join("");
  return `${indent}<dict>\n${entries}${indent}</dict>\n`;
}

function plist(value) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    `<plist version="1.0">\n${plistValue(value, "")}</plist>\n`
  );
}

// Written only when it would change, so a second prebuild leaves the
// files as they were.
function writeFile(file, text) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return;
  fs.writeFileSync(file, text);
}

// The extension's target in a project that already has one. Its name
// is quoted until the project has been written and read back.
function existingTarget(project) {
  for (const [uuid, nativeTarget] of Object.entries(project.pbxNativeTargetSection())) {
    if (typeof nativeTarget !== "object") continue;
    if (String(nativeTarget.name).replace(/"/g, "") === TARGET) return { uuid, nativeTarget };
  }
  return null;
}

module.exports = (config) =>
  withXcodeProject(config, (mod) => {
    const app = mod.ios?.bundleIdentifier;
    if (!app) throw new Error("withNotificationService: ios.bundleIdentifier is not set.");
    const appGroup = `group.${app}`;
    const project = mod.modResults;
    const dir = path.join(mod.modRequest.platformProjectRoot, TARGET);
    fs.mkdirSync(dir, { recursive: true });

    writeFile(
      path.join(dir, "Info.plist"),
      plist({
        CFBundleDevelopmentRegion: "$(DEVELOPMENT_LANGUAGE)",
        CFBundleDisplayName: "Stoop",
        CFBundleExecutable: "$(EXECUTABLE_NAME)",
        CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
        CFBundleInfoDictionaryVersion: "6.0",
        CFBundleName: "$(PRODUCT_NAME)",
        CFBundlePackageType: "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
        // An extension's versions must match its app's, which Expo
        // writes into the app's Info.plist as literals from the config
        // (not MARKETING_VERSION, which stays 1.0).
        CFBundleShortVersionString: mod.version ?? "1.0.0",
        CFBundleVersion: mod.ios?.buildNumber ?? "1",
        NSExtension: {
          NSExtensionPointIdentifier: "com.apple.usernotifications.service",
          NSExtensionPrincipalClass: "$(PRODUCT_MODULE_NAME).NotificationService",
        },
        // The extension's own copy of the name the app's Info.plist
        // carries: a bundle reads only its own.
        StoopAppGroup: appGroup,
      }),
    );
    writeFile(
      path.join(dir, `${TARGET}.entitlements`),
      plist({ "com.apple.security.application-groups": [appGroup] }),
    );

    // Made once. On a project that already has it (a prebuild without
    // --clean) only its settings below are brought up to date: its list
    // of Swift files is left as it was, so a new file needs
    // make mobile-prebuild, which starts clean.
    let target = existingTarget(project);
    if (!target) {
      // The xcode library adds a target's dependency only into sections
      // that exist, and a fresh template has neither.
      const objects = project.hash.project.objects;
      objects.PBXTargetDependency = objects.PBXTargetDependency || {};
      objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};

      // Also adds a copy phase to the app that embeds the .appex, and
      // makes the app depend on the target.
      const made = project.addTarget(TARGET, "app_extension", TARGET, `${app}.NotificationService`);

      // Every Swift file of the source folders, where the repo keeps them.
      const main = project.getFirstProject().firstProject.mainGroup;
      const sources = [];
      for (const sourceDir of SOURCE_DIRS) {
        const folder = path.join(mod.modRequest.projectRoot, SOURCE_ROOT, sourceDir);
        const files = fs
          .readdirSync(folder)
          .filter((file) => file.endsWith(".swift"))
          .sort();
        // Quoted: the path has a hyphen in it.
        const group = project.addPbxGroup(files, `${TARGET}${path.basename(sourceDir)}`, `"../${SOURCE_ROOT}/${sourceDir}"`);
        project.addToPbxGroup(group.uuid, main);
        sources.push(...files);
      }
      const generated = project.addPbxGroup(["Info.plist", `${TARGET}.entitlements`], `${TARGET}Generated`, TARGET);
      project.addToPbxGroup(generated.uuid, main);

      project.addBuildPhase(sources, "PBXSourcesBuildPhase", "Sources", made.uuid);
      project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", made.uuid);
      project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", made.uuid);
      target = { uuid: made.uuid, nativeTarget: made.pbxNativeTarget };
    }

    // The app's own settings, read off its first configuration, so the
    // two never drift.
    const appTarget = project.getFirstTarget().firstTarget;
    const configurations = project.pbxXCBuildConfigurationSection();
    const lists = project.pbxXCConfigurationList();
    const appSettings = configurations[lists[appTarget.buildConfigurationList].buildConfigurations[0].value].buildSettings;

    const team = mod.ios?.appleTeamId;
    for (const { value } of lists[target.nativeTarget.buildConfigurationList].buildConfigurations) {
      Object.assign(configurations[value].buildSettings, {
        INFOPLIST_FILE: `${TARGET}/Info.plist`,
        CODE_SIGN_ENTITLEMENTS: `${TARGET}/${TARGET}.entitlements`,
        CODE_SIGN_STYLE: "Automatic",
        GENERATE_INFOPLIST_FILE: "NO",
        SWIFT_VERSION: "5.0",
        TARGETED_DEVICE_FAMILY: appSettings.TARGETED_DEVICE_FAMILY ?? '"1,2"',
        IPHONEOS_DEPLOYMENT_TARGET: appSettings.IPHONEOS_DEPLOYMENT_TARGET ?? "16.4",
        MARKETING_VERSION: appSettings.MARKETING_VERSION ?? "1.0",
        CURRENT_PROJECT_VERSION: appSettings.CURRENT_PROJECT_VERSION ?? "1",
        APPLICATION_EXTENSION_API_ONLY: "YES",
        PRODUCT_BUNDLE_IDENTIFIER: `"${app}.NotificationService"`,
      });
      const settings = configurations[value].buildSettings;
      if (team) settings.DEVELOPMENT_TEAM = team;
      else delete settings.DEVELOPMENT_TEAM;
    }
    project.addTargetAttribute("ProvisioningStyle", "Automatic", target);
    if (team) project.addTargetAttribute("DevelopmentTeam", team, target);
    else project.removeTargetAttribute("DevelopmentTeam", target);
    return mod;
  });
