// The app's entry: LiveKit's WebRTC globals first, then Expo Router.
//
// registerGlobals() also replaces the app-wide URL and URLSearchParams
// with a polyfill. The app keeps Expo's, which are already installed by
// the time this module runs, so both are put back before anything else
// loads.
const expoURL = globalThis.URL;
const expoURLSearchParams = globalThis.URLSearchParams;

const { registerGlobals } = require("@livekit/react-native");
registerGlobals();

globalThis.URL = expoURL;
globalThis.URLSearchParams = expoURLSearchParams;

require("expo-router/entry");
