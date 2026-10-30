// A real phone photo for the meal scan's tests: the scan route rebuilds a photo before the scanner
// sees it (ROADMAP Stage 5 33b-i), so made-up bytes are refused. It carries a GPS position
// (`photos/README.md`, progressive-exif-between-scans.jpg).
import { readFileSync } from "node:fs";

export const MEAL_PHOTO_BYTES = readFileSync(new URL("./photos/progressive-exif-between-scans.jpg", import.meta.url));
export const MEAL_PHOTO = MEAL_PHOTO_BYTES.toString("base64");
