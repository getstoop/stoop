package webui

// Bridge is the version of the window.stoop contract the embedded web
// app speaks; GET /version publishes it so the desktop shell can tell
// when a server is newer than it knows. Bump it together with the
// declaration in web/src/api/platform.ts whenever the contract changes.
// docs/architecture/desktop.md.
const Bridge = 2
