// What a downloaded file may be called on the phone. The server is any
// server the person added, so its file id and the sender's name are
// treated as hostile: an id is a UUID or nothing is downloaded, and a
// name can't climb out of its folder or outgrow the file system's 255
// bytes. Pure, so its tests run in Node.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isFileId = (id: string) => UUID.test(id);

// Room left under 255 for ".part" and some margin.
const MAX_BYTES = 200;
// An extension longer than this is part of the name.
const MAX_EXTENSION_BYTES = 16;

const bytes = (text: string) => new TextEncoder().encode(text).length;

// The sender's name with no path in it, no leading dots and at most 200
// bytes of UTF-8, its extension kept; "file" when nothing is left.
export function localName(name: string): string {
  const flat = name.replace(/[/\\\0]/g, "_").replace(/^\.+/, "");
  if (flat === "") return "file";
  if (bytes(flat) <= MAX_BYTES) return flat;
  const dot = flat.lastIndexOf(".");
  const extension = dot > 0 && bytes(flat.slice(dot)) <= MAX_EXTENSION_BYTES ? flat.slice(dot) : "";
  const room = MAX_BYTES - bytes(extension);
  let stem = "";
  for (const character of flat.slice(0, flat.length - extension.length)) {
    if (bytes(stem + character) > room) break;
    stem += character;
  }
  return stem + extension;
}
