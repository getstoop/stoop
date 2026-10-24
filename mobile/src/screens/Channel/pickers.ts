import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import type { AttachSource } from "./AttachSheet";
import type { PendingFile } from "./useAttachments";

// The system's pickers behind the attach sheet's three items, each
// handing back what was picked as the composer holds it, nothing when
// the person backs out, or a refusal to say in the composer.
//
// The photo library is PHPicker on iOS, which asks for no permission,
// with several picked at once up to the room left. iPhone photos are
// HEIC, which the server can't sniff, so it is asked for its most
// compatible form and hands over a JPEG; what the phone puts in the file
// (where a photo was taken among it) is sent as it gives it.
//
// The camera takes one photo or video. It asks for the camera first and
// says plainly when that is refused; the microphone is the system's to
// ask for as a video starts recording. A photo comes as a JPEG and a
// video as it was recorded, with no export preset.
//
// Files is the system's document picker, several at once (it has no
// limit of its own, so the composer keeps the first that fit), each
// copied to the app's cache so the upload can read it.

export type Picked = Omit<PendingFile, "key">;
export type PickResult = { picked: Picked[] } | { refused: string } | null;

export async function pickFrom(source: AttachSource, room: number): Promise<PickResult> {
  if (source === "camera") return camera();
  if (source === "files") return files();
  return library(room);
}

async function library(room: number): Promise<PickResult> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    selectionLimit: room,
    orderedSelection: true,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  return result.canceled || result.assets.length === 0 ? null : { picked: result.assets.map(fromAsset) };
}

async function camera(): Promise<PickResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { refused: "Stoop doesn't have permission to use the camera." };
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images", "videos"] });
  return result.canceled || result.assets.length === 0 ? null : { picked: result.assets.map(fromAsset) };
}

async function files(): Promise<PickResult> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (result.canceled || result.assets.length === 0) return null;
  return {
    picked: result.assets.map((asset) => ({
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? "application/octet-stream",
      kind: "file",
      size: asset.size,
    })),
  };
}

// A photo or video as the composer holds it. The library names it as it
// does (IMG_2041.jpg); one without a name, as the camera's are, is named
// for its type.
function fromAsset(asset: ImagePicker.ImagePickerAsset): Picked {
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
