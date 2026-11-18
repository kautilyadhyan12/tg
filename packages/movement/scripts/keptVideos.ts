// The kept reference videos (test/body-points) and which of them may set a fitted number (ROADMAP 51c).
//
// Every kept file is measured as the phone measures (51b-ii): the full model, asked for one person, at 30 frames a
// second. Asked for one, the model follows whichever body it finds first, so "one body in every frame" says nothing
// about WHO it is: a reflection or a passer-by would look the same. A video sets numbers only when a terminal has
// drawn it, frames spread over the whole video, and seen the person exercising in every frame drawn; that look is
// tied to the very file looked at by its check number, so a file measured again sets nothing until it is looked at
// again. bodyCheck.ts `videoOf` adds what the file itself must show (one body in every frame, its size readable, no
// sign that the body changed).

/** The model, people asked for and frames a second of every kept file: the phone's own (51b-ii). */
export const KEPT_MODEL = { file: "pose_landmarker_full", people: 1, fps: 30 } as const;

export interface KeptVideo {
  /** True only after its pictures were drawn and looked at. */
  readonly sets: boolean;
  /** The SHA-256 of the .bodypoints file that was looked at; a video that sets numbers names one. */
  readonly sha256?: string;
  /** What the pictures showed, in a line. */
  readonly seen: string;
}

export const KEPT_VIDEOS: Readonly<Record<string, KeptVideo>> = {
  squat_reference: {
    sets: true,
    sha256: "64ba24b76a8d665aa8b80d773bee3c8403921bba66bfcb7f2e46a41af500f67c",
    seen: "2026-11-18, 16 frames drawn across the video: she is the only person, side on, the whole body in each.",
  },
  chair_squat_reference: {
    sets: true,
    sha256: "2e6d5f36279a3a47e66ace040ad85d37619873925dc88dd540b2285399fd1b6a",
    seen: "2026-11-18, 16 frames drawn across the video: side on, her in each; the mirror behind her holds no body the model follows.",
  },
  bicep_curl_reference: {
    sets: true,
    sha256: "ce6f8351f78f82755f174841d19e5aa34b5658a54f4da66fac2008056fc2b49d",
    seen: "2026-11-18, 16 frames drawn across the video: side on, the one man in each, his feet below the picture.",
  },
  bicycle_crunch_reference: {
    sets: true,
    sha256: "747d56ed458085f8a4d930b9b72380dd0a71bd04f948c131dfb2f543f1bafe3c",
    seen: "2026-11-18, 16 frames drawn across the video and 14 from 0.4 to 1.7 s: the one man on the floor in each.",
  },
  barbell_bench_press_reference: {
    sets: false,
    seen:
      "2026-11-18, 16 frames drawn across the video: the man in each, never his reflection; but filmed from the feet, " +
      "his knees lie off the picture and his feet below it: it tries the refusals and sets no number.",
  },
  dumbbell_bench_press_reference_head_end: {
    sets: false,
    seen:
      "2026-11-18, 16 frames drawn across the video: the one man in each; from the head end the model marks his knees " +
      "and feet hidden: it tries the refusals and sets no number.",
  },
};
