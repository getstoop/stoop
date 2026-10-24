import { MAX_ATTACHMENT_BYTES, type UploadedFile, uploadSlots } from "@stoop/core/attachments";
import { useEffect, useState } from "react";
import { instanceClient } from "./clients";
import { uploadWithoutCookies } from "./fetch";

// A message's files, uploaded as they are picked: POST /files/upload, a
// multipart form with the channel and one file part, under the session's
// bearer token (docs/architecture/files.md → Two upload paths). The
// answer is an unclaimed file that SendMessage claims by id. The file
// part is the file's local uri, streamed from disk by React Native's
// networking (api/fetch uploadWithoutCookies), so nothing is held in
// memory here.

const TIMEOUT_MS = 10000;

// A file on the phone, as a picker hands it over.
export type LocalFile = { uri: string; name: string; type: string };

// One queue for the app: the server's allowance is per account, and a
// thread's composer and the channel's upload as the same person. An
// upload stopped (signal) while it waits for a slot never starts, and
// one stopped while running gives its slot back as it ends.
const withUploadSlot = uploadSlots();

export async function uploadAttachment(
  origin: string,
  token: string,
  channelId: string,
  file: LocalFile,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  const form = new FormData();
  form.append("channel_id", channelId);
  // React Native's FormData takes a file part as its uri, name and type.
  form.append("file", { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  const { status, body } = await withUploadSlot(() =>
    uploadWithoutCookies(`${origin}/files/upload`, form, { Authorization: `Bearer ${token}` }, signal),
  );
  if (status < 200 || status >= 300) {
    // The server's words when it gave them, as web shows them.
    let message = `Upload failed (${status})`;
    try {
      const refusal = JSON.parse(body) as { error?: string };
      if (refusal.error) message = refusal.error;
    } catch {
      // not JSON; keep the status
    }
    throw new Error(message);
  }
  return JSON.parse(body) as UploadedFile;
}

// The server's cap on one file (GetInstanceStatus max_upload_bytes), read
// as the screen opens, so a file over it fails before uploading. The
// server's own ceiling until it answers, or if it doesn't; the server
// enforces the cap either way.
export function useUploadCap(origin: string): number {
  const [cap, setCap] = useState(MAX_ATTACHMENT_BYTES);
  useEffect(() => {
    let live = true;
    instanceClient(origin)
      .getInstanceStatus({}, { timeoutMs: TIMEOUT_MS })
      .then((status) => {
        const bytes = Number(status.maxUploadBytes);
        if (live && bytes > 0) setCap(bytes);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [origin]);
  return cap;
}
