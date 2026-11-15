import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export interface Png {
  width: number;
  height: number;
  /** 2 = colour, no transparency; 6 = colour with transparency. */
  colourType: number;
  chunks: string[];
  /** Bytes per pixel: 3 or 4. */
  channels: number;
  /** The unfiltered pixels, row after row. */
  pixels: Uint8Array;
}

/** Reads an 8-bit colour PNG (types 2 and 6), enough to look inside the brand pictures in a test. */
export function readPng(path: string): Png {
  const b = readFileSync(path);
  if (b.subarray(1, 4).toString("latin1") !== "PNG") throw new Error(`${path} is not a PNG`);
  const chunks: string[] = [];
  const idat: Buffer[] = [];
  let width = 0;
  let height = 0;
  let colourType = 0;
  let bitDepth = 0;
  for (let at = 8; at < b.length; ) {
    const length = b.readUInt32BE(at);
    const type = b.subarray(at + 4, at + 8).toString("latin1");
    const data = b.subarray(at + 8, at + 8 + length);
    chunks.push(type);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colourType = data.readUInt8(9);
    } else if (type === "IDAT") {
      idat.push(data);
    }
    at += 12 + length;
  }
  if (bitDepth !== 8 || (colourType !== 2 && colourType !== 6)) throw new Error(`${path}: only 8-bit colour PNGs are read`);
  const channels = colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= channels ? (pixels[(y - 1) * stride + x - channels] ?? 0) : 0;
      const value = row[x] ?? 0;
      let out: number;
      if (filter === 0) out = value;
      else if (filter === 1) out = value + left;
      else if (filter === 2) out = value + up;
      else if (filter === 3) out = value + Math.floor((left + up) / 2);
      else {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        out = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      pixels[y * stride + x] = out & 0xff;
    }
  }
  return { width, height, colourType, chunks, channels, pixels };
}

/** The pixel at (x, y) as [r, g, b, a]; a is 255 for a picture without transparency. */
export function pixel(png: Png, x: number, y: number): [number, number, number, number] {
  const i = (y * png.width + x) * png.channels;
  const p = png.pixels;
  return [p[i] ?? 0, p[i + 1] ?? 0, p[i + 2] ?? 0, png.channels === 4 ? (p[i + 3] ?? 0) : 255];
}
