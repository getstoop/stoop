import { Directory, File, Paths } from "expo-file-system";
import { getThumbnailAsync } from "expo-video-thumbnails";
import { fileHeaders, fileUrl } from "./files";
import { isFileId } from "./fileNames";

// A video's first frame, for its tile: the server makes none (it has no
// ffmpeg), so the phone's own player reads it from /files with the
// session, over range requests (a few hundred KB, more when the file's
// index is at its end), and it is kept as a JPEG in the app's cache
// under the file's id, so a tile drawn again shows it from disk. At most
// 1024 px on a side, and on iOS off the queue other modules share (both
// our patch, patches/). Two at a time, in the order their tiles asked;
// one whose tiles have all gone before its turn is dropped. One that
// doesn't come (a file the phone can't decode, no network) is not asked
// for again for a minute, so a list scrolled back and forth doesn't keep
// asking; a tile still showing stays black until it is drawn again.

const posters = () => new Directory(Paths.cache, "posters");
// Where expo-video-thumbnails writes before the frame is moved into place.
const written = () => new Directory(Paths.cache, "VideoThumbnails");

const AT_ONCE = 2;
const RETRY_AFTER_MS = 60_000;
// Good enough for a 280-wide tile, a fraction of the size at full quality.
const QUALITY = 0.7;

type Request = {
  origin: string;
  token: string;
  listeners: Set<(uri: string | null) => void>;
  started: boolean;
};

const requests = new Map<string, Request>();
const waiting: string[] = [];
const failedAt = new Map<string, number>();
let running = 0;
// Bumped by sign-out, so a frame that lands after it isn't kept.
let generation = 0;

const posterFile = (fileId: string) => new File(posters(), `${fileId}.jpg`);

// The frame already on disk, read as the tile first draws, so a tile
// drawn again shows it at once.
export function cachedPoster(fileId: string): string | null {
  if (!isFileId(fileId)) return null;
  try {
    const file = posterFile(fileId);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

// Asks for a video's frame; onDone has its uri, or null when it didn't
// come. Returns the tile's withdrawal, for when it goes.
export function requestPoster(
  origin: string,
  token: string,
  fileId: string,
  onDone: (uri: string | null) => void,
): () => void {
  const failed = failedAt.get(fileId);
  if (!isFileId(fileId) || (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS)) return () => {};
  let request = requests.get(fileId);
  if (!request) {
    request = { origin, token, listeners: new Set(), started: false };
    requests.set(fileId, request);
    waiting.push(fileId);
  }
  const asked = request;
  asked.listeners.add(onDone);
  next();
  return () => {
    asked.listeners.delete(onDone);
    // Sign-out may have forgotten this request and a newer tile asked
    // again; that one isn't this tile's to drop.
    if (asked.listeners.size > 0 || asked.started || requests.get(fileId) !== asked) return;
    requests.delete(fileId);
    const index = waiting.indexOf(fileId);
    if (index >= 0) waiting.splice(index, 1);
  };
}

function next() {
  while (running < AT_ONCE && waiting.length > 0) {
    const fileId = waiting.shift() as string;
    const request = requests.get(fileId);
    if (!request) continue;
    request.started = true;
    running++;
    const asked = generation;
    makePoster(request, fileId, asked)
      .then((uri) => {
        if (asked !== generation) return;
        if (!uri) failedAt.set(fileId, Date.now());
        requests.delete(fileId);
        for (const onDone of request.listeners) onDone(uri);
      })
      .finally(() => {
        running--;
        next();
      });
  }
}

async function makePoster(request: Request, fileId: string, asked: number): Promise<string | null> {
  let made: File | null = null;
  try {
    const frame = await getThumbnailAsync(fileUrl(request.origin, fileId), {
      time: 0,
      quality: QUALITY,
      headers: fileHeaders(request.token),
    });
    made = new File(frame.uri);
    if (asked !== generation) return null;
    const folder = posters();
    folder.create({ intermediates: true, idempotent: true });
    const file = posterFile(fileId);
    if (file.exists) file.delete();
    await made.move(file);
    made = null;
    return file.uri;
  } catch {
    return null;
  } finally {
    try {
      if (made?.exists) made.delete();
    } catch {
      // Left for the system to reclaim, as any cache is.
    }
  }
}

// Sign-out forgets every frame with the rest of the files (downloads).
export function clearPosters() {
  generation++;
  requests.clear();
  waiting.length = 0;
  failedAt.clear();
  for (const folder of [posters(), written()]) {
    try {
      if (folder.exists) folder.delete();
    } catch {
      // Left for the system to reclaim, as any cache is.
    }
  }
}
