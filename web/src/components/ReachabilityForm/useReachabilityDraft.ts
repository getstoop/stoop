import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { instanceClient } from "../../api/clients";
import { useReachability } from "../../api/queries";
import { useFieldErrors } from "../../hooks/useFieldErrors";
import {
  changesFrom,
  EMPTY,
  type Fields,
  fieldsFrom,
  NO_SECRETS,
  normalize,
  REACH_FIELDS,
  type Secrets,
  type SetField,
} from "./fields";

// The reachability settings being edited: seeded from the server, the
// difference from it as a request, and saving that. The admin form and
// each of the setup wizard's reachability screens hold one.
export function useReachabilityDraft(onSeed?: (seeded: Fields) => void) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useReachability(true);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [baseline, setBaseline] = useState<Fields>(EMPTY);
  const [secrets, setSecrets] = useState<Secrets>(NO_SECRETS);
  const form = useFieldErrors(REACH_FIELDS);
  const [busy, setBusy] = useState(false);
  // Signature of the last settings taken from the server, so a poll that
  // brings back what we already have doesn't re-run the seeding.
  const seeded = useRef<string | null>(null);
  const onSeedRef = useRef(onSeed);
  onSeedRef.current = onSeed;

  const set: SetField = (key, value) =>
    setFields((f) => ({ ...f, [key]: value }));

  const changes = changesFrom(fields, baseline, secrets);
  const dirty = Object.keys(changes).length > 0;

  // Seed the fields from what's in force. The query polls while a
  // Tailscale node comes up, so this re-seeds only when the server
  // reports something new — and never on top of unsaved edits.
  useEffect(() => {
    const r = data?.reachability;
    if (!r) return;
    const next = fieldsFrom(r);
    const sig = JSON.stringify(next);
    if (sig === seeded.current) return;
    if (seeded.current !== null && dirty) return;
    seeded.current = sig;
    setFields(next);
    setBaseline(next);
    onSeedRef.current?.(next);
  }, [data, dirty]);

  // Sends what changed. True when it was saved (or there was nothing to
  // save); a refusal lands on its field and gives false.
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    setBusy(true);
    form.begin();
    try {
      await instanceClient.updateReachability(changes);
      setBaseline(normalize(fields));
      setSecrets(NO_SECRETS);
      seeded.current = null;
      await queryClient.invalidateQueries({ queryKey: ["reachability"] });
      await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
      return true;
    } catch (err) {
      form.fail(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    data,
    isLoading,
    fields,
    set,
    secrets,
    setSecrets,
    form,
    dirty,
    busy,
    save,
  };
}
