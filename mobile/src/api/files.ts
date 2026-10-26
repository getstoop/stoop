import { type UploadedFile, uploadSlots } from "@stoop/core/attachments";
import { uploadWithoutCookies } from "./fetch";

// A message's files, uploaded as they are picked: POST /files/upload, a
// multipart form with the channel and one file part, under the session's
// bearer token (docs/architecture/files.md → Two upload paths). The
// answer is an unclaimed file that SendMessage claims by id. The file
// part is the file's local uri, read by React Native's networking
// (api/fetch uploadWithoutCookies), so the bytes never pass through JS:
// Android streams them from disk, iOS holds the built body in native
// memory while it sends.

// Where a file is fetched from, GET /files/<id>, with the session as a
// bearer token: one place, so expo-image's cache key and a download's
// address agree (api/downloads reuses what the image cache holds) and
// every picture drawn with the session goes into the cache sign-out
// clears. (An invite's space icon, drawn before sign-in with the invite's
// code, is the one picture from /files without it.)
export const fileUrl = (origin: string, fileId: string) => `${origin}/files/${fileId}`;

export const fileHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

// A file to draw with expo-image, which caches it by this address.
export const fileSource = (origin: string, token: string, fileId: string) => ({
  uri: fileUrl(origin, fileId),
  headers: fileHeaders(token),
});

// A file on the phone, as a picker hands it over.
export type LocalFile = { uri: string; name: string; type: string };

// One queue for the app: the server's allowance is per account, and a
// thread's composer and the channel's upload as the same person. An
// upload stopped (signal) while it waits for a slot never starts: it
// still waits its turn, then gives the slot straight back. One stopped
// while running gives its slot back as it ends.
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
