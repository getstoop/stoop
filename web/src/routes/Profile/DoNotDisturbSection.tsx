import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { shortDateTime } from "../../api/dates";
import { errorText } from "../../api/errors";
import {
  DND_DURATIONS,
  dndChoice,
  dndEnd,
  setDoNotDisturb,
  useDndActive,
} from "../../api/presence";
import { useMe } from "../../api/queries";
import { SettingRow } from "../../components/SettingRow";
import { notice } from "../../stores/dialogs";

// Do not disturb belongs to the account: turned on here, it holds alerts on
// every device signed in, and everyone else sees it on the dot. One menu
// turns it off or on for a while; an end already chosen shows as its own
// entry.
export function DoNotDisturbSection() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [saving, setSaving] = useState(false);
  useDndActive(me);
  const choice = dndChoice(me);

  const change = async (key: string) => {
    setSaving(true);
    try {
      await setDoNotDisturb(queryClient, key !== "off", dndEnd(key));
    } catch (err) {
      notice({ title: "Couldn't change do not disturb", body: errorText(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow
      id="dnd-duration"
      className="dnd-section"
      title="Do not disturb"
      description="Holds desktop alerts on every device you're signed in on, and shows everyone else you'd rather not be disturbed."
    >
      <select
        id="dnd-duration"
        name="dnd-duration"
        value={choice}
        disabled={!me || saving}
        onChange={(e) => change(e.target.value)}
      >
        <option value="off">Off</option>
        {choice === "until" && me?.dndUntil && (
          <option value="until">
            Until {shortDateTime(timestampDate(me.dndUntil))}
          </option>
        )}
        {DND_DURATIONS.map((d) => (
          <option key={d.key} value={d.key}>
            {d.label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}
