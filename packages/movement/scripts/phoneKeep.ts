// The checks a phone run passes before it is kept as body points (keep-phone-points.ts; ROADMAP 52a-ii-a and 52a-iii).
// A run is kept only when it is the phone's own model, asked for one person with the laptop's own settings, reading the
// laptop's own pictures of the kept file's very frames, from the set-up its name says, for the plan its folder kept, and
// the plan says those were the laptop's pictures of this video. The kept file says the run's own picture size.
import type { BodyPointsHeader, MovementFrame } from "@app/shared";
import { BodyPointsError, type BodyPoints } from "./bodyPoints.js";
import { MODELS, SETTINGS, phoneFrames, type PhoneRun } from "./phoneRun.js";
import { phoneLabel } from "./replays.js";

/** The plan a run's folder kept, by its own check sum, and what it gave the phone for each video. */
export interface KeptPlan {
  readonly sum: string;
  readonly videos: readonly { readonly label: string; readonly sha256: string; readonly pictures: "video" | "laptop" }[];
}

/** The set-up a run's name says: `<model>.<cpu|gpu>[.t<cores>]`. */
function setUpOf(run: string): { model: string; delegate: string; threads: number | null } | null {
  const m = /^([a-z_]+)\.(cpu|gpu)(?:\.t([1-8]))?$/.exec(run);
  if (m === null || m[1] === undefined || m[2] === undefined) return null;
  return { model: m[1], delegate: m[2], threads: m[3] === undefined ? null : Number(m[3]) };
}

/** The phone's run as a body-points file beside the kept one, or a thrown reason it cannot be kept. */
export function phoneBodyPoints(kept: BodyPoints, phone: PhoneRun, label: string, run: string, plan: KeptPlan): { header: BodyPointsHeader; frames: MovementFrame[] } {
  const no = (why: string): never => {
    throw new BodyPointsError(`${label}.${run}: ${why}`);
  };
  const h = phone.header;
  const setUp = setUpOf(run) ?? no("the run's name says no set-up");
  const model = MODELS.find((m) => m.name === h.model.file);
  if (kept.header.label !== label || h.label !== label) no(`the files are labelled ${kept.header.label} and ${h.label}`);
  if (h.pictures !== "laptop") no("the phone decoded the video itself, not the laptop's pictures");
  if (h.model.people !== 1) no(`the model was asked for ${String(h.model.people)} people, not one`);
  if (model === undefined || model.sha256 !== h.model.sha256) no("not one of the pinned models");
  if (h.model.minDetection !== SETTINGS.minDetection || h.model.minPresence !== SETTINGS.minPresence || h.model.minTracking !== SETTINGS.minTracking) {
    no("the model ran with other settings than the laptop's");
  }
  if (h.model.file !== setUp.model || h.delegate !== setUp.delegate || h.threads !== setUp.threads) no("the file says another set-up than its name");
  if (h.picture.width !== kept.header.picture.width || h.picture.height !== kept.header.picture.height) {
    no(`the phone read pictures of ${String(h.picture.width)} by ${String(h.picture.height)}, the kept file's are ${String(kept.header.picture.width)} by ${String(kept.header.picture.height)}`);
  }
  if (h.plan !== plan.sum) no("it was made for another plan than its folder kept");
  const given = plan.videos.find((v) => v.label === label) ?? no("its plan names no such video");
  if (given.pictures !== "laptop" || given.sha256 !== h.video.sha256) no("it read other pictures than its plan gave it");
  const frames = phoneFrames(phone);
  if (frames.length !== kept.frames.length || frames.some((f, k) => Math.abs(f.t - (kept.frames[k]?.t ?? Number.NaN)) > 0.5)) {
    no("its frames are not the kept file's");
  }
  // A name of its own, never the laptop file's: only the check number would tell them apart.
  const header: BodyPointsHeader = {
    ...kept.header,
    label: phoneLabel(label, run),
    source: "phone",
    picture: { width: h.picture.width, height: h.picture.height },
    model: { ...kept.header.model, file: h.model.file, people: h.model.people, minDetection: h.model.minDetection, minPresence: h.model.minPresence, minTracking: h.model.minTracking },
    madeWith: { tool: "keep-phone-points", version: 1 },
  };
  return { header, frames };
}
