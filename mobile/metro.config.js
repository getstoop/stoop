// Metro, set up to bundle the generated client from web/src/gen.
//
// Metro resolves a file's imports from the file's own folder upward, so
// web/src/gen/** would find @bufbuild/protobuf in web/node_modules and
// the bundle would carry two copies of the protobuf runtime, which fail
// in confusing ways. Every package resolves from mobile/node_modules
// instead, and nowhere else.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.resolve(projectRoot, "../web/src/gen")];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
