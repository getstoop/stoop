import { useRouter, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useNarrowScreen } from "../../hooks/useNarrowScreen";
import {
  type OpenPanel,
  takeOpener,
  useSidePanelStore,
} from "../../stores/sidePanel";
import { SidePanelControls } from "./context";
import { panelFromLink } from "./links";
import { useNarrowHistory } from "./narrowHistory";
import { type PanelRegistry, panels } from "./registry";

export { SidePanelFrame } from "./SidePanelFrame";
export { SidePanelUnavailable } from "./SidePanelUnavailable";

// The right-hand side panel, beside whatever page is showing (AppShell
// renders it after the route). It shows one kind of content at a time,
// from the registry; docs/architecture/web.md → The side panel.
export function SidePanel({ registry = panels }: { registry?: PanelRegistry }) {
  const open = useSidePanelStore((s) => s.open);
  const show = useSidePanelStore((s) => s.show);
  const storeClose = useSidePanelStore((s) => s.close);
  const close = useNarrowHistory(open);
  const router = useRouter();
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // A link that names a panel opens it once, then leaves the address.
  useEffect(() => {
    const found = panelFromLink(search, registry);
    if (!found) return;
    show(found.panel);
    const { pathname, hash } = router.history.location;
    router.history.replace(
      `${pathname}${found.search}${hash}`,
      router.history.location.state,
    );
  }, [search, registry, show, router]);

  const definition = open ? registry[open.kind] : undefined;

  // A saved panel of a kind this build doesn't know shows nothing.
  useEffect(() => {
    if (open && !definition) storeClose();
  }, [open, definition, storeClose]);

  // Focus goes back where it was when the panel closes.
  useEffect(() => {
    if (open) return;
    const opener = takeOpener();
    if (opener?.isConnected) opener.focus();
  }, [open]);

  // What is on screen: the open panel, or the one that just closed while
  // it animates out. Kept during render, so a new panel shows at once.
  const [last, setLast] = useState<OpenPanel | null>(open);
  // Whether what is shown came from closed (it slides in) or replaced
  // other content (it doesn't).
  const [entering, setEntering] = useState(true);
  if (open && open !== last) {
    setEntering(last === null);
    setLast(open);
  }
  const shown = open ?? last;
  const leaving = !open && last !== null;
  const left = useCallback(() => setLast(null), []);
  // With reduced motion there is no animation to wait for; and if one
  // never reports its end, it still doesn't stay on screen.
  useEffect(() => {
    if (!leaving) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      left();
      return;
    }
    const timer = setTimeout(left, LEAVE_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [leaving, left]);

  // On a narrow screen the panel covers the page, so the page behind it
  // leaves the tab order and the accessibility tree. The rail and sidebar
  // stay: they are the drawer, which opens over the panel.
  const narrow = useNarrowScreen();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page brings new elements to make inert
  useEffect(() => {
    if (!shown || !narrow) return;
    const behind = [
      ...document.querySelectorAll<HTMLElement>(".app-shell > *"),
    ].filter(
      (el) =>
        !el.matches(
          ".space-rail, .channel-sidebar, .nav-backdrop, .side-panel",
        ),
    );
    for (const el of behind) el.inert = true;
    return () => {
      for (const el of behind) el.inert = false;
    };
  }, [shown, narrow, pathname]);

  const showing = shown ? registry[shown.kind] : undefined;
  if (!shown || !showing) return null;
  const Content = showing.component;
  return (
    <SidePanelControls.Provider value={{ close, leaving, left, entering }}>
      <Content key={JSON.stringify(shown)} params={shown.params} />
    </SidePanelControls.Provider>
  );
}

// Longer than the exit animation (--dur, 180ms) by a margin.
const LEAVE_FALLBACK_MS = 500;
