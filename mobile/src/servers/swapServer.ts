import type { NativeStackNavigationProp } from "expo-router";

export type ServerNavigation = NativeStackNavigationProp<{}>;

// Swaps the server on screen for another, from anywhere under the root
// stack: a plain stack replace aimed at the server's screen, which opens
// on its Spaces tab. expo-router's own replace to /s/<id> stays inside
// the old server (src/app/index.tsx).
export function swapServer(navigation: ServerNavigation, id: string) {
  let nav: ServerNavigation | undefined = navigation;
  while (nav) {
    const state = nav.getState();
    const route = state?.routes.filter((r) => r.name === "s/[id]").pop();
    if (state && route) {
      nav.dispatch({
        type: "REPLACE",
        payload: { name: "s/[id]", params: { id } },
        source: route.key,
        target: state.key,
      });
      return;
    }
    nav = nav.getParent<ServerNavigation>();
  }
}
