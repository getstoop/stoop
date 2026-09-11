import { describe, expect, it, vi } from "vitest";
import {
  fileUrl,
  formatBytes,
  isInlineImage,
  isPlayableAudio,
  isPlayableVideo,
  MAX_ATTACHMENT_BYTES,
} from "./files";

// api/clients.ts builds its transport from location.origin as it loads,
// and the unit suite runs in node.
vi.hoisted(() => {
  Object.assign(globalThis, { location: new URL("http://localhost:8091") });
});

describe("fileUrl", () => {
  it("builds a path, not an absolute URL", () => {
    expect(fileUrl("f_abc123")).toBe("/files/f_abc123");
  });

  // An id with a slash must stay one path segment rather than reach a
  // different route.
  it("escapes the id", () => {
    expect(fileUrl("a/b")).toBe("/files/a%2Fb");
    expect(fileUrl("a b?c#d")).toBe("/files/a%20b%3Fc%23d");
  });
});

describe("isInlineImage", () => {
  it("accepts the four raster types the server re-encodes", () => {
    for (const t of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(isInlineImage(t)).toBe(true);
    }
  });

  // SVG is script; rendering it inline on the app origin would be XSS.
  // The server refuses it the same way (files.serveBlob → isRaster).
  it("refuses SVG", () => {
    expect(isInlineImage("image/svg+xml")).toBe(false);
    expect(isInlineImage("text/xml; charset=utf-8")).toBe(false);
  });

  it("refuses other image types", () => {
    expect(isInlineImage("image/bmp")).toBe(false);
    expect(isInlineImage("image/tiff")).toBe(false);
    expect(isInlineImage("image/avif")).toBe(false);
    expect(isInlineImage("")).toBe(false);
  });

  // Exact match, like the server's map: a type carrying parameters or an
  // odd case is a download. The sniffer only adds parameters to text
  // types, so no raster upload arrives in this shape.
  it("does not normalise the type", () => {
    expect(isInlineImage("image/png; charset=binary")).toBe(false);
    expect(isInlineImage("IMAGE/PNG")).toBe(false);
    expect(isInlineImage(" image/png")).toBe(false);
  });
});

describe("isPlayableVideo", () => {
  it("accepts the types the server serves inline", () => {
    for (const t of ["video/mp4", "video/webm", "video/quicktime"]) {
      expect(isPlayableVideo(t)).toBe(true);
    }
  });

  it("refuses anything else", () => {
    expect(isPlayableVideo("video/x-matroska")).toBe(false);
    expect(isPlayableVideo("video/mp4; codecs=avc1.42E01E")).toBe(false);
    expect(isPlayableVideo("audio/mp4")).toBe(false);
    expect(isPlayableVideo("")).toBe(false);
  });
});

describe("isPlayableAudio", () => {
  it("accepts the types the server serves inline", () => {
    for (const t of [
      "audio/mpeg",
      "audio/mp4",
      "audio/wave",
      "audio/ogg",
      "application/ogg",
    ]) {
      expect(isPlayableAudio(t)).toBe(true);
    }
  });

  // audio/wave is what the sniffer calls a WAV; the spellings a browser
  // or a client-supplied type would use are not accepted.
  it("takes only the sniffer's spelling of WAV", () => {
    expect(isPlayableAudio("audio/wav")).toBe(false);
    expect(isPlayableAudio("audio/x-wav")).toBe(false);
  });

  it("refuses anything else", () => {
    expect(isPlayableAudio("audio/webm")).toBe(false);
    expect(isPlayableAudio("audio/flac")).toBe(false);
    expect(isPlayableAudio("video/mp4")).toBe(false);
    expect(isPlayableAudio("")).toBe(false);
  });
});

describe("formatBytes", () => {
  it("counts bytes below a kibibyte", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("switches to KB at 1024", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  // One decimal below 10 KB, none from 10 KB up, so the width stays put.
  it("drops the decimal at 10 KB", () => {
    expect(formatBytes(10239)).toBe("10.0 KB");
    expect(formatBytes(10240)).toBe("10 KB");
    expect(formatBytes(20000)).toBe("20 KB");
  });

  it("rounds to the nearest tenth of a kibibyte", () => {
    expect(formatBytes(1587)).toBe("1.5 KB");
    expect(formatBytes(1690)).toBe("1.7 KB");
  });

  // The KB branch runs right up to a mebibyte, so the last few bytes
  // below 1 MB read as 1024 KB rather than 1.0 MB.
  it("switches to MB at 1048576", () => {
    expect(formatBytes(1048575)).toBe("1024 KB");
    expect(formatBytes(1048576)).toBe("1.0 MB");
    expect(formatBytes(1572864)).toBe("1.5 MB");
  });

  it("shows the attachment cap as 100.0 MB", () => {
    expect(formatBytes(MAX_ATTACHMENT_BYTES)).toBe("100.0 MB");
  });

  // MB is the last unit: nothing above it is rendered as GB.
  it("keeps counting in MB past a gibibyte", () => {
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5120.0 MB");
  });

  it("takes a bigint, as the size field on a file row is", () => {
    expect(formatBytes(0n)).toBe("0 B");
    expect(formatBytes(1023n)).toBe("1023 B");
    expect(formatBytes(1024n)).toBe("1.0 KB");
    expect(formatBytes(BigInt(MAX_ATTACHMENT_BYTES))).toBe("100.0 MB");
  });
});
