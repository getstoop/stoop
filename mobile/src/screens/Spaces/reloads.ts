// The rules of reloading the Spaces tab's rail and pane.

// What to show after a load answered: a reload that failed for a
// reason that will pass (the network, the server) keeps what is already
// on screen, so a blip in the background never takes a good list away.
// Only a first load, or a retry, which clears what was shown before it
// asks, shows the failure. Any other answer is shown.
export function afterLoad<View extends { state: string }>(shown: View, loaded: View): View {
  return loaded.state === "failed" && shown.state === "ready" ? shown : loaded;
}

// What happened while the tab was out of sight (under a pushed channel,
// behind another tab): nothing is reloaded there, since every message
// in the channel being read would ask for the rail and the pane again.
// A change is remembered instead, and coming back reloads once if there
// was any.
export function awayChanges(): {
  // Something changed: whether to reload now (in sight) or remember it.
  changed: (focused: boolean) => "reload" | "wait";
  // The tab is in sight again: whether a reload is owed. Asked once.
  returned: () => boolean;
} {
  let missed = false;
  return {
    changed: (focused) => {
      if (focused) return "reload";
      missed = true;
      return "wait";
    },
    returned: () => {
      const owed = missed;
      missed = false;
      return owed;
    },
  };
}
