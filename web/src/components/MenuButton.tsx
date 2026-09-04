import type { MouseEvent } from "react";
import { useLayoutStore } from "../stores/layout";
import { MenuIcon } from "./Icons";

// The navigation drawer's controls for narrow screens (the scrim is
// NavBackdrop). All are inert on a wide screen: the button and backdrop
// are display: none there, and closing an already-hidden drawer changes
// nothing.

// Opens (or closes) the drawer; lives in the header of every page.
export function MenuButton() {
  const open = useLayoutStore((s) => s.drawerOpen);
  const toggle = useLayoutStore((s) => s.toggleDrawer);
  return (
    <button
      type="button"
      className="icon-button menu-button"
      onClick={toggle}
      aria-label={open ? "Close navigation" : "Open navigation"}
      aria-expanded={open}
    >
      <MenuIcon />
    </button>
  );
}

// Following a link inside the drawer (a channel, settings, the profile)
// closes it; attach with onClickCapture to a drawer panel. Buttons do not
// close it — picking a space in the rail should leave its channel list
// showing, and joining voice keeps the participants in view.
export function closeDrawerOnLink(e: MouseEvent<HTMLElement>) {
  if ((e.target as HTMLElement).closest("a")) {
    useLayoutStore.getState().closeDrawer();
  }
}
