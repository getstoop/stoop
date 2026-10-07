import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { takeOpener, useSidePanelStore } from "../../stores/sidePanel";
import { SidePanelClose } from "./context";
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

  if (!open || !definition) return null;
  const Content = definition.component;
  return (
    <SidePanelClose.Provider value={close}>
      <Content key={JSON.stringify(open)} params={open.params} />
    </SidePanelClose.Provider>
  );
}
