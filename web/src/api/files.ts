import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { FileService } from "../gen/stoop/files/v1/files_pb";

// Uploads: the picked file's bytes ride inside the Connect request; the
// server sniffs, caps, decodes, and re-encodes them, so nothing here
// trusts the file's name or type. Downloads are plain URLs the browser
// fetches with the session cookie.

// Mirrors the server's cap (internal/files). Checked here first so a
// 20 MB photo fails instantly instead of after a base64 round trip; the
// server enforces it regardless.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

const transport = createConnectTransport({
  baseUrl: "/",
  fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
});

export const filesClient = createClient(FileService, transport);

export function fileUrl(fileId: string): string {
  return `/files/${encodeURIComponent(fileId)}`;
}

// Reads a picked file into bytes for the upload RPC, refusing oversize
// files before any work is done.
export async function readImageFile(file: File): Promise<Uint8Array> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image must be ${MAX_IMAGE_BYTES / (1024 * 1024)} MB or smaller`,
    );
  }
  return new Uint8Array(await file.arrayBuffer());
}

// ---- Message attachments (STOOP-42) ----

export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

export type UploadedFile = {
  id: string;
  name: string;
  contentType: string;
  size: number;
};

// Uploads one file for a channel as a multipart form
export async function uploadAttachment(
  channelId: string,
  file: File,
  maxBytes: number = MAX_ATTACHMENT_BYTES,
): Promise<UploadedFile> {
  if (file.size > maxBytes) {
    throw new Error(`File must be ${maxBytes >> 20} MB or smaller`);
  }
  if (file.size === 0) {
    throw new Error("The file is empty");
  }
  const form = new FormData();
  form.append("channel_id", channelId);
  form.append("file", file, file.name);
  const res = await fetch("/files/upload", {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    let message = `upload failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // not JSON; keep the status message
    }
    throw new Error(message);
  }
  return (await res.json()) as UploadedFile;
}

// Raster types the server will serve inline; everything else downloads.
export function isInlineImage(contentType: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
    contentType,
  );
}

// Media types the server serves inline for playback
export function isPlayableVideo(contentType: string): boolean {
  return ["video/mp4", "video/webm", "video/quicktime"].includes(contentType);
}

export function isPlayableAudio(contentType: string): boolean {
  return [
    "audio/mpeg",
    "audio/mp4",
    "audio/wave",
    "audio/ogg",
    "application/ogg",
  ].includes(contentType);
}

export function formatBytes(n: number | bigint): string {
  const b = Number(n);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
