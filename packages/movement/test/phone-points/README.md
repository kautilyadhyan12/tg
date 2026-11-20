# The phone's own readings of the proof videos

Made with `corepack pnpm --filter @app/movement keep-phone-points` from the phone test's runs on the laptop
(`measured/phone-test/phone/people-1-laptop-pictures*`, which git ignores): Kd's phone (moto g35 5G) running Google's pose
model on the laptop's own pictures of each video, asked for one person. Each file holds the very frames of the kept file of
the same name in `../body-points` or `../movement-points`, so a frame's gap from it is what that chip reads apart from the
laptop.

- **The replays (52a-ii-a, 2026-11-19, from 51b-i's runs):** `squat_reference` and `chair_squat_reference` from three
  set-ups: the full model on the main chip on 4 cores (the chosen set-up, 51b-ii), the full model on the graphics chip, and the
  small model on the main chip on 4 cores. `scripts/replays.ts` (`chipsGap`) carries that gap onto every video of the proof.
- **The phone's own runs judged (52a-iii, 2026-11-20):** every proof video (`scripts/movementVideos.ts`) from the chosen set-up,
  `<label>.pose_landmarker_full.cpu.t4.bodypoints`. `scripts/phoneCounts.ts` judges each by the laptop's count and reasons.

The files say `source: "phone"` and never set a number (`bodyCheck.ts` `videoOf`). Only body points are kept, never a picture.
