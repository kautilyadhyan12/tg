# Body points of Kd's reference videos

Made on 2026-11-16 (50c-i) with
`corepack pnpm --filter @app/movement measure-points "<video>" --keep` from his own folder,
`D:\vidoe referene`; the videos never go to git. Each file is what the heavy pose model saw
at 30 frames a second, asked for up to six people: every person in every frame, read with
`decodeBodyPoints` (`scripts/bodyPoints.ts`). Which person is the one exercising, and what a
person counts by eye, are not in these files (jobs 52d and 52a).

`corepack pnpm --filter @app/movement body-check` runs the possible-body check and the steady
points on all of them (50c-ii), sets the fitted numbers from them and draws every refused frame
into `measured/<label>/body-check/`.

| File | What it shows | Frames | People the model found |
|---|---|---|---|
| `squat_reference` | a squat, side on | 327 | one in every frame |
| `chair_squat_reference` | a chair squat, side on, a mirror behind her | 224 | one in every frame |
| `bicep_curl_reference` | a bicep curl, side on, the feet below the picture | 174 | one in every frame |
| `bicycle_crunch_reference` | a bicycle crunch | 290 | one in every frame |
| `barbell_bench_press_reference` | a barbell bench press, filmed from the feet | 667 | up to four: the man, his reflection in the mirror, and the man found twice; nobody in 29 |
| `dumbbell_bench_press_reference_head_end` | a dumbbell bench press from the head end, a coach's "mistakes" clip with a text card over the chest | 372 | up to three, all the one man found more than once; nobody in 37 |
