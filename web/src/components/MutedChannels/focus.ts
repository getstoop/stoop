// Muting and unmuting take away the row that held the keyboard's focus.
// These put it on the nearest thing that is still there, once the list
// has redrawn. A row that stayed keeps its focus.

// How long to wait for the redraw before concluding the row stayed.
const FRAMES = 10;

// Runs `then` on the first frame where `gone` holds, or not at all.
function onceGone(gone: () => boolean, then: () => void, frames = FRAMES) {
  requestAnimationFrame(() => {
    if (gone()) then();
    else if (frames > 0) onceGone(gone, then, frames - 1);
  });
}

// For Unmute in the panel. Called before the row can go, it notes what is
// around the button; the function it returns, called once the unmute has
// succeeded, moves focus to the next row's button, else the one before,
// else the panel's title.
export function focusAfterUnmute(button: HTMLElement): () => void {
  const row = button.closest("li");
  const neighbour = row?.nextElementSibling ?? row?.previousElementSibling;
  const title = button
    .closest(".side-panel")
    ?.querySelector(".side-panel-title");
  return () =>
    onceGone(
      () => !button.isConnected,
      () => {
        const next = neighbour?.isConnected
          ? neighbour.querySelector("button")
          : title;
        if (next instanceof HTMLElement) next.focus();
      },
    );
}

// After Mute in a channel row's menu: the Muted channels bar, where the
// channel went. The channel being read keeps its row, and so its focus.
export function focusAfterMute(channelId: string) {
  const row = `.channel-list a[href$="/c/${CSS.escape(channelId)}"]`;
  onceGone(
    () => !document.querySelector(row),
    () => {
      if (document.activeElement !== document.body) return;
      document.querySelector<HTMLElement>(".muted-bar")?.focus();
    },
  );
}
