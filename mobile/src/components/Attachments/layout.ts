import { attachmentKind } from "@stoop/core/attachments";
import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
// Straight from the generated values, not the theme's index, so this
// file needs no React Native and its tests run in Node.
import { markdown } from "../../theme/generated";

// How a message's files are laid out in a row, worked out before layout
// so a row is drawn at its final height and never jumps when an image
// lands. Web's rules (attachments.css through theme/generated.ts) where
// a phone can follow them:
// - one image at its own size, shrunk to fit the words' width (no more
//   than 420) and 320 high, never enlarged; a side under 44 gets a 44
//   box, the image cropped to fill it when that needs no enlarging and
//   otherwise drawn at its own size inside;
// - one image of a size the server didn't measure (uploaded before it
//   did) in a fixed 4:3 box as wide as that, the image fitted inside;
// - one video as web's frame, 280 wide (no wider than the words), on
//   black with the play badge, in a fixed 16:9 box: the server has no
//   still or size for it;
// - two or more images and videos in a grid of square tiles, two to a
//   row, in their order, cropped to fill, all of them shown, and the
//   other files after it in theirs (web wraps each at its own size,
//   which at a phone's width stacks full-size photos);
// - any other file as a card, an expired one as its placeholder. Audio
//   is a card until the phone plays it, and so is a video this phone
//   has found it can't play (`unplayable`, by file id), as on web.

export type Box = { width: number; height: number };
// How the image fills its box: to its edges, or at most its own size
// and no bigger than the box, on the panel.
export type Fit = "cover" | "scale-down";

export type AttachmentPart =
  | { kind: "image"; attachment: Attachment; box: Box; fit: Fit }
  | { kind: "video"; attachment: Attachment; box: Box }
  | { kind: "grid"; attachments: Attachment[]; tile: number }
  | { kind: "card"; attachment: Attachment }
  | { kind: "expired"; attachment: Attachment };

// Phone-only: the smallest side a finger can find, the fallback box's
// and the video frame's shapes, and the grid's columns. Nothing on web
// could drift from them.
export const MIN_SIDE = 44;
const FALLBACK_RATIO = 3 / 4;
const VIDEO_RATIO = 9 / 16;
const GRID_COLUMNS = 2;

export function attachmentsLayout(
  attachments: Attachment[],
  bodyWidth: number,
  unplayable: ReadonlySet<string> = new Set(),
): AttachmentPart[] {
  const room = Math.min(bodyWidth, markdown.attachmentImageMaxWidth);
  const kindOf = (attachment: Attachment) => {
    const kind = attachmentKind(attachment);
    return kind === "video" && unplayable.has(attachment.fileId) ? "file" : kind;
  };
  const media = attachments.filter((attachment) => ["image", "video"].includes(kindOf(attachment)));
  const parts: AttachmentPart[] = [];
  if (media.length > 1) {
    const tile = Math.floor((room - (GRID_COLUMNS - 1) * markdown.attachmentsGap) / GRID_COLUMNS);
    parts.push({ kind: "grid", attachments: media, tile });
  }
  for (const attachment of attachments) {
    const kind = kindOf(attachment);
    if (kind === "expired") parts.push({ kind, attachment });
    else if (kind === "audio" || kind === "file") parts.push({ kind: "card", attachment });
    // Two or more images and videos are in the grid already.
    else if (media.length > 1) continue;
    else if (kind === "image") parts.push({ kind, attachment, ...fitted(attachment, room) });
    else parts.push({ kind, attachment, box: videoBox(room) });
  }
  return parts;
}

// Web's video frame: 280 wide, or the room there is when that is less.
function videoBox(room: number): Box {
  const width = Math.min(room, markdown.attachmentVideoWidth);
  return { width, height: Math.round(width * VIDEO_RATIO) };
}

// One image's box and how it fills it.
function fitted({ width, height }: Attachment, room: number): { box: Box; fit: Fit } {
  if (!(width > 0 && height > 0)) {
    return { box: { width: room, height: Math.floor(room * FALLBACK_RATIO) }, fit: "scale-down" };
  }
  const scale = Math.min(1, room / width, markdown.attachmentImageMaxHeight / height);
  const box = { width: Math.floor(width * scale), height: Math.floor(height * scale) };
  const raised = { width: Math.max(box.width, MIN_SIDE), height: Math.max(box.height, MIN_SIDE) };
  // Cropping to fill would enlarge it once the box is bigger than the
  // image itself; then it keeps its own size.
  return { box: raised, fit: raised.width <= width && raised.height <= height ? "cover" : "scale-down" };
}
