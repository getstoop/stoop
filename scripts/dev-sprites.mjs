// Pixel-art avatars for the dev cast: a small sprite, mirrored down the
// middle, on a dark square, drawn from a seed (a username, a space name)
// so the same account looks the same after every reset. Encoded as a PNG
// by hand, so the seed scripts need no packages.

import { deflateSync } from "node:zlib";

const SIZE = 256;
const GRID = 11; // the sprite, odd so it has a middle column
const CELL = 16; // 11 cells of 16 px, centred in 256 with a margin
const BACKGROUNDS = [
  [0x16, 0x17, 0x1d], [0x1b, 0x1f, 0x2e], [0x22, 0x18, 0x24], [0x14, 0x22, 0x1f],
];
const BODIES = [
  [0xf2, 0xf2, 0xf2], [0x7e, 0xe0, 0xb0], [0xff, 0xc1, 0x4d], [0x6c, 0xc4, 0xff],
  [0xff, 0x7a, 0x6b], [0xc3, 0x9b, 0xff], [0xff, 0x9e, 0xd1], [0xb8, 0xe9, 0x5a],
];
const ACCENTS = [
  [0xe2, 0x2b, 0x2b], [0x2b, 0x4b, 0xe2], [0xff, 0xe0, 0x3d], [0x2b, 0xc4, 0x8a],
];

// spritePng is the avatar for seed, a 256 px square PNG.
export function spritePng(seed) {
  const random = mulberry32(fnv1a(seed));
  const pick = (list) => list[Math.floor(random() * list.length)];
  const background = pick(BACKGROUNDS);
  const body = pick(BODIES);
  // An accent near the body's colour would vanish into it.
  const apart = ACCENTS.filter((color) => color.reduce((sum, value, i) => sum + Math.abs(value - body[i]), 0) > 250);
  const accent = pick(apart);

  const cells = shape(random);
  const pixels = Buffer.alloc(SIZE * SIZE * 3);
  const offset = (SIZE - GRID * CELL) / 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const column = Math.floor((x - offset) / CELL);
      const row = Math.floor((y - offset) / CELL);
      const inside = x >= offset && y >= offset && column < GRID && row < GRID;
      const cell = inside ? cells[row][column] : 0;
      const color = cell === 2 ? accent : cell === 1 ? body : background;
      pixels.set(color, (y * SIZE + x) * 3);
    }
  }
  return png(pixels);
}

// The sprite's cells (0 empty, 1 body, 2 accent): the left half and the
// middle column drawn at random, filled more often towards the middle,
// then mirrored, less any cell touching no other (a stray dot). One too
// sparse or too solid to read is drawn again.
function shape(random) {
  const half = (GRID + 1) / 2;
  for (;;) {
    const drawn = [];
    for (let row = 0; row < GRID; row++) {
      const line = new Array(GRID).fill(0);
      for (let column = 0; column < half; column++) {
        const inward = column / (half - 1);
        if (random() < 0.2 + 0.45 * inward) {
          line[column] = random() < 0.15 ? 2 : 1;
          line[GRID - 1 - column] = line[column];
        }
      }
      drawn.push(line);
    }
    const at = (row, column) => drawn[row]?.[column] ?? 0;
    let filled = 0;
    const cells = drawn.map((line, row) =>
      line.map((cell, column) => {
        const touching = at(row - 1, column) || at(row + 1, column) || at(row, column - 1) || at(row, column + 1);
        if (cell && touching) filled++;
        return touching ? cell : 0;
      }),
    );
    const share = filled / (GRID * GRID);
    if (share > 0.35 && share < 0.6) return cells;
  }
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function mulberry32(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// An 8-bit RGB PNG of the pixels, each row behind a "no filter" byte.
function png(pixels) {
  const rows = Buffer.alloc(SIZE * (SIZE * 3 + 1));
  for (let y = 0; y < SIZE; y++) {
    pixels.copy(rows, y * (SIZE * 3 + 1) + 1, y * SIZE * 3, (y + 1) * SIZE * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
