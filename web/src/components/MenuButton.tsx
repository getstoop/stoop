import type { MouseEvent } from "react";
import { useLayoutStore } from "../stores/layout";
import { MenuIcon } from "./Icons";
import { LiveIndicator } from "./LiveIndicator";

// The navigation drawer's controls for narrow screens (the scrim is
// NavBackdrop). All are inert on a wide screen: the button and backdrop
// are display: none there, and closing an already-hidden drawer changes
// nothing.

// Opens (or closes) the drawer; lives in the header of every page. The
// live indicator rides beside it, because on a phone the rail that
// otherwise carries it is inside the drawer.
export function MenuButton() {
  const open = useLayoutStore((s) => s.drawerOpen);
  const toggle = useLayoutStore((s) => s.toggleDrawer);
  return (
    <>
      <button
        type="button"
        className="icon-button menu-button"
        onClick={toggle}
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
      >
        <MenuIcon />
      </button>
      <LiveIndicator placement="header" />
    </>
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
