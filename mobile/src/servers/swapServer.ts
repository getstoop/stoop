import type { NativeStackNavigationProp } from "expo-router";

export type ServerNavigation = NativeStackNavigationProp<{}>;

// The root stack and the server's screen in it, found from anywhere
// under it.
function serverScreen(navigation: ServerNavigation) {
  let nav: ServerNavigation | undefined = navigation;
  while (nav) {
    const state = nav.getState();
    const route = state?.routes.filter((r) => r.name === "s/[id]").pop();
    if (state && route) return { nav, state, route };
    nav = nav.getParent<ServerNavigation>();
  }
}

// Swaps the server on screen for another, from anywhere under the root
// stack: a plain stack replace aimed at the server's screen, which opens
// on its Spaces tab. expo-router's own replace to /s/<id> stays inside
// the old server (src/app/index.tsx).
export function swapServer(navigation: ServerNavigation, id: string) {
  const found = serverScreen(navigation);
  if (!found) return;
  found.nav.dispatch({
    type: "REPLACE",
    payload: { name: "s/[id]", params: { id } },
    source: found.route.key,
    target: found.state.key,
  });
}

// Closes whatever the root stack holds over the server's screen (the
// switcher's sheet, a sign-in, Theme), so that what is pushed next
// opens on the server and not inside a sheet.
export function backToServer(navigation: ServerNavigation) {
  const found = serverScreen(navigation);
  if (!found) return;
  // Counted from the screen in front (a route past it isn't over
  // anything) and popped from it: a screen's navigation would otherwise
  // name its own screen as where the pop starts.
  const { index, routes, key } = found.state;
  const over = index - routes.lastIndexOf(found.route);
  if (over > 0) found.nav.dispatch({ type: "POP", payload: { count: over }, source: routes[index].key, target: key });
}
