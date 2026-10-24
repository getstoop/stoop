import { formatBytes, MAX_ATTACHMENTS, restoreFiles, type UploadedFile } from "@stoop/core/attachments";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import { errorText } from "../../api/errors";
import type { LocalFile } from "../../api/files";

// The files a composer holds for its next message, as web's composer
// holds them: each uploads as it is picked, through the app's one queue
// of upload slots (api/files), and is sent by the id the upload answers
// with. One over the server's cap fails before uploading; a failure is
// kept on the item, with the reason, until it is removed by hand, and a
// send leaves it out. A refused send puts its files back ahead of any
// picked since (core/attachments restoreFiles). The composer is mounted
// per channel and per thread, so leaving either drops them, and an
// upload answering after that lands nowhere.
//
// The photo library is the system's picker (PHPicker on iOS, which asks
// for no permission), with several picked at once up to the room left
// of ten. iPhone photos are HEIC, which the server can't sniff, so the
// picker is asked for its most compatible form and hands over a JPEG;
// what the phone puts in the file (where a photo was taken among it) is
// sent as it gives it.

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

export function useAttachments(upload: (file: LocalFile) => Promise<UploadedFile>, maxBytes: number) {
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

  const add = (picked: Omit<PendingFile, "key">[]) => {
    const room = MAX_ATTACHMENTS - latest.current.length;
    setNotice(picked.length > room ? `At most ${MAX_ATTACHMENTS} files per message` : null);
    for (const file of picked.slice(0, Math.max(0, room))) {
      const item: PendingFile = { ...file, key: `${Date.now()}-${++made}` };
      if (file.size !== undefined && file.size > maxBytes) {
        item.error = `Too big — ${capText(maxBytes)} max`;
        change((list) => [...list, item]);
        continue;
      }
      change((list) => [...list, item]);
      upload({ uri: file.uri, name: file.name, type: file.type }).then(
        (uploaded) =>
          patch(item.key, { fileId: uploaded.id, name: uploaded.name, type: uploaded.contentType, size: uploaded.size }),
        (err) => patch(item.key, { error: errorText(err) }),
      );
    }
  };

  // Whether it left anything to show: files picked, or why none were.
  const pickPhotos = async (): Promise<boolean> => {
    const room = MAX_ATTACHMENTS - latest.current.length;
    if (room <= 0) {
      setNotice(`At most ${MAX_ATTACHMENTS} files per message`);
      return true;
    }
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsMultipleSelection: true,
        selectionLimit: room,
        orderedSelection: true,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
    } catch (err) {
      setNotice(errorText(err));
      return true;
    }
    if (result.canceled || result.assets.length === 0) return false;
    add(result.assets.map(fromAsset));
    return true;
  };

  const remove = (key: string) => {
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

  return {
    files,
    notice,
    uploading: files.some((file) => !file.fileId && !file.error),
    ready: files.some((file) => file.fileId),
    pickPhotos,
    remove,
    take,
    restore,
  };
}

// A picked photo or video as the composer holds it. The picker names it
// as the library does (IMG_2041.jpg); an asset without a name is named
// for its type.
function fromAsset(asset: ImagePicker.ImagePickerAsset): Omit<PendingFile, "key"> {
  const kind = asset.type === "video" ? "video" : asset.type === "image" ? "image" : "file";
  const type = asset.mimeType ?? (kind === "video" ? "video/quicktime" : kind === "image" ? "image/jpeg" : "");
  const name = asset.fileName || `${kind === "video" ? "video" : "photo"}.${extension(type)}`;
  return { uri: asset.uri, name, type, kind, size: asset.fileSize, duration: asset.duration ?? undefined };
}

function extension(type: string) {
  if (type === "video/quicktime") return "mov";
  if (type === "image/jpeg") return "jpg";
  return type.split("/")[1] || "bin";
}

// "100 MB" for a cap in whole megabytes, as the server words it.
function capText(bytes: number) {
  return bytes % (1024 * 1024) === 0 ? `${bytes / (1024 * 1024)} MB` : formatBytes(bytes);
}
