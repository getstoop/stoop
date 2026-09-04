import { useEffect } from "react";
import { useLayoutStore } from "../stores/layout";

// The scrim over the content while the navigation drawer is open on a
// narrow screen: a tap or Escape closes it. display: none on a wide
// screen, where the drawer is a fixed sidebar (see MenuButton).
export function NavBackdrop() {
  const open = useLayoutStore((s) => s.drawerOpen);
  const close = useLayoutStore((s) => s.closeDrawer);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);
  if (!open) return null;
  return (
    <button
      type="button"
      className="nav-backdrop"
      onClick={close}
      aria-label="Close navigation"
      tabIndex={-1}
    />
  );
}
