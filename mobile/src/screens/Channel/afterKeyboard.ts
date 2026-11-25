import { Keyboard } from "react-native";

// Most a step waits for the keyboard to go before it runs anyway.
const MOST_MS = 1000;

// Runs `then` once the keyboard is down: at once if it is, else when it
// has finished going (keyboardDidHide), or after a second should the
// system never say so. A sheet that sits on the keyboard (the poll's
// form) opened while the composer's keyboard is still going would rise
// with it, drop as it went and rise again as the sheet's own field took
// it; opened after, it rises once, as from the attach sheet. Returns a
// cancel, for a wait the person has moved on from meanwhile.
export function afterKeyboard(then: () => void): () => void {
  if (!Keyboard.isVisible()) {
    then();
    return () => {};
  }
  let done = false;
  const stop = () => {
    done = true;
    hidden.remove();
    clearTimeout(timer);
  };
  const finish = () => {
    if (done) return;
    stop();
    then();
  };
  const hidden = Keyboard.addListener("keyboardDidHide", finish);
  const timer = setTimeout(finish, MOST_MS);
  return () => {
    if (!done) stop();
  };
}
