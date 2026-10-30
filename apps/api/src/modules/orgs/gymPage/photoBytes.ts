// The photo cleaner lives in the shared package, so the phone cleans a meal photo with the same one
// before it is sent (ROADMAP Stage 5 33b-i).
export { cleanPhoto, exifOrientation, type PhotoProblem, type PhotoReading } from "@app/shared";
