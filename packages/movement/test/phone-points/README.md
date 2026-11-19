# The phone's own readings of two kept videos

Made on 2026-11-19 (52a-ii-a) with `corepack pnpm --filter @app/movement keep-phone-points` from 51b-i's runs on the
laptop (`measured/phone-test/phone/people-1-laptop-pictures`, which git ignores): Kd's phone (moto g35 5G) running Google's
pose model on the laptop's own pictures of `squat_reference` and `chair_squat_reference`, asked for one person. Three runs
for each: the full model on the main chip on 4 cores (the chosen set-up, 51b-ii), the full model on the graphics chip, and
the small model on the main chip on 4 cores. Each file holds the very frames of the kept file of the same name in
`../body-points`, so a frame's gap from it is what that chip reads apart from the laptop.

`scripts/replays.ts` (`chipsGap`) carries that gap onto every video of the proof. The files say `source: "phone"` and never
set a number (`bodyCheck.ts` `videoOf`). Only body points are kept, never a picture.
