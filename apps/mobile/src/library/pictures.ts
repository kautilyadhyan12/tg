// An exercise's picture on the phone, until job 62 gives each exercise its own still picture (its file's
// `picture`): the app's own picture of that exercise where it has one, else a picture of its kind.
import type { PictureName } from "../look/pictures";

const OWN: Readonly<Record<string, PictureName>> = { squat: "squat", plank: "plank" };
const OF_KIND: Readonly<Record<string, PictureName>> = {
  strength: "benchpress",
  cardio: "ropping",
  plyometrics: "jumpsquat",
  stretching: "yoga1",
  mobility: "balance",
  yoga: "yoga",
  pilates: "greekyoga",
};

export function exercisePicture(id: string, kind: string): PictureName {
  return OWN[id] ?? OF_KIND[kind] ?? "exhero";
}
