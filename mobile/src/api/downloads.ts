import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
import { Directory, File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import { shareAsync } from "expo-sharing";

// A received file handed to the system: GET /files/<id> with the
// session as a bearer token, into the app's cache under the file's own
// name (a folder per file id, so two files of one name don't meet),
// then the share sheet on it, which reaches Files, other apps, AirDrop
// and Print. One already there isn't downloaded again.

const downloads = () => new Directory(Paths.cache, "attachments");

// A file to draw with expo-image, which caches it by this address.
export const fileSource = (origin: string, token: string, fileId: string) => ({
  uri: `${origin}/files/${fileId}`,
  headers: { Authorization: `Bearer ${token}` },
});

// Resolves to the downloaded file's uri.
export async function downloadAttachment(
  origin: string,
  token: string,
  attachment: Attachment,
  onProgress: (written: number) => void,
): Promise<string> {
  const folder = new Directory(downloads(), attachment.fileId);
  // The name is the sender's; a slash in it would name another folder.
  const file = new File(folder, attachment.name.replaceAll("/", "_") || attachment.fileId);
  if (!file.exists) {
    folder.create({ intermediates: true, idempotent: true });
    await File.downloadFileAsync(`${origin}/files/${attachment.fileId}`, file, {
      headers: { Authorization: `Bearer ${token}` },
      idempotent: true,
      onProgress: ({ bytesWritten }) => onProgress(bytesWritten),
    }).catch((error) => {
      // Android leaves what it had written; it mustn't pass for the file.
      if (file.exists) file.delete();
      throw error;
    });
  }
  return file.uri;
}

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
