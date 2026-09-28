// How long the photo cleaner keeps the server busy on the worst 2 MB files: a real phone
// photo, and files built only to make it work (thousands of empty JPEG comments, empty
// PNG chunks). ROADMAP 20c-iv-b, review round one L6.
//   corepack pnpm --filter api exec tsx tools/measure-photo-worst.ts <phone-photo.jpg>
import { readFileSync } from "node:fs";
import { GYM_PAGE_PHOTO_MAX_BYTES } from "@app/shared";
import { cleanPhoto } from "../src/modules/orgs/gymPage/photoBytes.js";

const photo = process.argv[2];
if (photo === undefined) throw new Error("usage: measure-photo-worst.ts <phone-photo.jpg>");
const phone = readFileSync(photo);

const comments = Buffer.alloc(GYM_PAGE_PHOTO_MAX_BYTES);
comments.set([0xff, 0xd8]);
for (let at = 2; at + 4 <= comments.length; at += 4) comments.set([0xff, 0xfe, 0x00, 0x02], at);

const png = Buffer.alloc(GYM_PAGE_PHOTO_MAX_BYTES);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
png.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 120, 0, 0, 0, 101, 8, 2, 0, 0, 0, 0, 0, 0, 0], 8);
for (let at = 33; at + 12 <= png.length; at += 12) png.set([0, 0, 0, 0, 0x71, 0x71, 0x71, 0x71, 0, 0, 0, 0], at);

for (const [name, bytes] of [
  ["phone photo", phone],
  ["2 MB of empty JPEG comments", comments],
  ["2 MB of empty PNG chunks", png],
] as const) {
  const runs: string[] = [];
  let answer = "";
  for (let i = 0; i < 5; i++) {
    const start = process.hrtime.bigint();
    const read = cleanPhoto(new Uint8Array(bytes));
    runs.push((Number(process.hrtime.bigint() - start) / 1e6).toFixed(1));
    answer = read.ok ? "kept" : read.problem;
  }
  console.log(`${name} (${String(bytes.length)} bytes): ${answer}, ${runs.join(" / ")} ms`);
}
