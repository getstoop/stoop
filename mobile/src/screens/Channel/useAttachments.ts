import { formatBytes, MAX_ATTACHMENTS, restoreFiles, type UploadedFile } from "@stoop/core/attachments";
import { useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";
import { errorText } from "../../api/errors";
import type { LocalFile } from "../../api/files";
import type { AttachSource } from "./AttachSheet";
import { type Picked, pickFrom } from "./pickers";

// The files a composer holds for its next message, as web's composer
// holds them: each uploads as it is picked, through the app's one queue
// of upload slots (api/files), and is sent by the id the upload answers
// with. One over the server's cap, or empty, fails before uploading; a
// failure is kept on the item, with the reason, until it is removed by
// hand, and a send leaves it out. A refused send puts its files back
// ahead of any picked since (core/attachments restoreFiles). The
// composer is mounted per channel and per thread, so leaving either
// drops them: its uploads still going are stopped, as is one whose item
// is removed, so neither holds a slot, and a picker answering after
// that is dropped.
//
// It also runs the attach sheet for the composer: Attach puts the
// keyboard away and raises it (`attaching`, the composer's to draw);
// once it has gone, the item picked opens its system picker (pickers.ts:
// the photo library, the camera or files), and `reopen` (the card with
// focus) is called when there is something to show or the card was up
// before. A picker's refusal, such as the camera not allowed, is said
// in the card as too many files are.

export type PendingFile = {
  key: string;
  uri: string;
  name: string;
  type: string;
  kind: "image" | "video" | "file";
  // As the phone measured it, when it did; the server's once uploaded.
  size?: number;
  // A video's length, in milliseconds.
  duration?: number;
  fileId?: string;
  error?: string;
};

let made = 0;

export function useAttachments(
  upload: (file: LocalFile, signal: AbortSignal) => Promise<UploadedFile>,
  maxBytes: number,
  reopen: () => void,
) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  // A pick refused as a whole: too many, or the picker failing.
  const [notice, setNotice] = useState<string | null>(null);
  // The list as last set, for two picks before a render to count the room
  // they leave.
  const latest = useRef(files);
  latest.current = files;
  const change = (next: (list: PendingFile[]) => PendingFile[]) => {
    latest.current = next(latest.current);
    setFiles(next);
  };
  const patch = (key: string, update: Partial<PendingFile>) =>
    change((list) => list.map((file) => (file.key === key ? { ...file, ...update } : file)));

  // Each upload still going, by its item's key, to stop; and whether the
  // composer is still there.
  const running = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const uploads = running.current;
    return () => {
      mounted.current = false;
      for (const controller of uploads.values()) controller.abort();
      uploads.clear();
    };
  }, []);

  const add = (picked: Picked[]) => {
    const room = MAX_ATTACHMENTS - latest.current.length;
    setNotice(picked.length > room ? `At most ${MAX_ATTACHMENTS} files per message` : null);
    for (const file of picked.slice(0, Math.max(0, room))) {
      const item: PendingFile = { ...file, key: `${Date.now()}-${++made}` };
      // Without a size from the picker, the server judges.
      if (file.size === 0) item.error = "The file is empty";
      else if (file.size !== undefined && file.size > maxBytes) item.error = `Too big — ${capText(maxBytes)} max`;
      change((list) => [...list, item]);
      if (item.error) continue;
      const controller = new AbortController();
      running.current.set(item.key, controller);
      upload({ uri: file.uri, name: file.name, type: file.type }, controller.signal).then(
        (uploaded) =>
          patch(item.key, { fileId: uploaded.id, name: uploaded.name, type: uploaded.contentType, size: uploaded.size }),
        (err) => {
          if (!controller.signal.aborted) patch(item.key, { error: errorText(err) });
        },
      ).finally(() => {
        if (running.current.get(item.key) === controller) running.current.delete(item.key);
      });
    }
  };

  // Whether it left anything to show: files picked, or why none were.
  const pick = async (source: AttachSource): Promise<boolean> => {
    const room = MAX_ATTACHMENTS - latest.current.length;
    if (room <= 0) {
      setNotice(`At most ${MAX_ATTACHMENTS} files per message`);
      return true;
    }
    let result: Awaited<ReturnType<typeof pickFrom>>;
    try {
      result = await pickFrom(source, room);
    } catch (err) {
      if (!mounted.current) return false;
      setNotice(errorText(err));
      return true;
    }
    if (!mounted.current || !result) return false;
    if ("refused" in result) setNotice(result.refused);
    else add(result.picked);
    return true;
  };

  const remove = (key: string) => {
    running.current.get(key)?.abort();
    running.current.delete(key);
    setNotice(null);
    change((list) => list.filter((file) => file.key !== key));
  };

  // A send's files, cleared from the composer as it goes; restore puts
  // them back when it is refused.
  const take = () => {
    const sent = latest.current;
    setNotice(null);
    change(() => []);
    return sent;
  };
  const restore = (sent: PendingFile[]) => change((addedSince) => restoreFiles(sent, addedSince));

  // The sheet: up over a screen with the keyboard away, so the field
  // gives the card up; `cardUp` is whether it was.
  const [attaching, setAttaching] = useState(false);
  const cardBefore = useRef(false);
  const reopenLatest = useRef(reopen);
  reopenLatest.current = reopen;
  const openSheet = (cardUp: boolean) => {
    cardBefore.current = cardUp;
    Keyboard.dismiss();
    setAttaching(true);
  };
  const sheetClosed = async (source: AttachSource | null) => {
    setAttaching(false);
    const shown = source !== null && (await pick(source));
    if (mounted.current && (shown || cardBefore.current)) reopenLatest.current();
  };

  return {
    files,
    notice,
    uploading: files.some((file) => !file.fileId && !file.error),
    ready: files.some((file) => file.fileId),
    attaching,
    openSheet,
    sheetClosed,
    remove,
    take,
    restore,
  };
}

// "100 MB" for a cap in whole megabytes, as the server words it.
function capText(bytes: number) {
  return bytes % (1024 * 1024) === 0 ? `${bytes / (1024 * 1024)} MB` : formatBytes(bytes);
}
