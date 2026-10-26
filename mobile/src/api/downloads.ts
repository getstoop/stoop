import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
import { Directory, File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import { shareAsync } from "expo-sharing";
import { isFileId, localName } from "./fileNames";

// A received file handed to the system: GET /files/<id> with the
// session as a bearer token, into the app's cache under the file's own
// name (a folder per file id, so two files of one name don't meet),
// then the share sheet on it, which reaches Files, other apps, AirDrop
// and Print. One already there whole isn't downloaded again, nor is a
// picture expo-image already holds as it came (the viewer's). The id and
// the name come from the server, so they are made safe first
// (api/fileNames).

const downloads = () => new Directory(Paths.cache, "attachments");

// A file to draw with expo-image, which caches it by this address.
export const fileSource = (origin: string, token: string, fileId: string) => ({
  uri: `${origin}/files/${fileId}`,
  headers: { Authorization: `Bearer ${token}` },
});

// One download per file at a time, however many cards show it (the
// channel's and the thread's); a later tap shares the same result.
const inFlight = new Map<string, Promise<string>>();

// Resolves to the downloaded file's uri.
export function downloadAttachment(
  origin: string,
  token: string,
  attachment: Attachment,
  onProgress: (written: number) => void,
): Promise<string> {
  const going = inFlight.get(attachment.fileId);
  if (going) return going;
  const download = fetchToCache(origin, token, attachment, onProgress).finally(() =>
    inFlight.delete(attachment.fileId),
  );
  inFlight.set(attachment.fileId, download);
  return download;
}

async function fetchToCache(
  origin: string,
  token: string,
  attachment: Attachment,
  onProgress: (written: number) => void,
): Promise<string> {
  if (!isFileId(attachment.fileId)) throw new Error("not a file id");
  const folder = new Directory(downloads(), attachment.fileId);
  const name = localName(attachment.name);
  const file = new File(folder, name);
  if (trimmed(file.parentDirectory.uri) !== trimmed(folder.uri)) throw new Error("not a file name");
  // Only a file of the size the message says counts as downloaded.
  if (file.exists) {
    if (file.size === Number(attachment.size)) return file.uri;
    file.delete();
  }
  folder.create({ intermediates: true, idempotent: true });
  if (await copiedFromImageCache(origin, attachment, file)) return file.uri;
  // Written beside it and moved into place whole, so an app killed
  // halfway (Android writes as it reads) leaves no file to share.
  const part = new File(folder, `${name}.part`);
  if (part.exists) part.delete();
  try {
    await File.downloadFileAsync(`${origin}/files/${attachment.fileId}`, part, {
      headers: { Authorization: `Bearer ${token}` },
      onProgress: ({ bytesWritten }) => onProgress(bytesWritten),
    });
    await part.move(file);
  } catch (error) {
    if (part.exists) part.delete();
    throw error;
  }
  return file.uri;
}

// The original from expo-image's disk cache, copied under its own name,
// when what is there is the whole file the message names.
async function copiedFromImageCache(origin: string, attachment: Attachment, file: File): Promise<boolean> {
  const path = await Image.getCachePathAsync(`${origin}/files/${attachment.fileId}`).catch(() => null);
  if (!path) return false;
  try {
    const cached = new File(path.startsWith("file://") ? path : `file://${path}`);
    if (!cached.exists || cached.size !== Number(attachment.size)) return false;
    await cached.copy(file);
    return true;
  } catch {
    if (file.exists) file.delete();
    return false;
  }
}

const trimmed = (uri: string) => uri.replace(/\/+$/, "");

// Resolves once the sheet has gone, whatever was picked.
export function shareDownloaded(uri: string, attachment: Attachment): Promise<void> {
  return shareAsync(uri, { mimeType: attachment.contentType, dialogTitle: attachment.name });
}

// Signing out of any server forgets every server's pictures and files:
// a photo from a private channel shouldn't outlive the session on a
// shared phone. The image cache can't be cleared one server at a time.
export async function clearFileCaches(): Promise<void> {
  await Promise.all([Image.clearDiskCache(), Image.clearMemoryCache()]).catch(() => {});
  try {
    const folder = downloads();
    if (folder.exists) folder.delete();
  } catch {
    // Left for the system to reclaim, as any cache is.
  }
}
