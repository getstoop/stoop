import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { filesClient } from "./clients";

// Your avatar, from the photo library: a square chosen in the system's own
// cropper, which hands it back as its own copy. The library asks for no
// permission. Android's cropper keeps the crop at full size, over the server's
// limits for a large photo, so a photo too big for them is shrunk here on either
// platform, decoded no larger than it needs to be. The server crops to the centre
// and scales to 256 px, so 1024 loses nothing.

// The server's cap on an avatar (internal/files MaxImageBytes). Checked here
// first: above twice this it isn't the image rule that refuses the request,
// and its words for that say nothing to a person.
const MAX_BYTES = 2 * 1024 * 1024;
const QUALITY = 0.8;
const LONG_SIDE = 1024;
const TIMEOUT_MS = 30000;

// What was picked, or null when the person backed out.
export async function pickAvatar(): Promise<ImagePicker.ImagePickerAsset | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: QUALITY,
  });
  return result.canceled ? null : (result.assets[0] ?? null);
}

// The picture's bytes, ready to send. Its files are only needed until then.
export async function prepareAvatar({ uri, width, height }: ImagePicker.ImagePickerAsset): Promise<Uint8Array> {
  const made = [uri];
  try {
    const picked = new File(uri);
    if (Math.max(width, height) <= LONG_SIDE && picked.size <= MAX_BYTES) return await picked.bytes();
    const shrunk = await shrink(uri);
    made.push(shrunk);
    const file = new File(shrunk);
    if (file.size > MAX_BYTES) throw new Error(`Image must be ${MAX_BYTES >> 20} MB or smaller`);
    return await file.bytes();
  } finally {
    for (const path of made) {
      try {
        new File(path).delete();
      } catch {
        // The cache's to clear later.
      }
    }
  }
}

async function shrink(uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri, { maxWidth: LONG_SIDE, maxHeight: LONG_SIDE });
  let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY });
    return saved.uri;
  } finally {
    image?.release();
    context.release();
  }
}

export async function uploadAvatar(origin: string, token: string, data: Uint8Array): Promise<void> {
  await filesClient(origin, token).uploadAvatar({ data }, { timeoutMs: TIMEOUT_MS });
}
