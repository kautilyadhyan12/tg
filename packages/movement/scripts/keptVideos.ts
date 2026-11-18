// The kept reference videos (test/body-points) and which of them may set a fitted number (ROADMAP 51c).
//
// Every kept file is measured as the phone measures (51b-ii): the full model, asked for one person. Asked for one,
// the model follows whichever body it finds first, so "one body in every frame" says nothing about WHO it is: a
// reflection or a passer-by would look the same. A video sets numbers only when a terminal has drawn it and seen the
// body followed is the person exercising from its first frame to its last, AND the plain sign of a changed body
// (`bodyChanges`, follow.ts) finds none. Every other video is tried, never trusted: a video not written here sets
// nothing.

/** The model and the number of people every kept file is measured with: the phone's own (51b-ii). */
export const KEPT_MODEL = { file: "pose_landmarker_full", people: 1 } as const;

export interface KeptVideo {
  /** True only after its pictures were looked at, frame by frame, and the person followed throughout. */
  readonly sets: boolean;
  /** What the pictures showed, in a line. */
  readonly seen: string;
}

export const KEPT_VIDEOS: Readonly<Record<string, KeptVideo>> = {
  squat_reference: {
    sets: true,
    seen: "2026-11-18: she is the only person; side on, the whole body in every drawn frame.",
  },
  chair_squat_reference: {
    sets: true,
    seen: "2026-11-18: side on; the mirror behind her holds no second body the model follows.",
  },
  bicep_curl_reference: {
    sets: true,
    seen: "2026-11-18: side on, one man, the feet below the picture.",
  },
  bicycle_crunch_reference: {
    sets: true,
    seen: "2026-11-18: one person on the floor, side on.",
  },
  barbell_bench_press_reference: {
    sets: false,
    seen:
      "2026-11-18: the man in all 16 frames drawn, never his reflection; but filmed from the feet, his hips and legs " +
      "lie at the picture's edge and are drawn where they are not: it tries the refusals and sets no number.",
  },
  dumbbell_bench_press_reference_head_end: {
    sets: false,
    seen:
      "2026-11-18: the one man in all 16 frames drawn; from the head end his hips and legs are folded onto his head: " +
      "it tries the refusals and sets no number.",
  },
};
