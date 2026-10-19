import { Redirect, Slot, useLocalSearchParams } from "expo-router";
import { useServer } from "../../../servers";

// Everything under /s/<id> is one saved server; an ID this phone doesn't
// have goes back to the start.
export default function ServerLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!useServer(id)) return <Redirect href="/" />;
  return <Slot />;
}
