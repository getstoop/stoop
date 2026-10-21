// Metro, set up to bundle the code shared from web: the generated client
// in web/src/gen and the browser-free helpers in web/src/core.
//
// Metro resolves a file's imports from the file's own folder upward, so
// web/src/** would find @bufbuild/protobuf in web/node_modules and
// the bundle would carry two copies of the protobuf runtime, which fail
// in confusing ways. Every package resolves from mobile/node_modules
// instead, and nowhere else.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  path.resolve(projectRoot, "../web/src/gen"),
  path.resolve(projectRoot, "../web/src/core"),
];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
