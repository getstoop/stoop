import { useCallback, useRef } from "react";
import { Alert } from "react-native";

// What a screen says when an action from its menu sheet is refused, held
// until the sheet has gone: on iOS an alert over a modal goes with it
// (as AttachSheet waits for its own). The screen calls `opened` as it
// shows the sheet and `closed` once it is gone; with no sheet up, `say`
// alerts at once.
export function useSheetNotice() {
  const open = useRef(false);
  const unsaid = useRef<[string, string?] | null>(null);
  const say = useCallback((title: string, body?: string) => {
    if (open.current) unsaid.current = [title, body];
    else Alert.alert(title, body);
  }, []);
  const opened = useCallback(() => {
    open.current = true;
  }, []);
  const closed = useCallback(() => {
    open.current = false;
    const held = unsaid.current;
    unsaid.current = null;
    if (held) Alert.alert(...held);
  }, []);
  return { say, opened, closed };
}
