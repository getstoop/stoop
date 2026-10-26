import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The queue behind video tiles' first frames, over a file system and a
// frame grabber held in memory: frames resolve when the test says.

const disk = new Set<string>();
const grabs: { url: string; resolve: (uri: string) => void; reject: () => void }[] = [];

vi.mock("expo-file-system", () => {
  class Directory {
    uri: string;
    constructor(parent: { uri: string } | string, name: string) {
      this.uri = `${typeof parent === "string" ? parent : parent.uri}/${name}`;
    }
    get exists() {
      return [...disk].some((path) => path.startsWith(`${this.uri}/`));
    }
    create() {}
    delete() {
      for (const path of [...disk]) if (path.startsWith(`${this.uri}/`)) disk.delete(path);
    }
  }
  class File {
    uri: string;
    constructor(parent: { uri: string } | string, name?: string) {
      this.uri = name === undefined ? (parent as string) : `${(parent as { uri: string }).uri}/${name}`;
    }
    get exists() {
      return disk.has(this.uri);
    }
    delete() {
      disk.delete(this.uri);
    }
    async move(to: File) {
      disk.delete(this.uri);
      disk.add(to.uri);
      this.uri = to.uri;
    }
  }
  return { Directory, File, Paths: { cache: { uri: "cache" } } };
});

vi.mock("expo-video-thumbnails", () => ({
  getThumbnailAsync: (url: string) =>
    new Promise((resolve, reject) => {
      grabs.push({
        url,
        resolve: (uri) => {
          disk.add(uri);
          resolve({ uri, width: 1, height: 1 });
        },
        reject: () => reject(new Error("no frame")),
      });
    }),
}));

const { cachedPoster, clearPosters, requestPoster } = await import("./posters");

const id = (n: number) => `0190a5c4-0000-7000-8000-${String(n).padStart(12, "0")}`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  clearPosters();
  disk.clear();
  grabs.length = 0;
});

// Whatever a test left grabbing ends, so the next starts with both
// places free.
afterEach(async () => {
  vi.useRealTimers();
  for (const grab of grabs) grab.reject();
  await settle();
});

describe("video posters", () => {
  it("grabs two at a time, the next as one lands, and keeps it on disk", async () => {
    const done: (string | null)[] = [];
    for (const n of [1, 2, 3]) requestPoster("https://stoop.test", "t", id(n), (uri) => done.push(uri));
    expect(grabs.map((grab) => grab.url)).toEqual([`https://stoop.test/files/${id(1)}`, `https://stoop.test/files/${id(2)}`]);
    grabs[0].resolve("cache/VideoThumbnails/a.jpg");
    await settle();
    expect(done).toEqual([`cache/posters/${id(1)}.jpg`]);
    expect(cachedPoster(id(1))).toBe(`cache/posters/${id(1)}.jpg`);
    expect(disk.has("cache/VideoThumbnails/a.jpg")).toBe(false);
    expect(grabs).toHaveLength(3);
  });

  it("drops one whose tiles all went before its turn", async () => {
    requestPoster("o", "t", id(1), () => {});
    requestPoster("o", "t", id(2), () => {});
    const withdraw = requestPoster("o", "t", id(3), () => {});
    withdraw();
    grabs[0].resolve("cache/VideoThumbnails/a.jpg");
    await settle();
    expect(grabs).toHaveLength(2);
  });

  it("asks once for a file two tiles show", async () => {
    const done: (string | null)[] = [];
    requestPoster("o", "t", id(1), (uri) => done.push(uri));
    requestPoster("o", "t", id(1), (uri) => done.push(uri));
    expect(grabs).toHaveLength(1);
    grabs[0].resolve("cache/VideoThumbnails/a.jpg");
    await settle();
    expect(done).toHaveLength(2);
  });

  it("doesn't ask again for a minute after one didn't come", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const done: (string | null)[] = [];
    requestPoster("o", "t", id(1), (uri) => done.push(uri));
    grabs[0].reject();
    await settle();
    expect(done).toEqual([null]);
    requestPoster("o", "t", id(1), () => {});
    expect(grabs).toHaveLength(1);
    vi.setSystemTime(Date.now() + 61_000);
    requestPoster("o", "t", id(1), () => {});
    expect(grabs).toHaveLength(2);
  });

  it("keeps nothing that lands after sign-out", async () => {
    const done: (string | null)[] = [];
    requestPoster("o", "t", id(1), (uri) => done.push(uri));
    clearPosters();
    grabs[0].resolve("cache/VideoThumbnails/a.jpg");
    await settle();
    expect(done).toEqual([]);
    expect(cachedPoster(id(1))).toBeNull();
    expect(disk.size).toBe(0);
  });

  it("asks for nothing that isn't a file id", () => {
    requestPoster("o", "t", "../secrets", () => {});
    expect(grabs).toHaveLength(0);
    expect(cachedPoster("../secrets")).toBeNull();
  });
});
