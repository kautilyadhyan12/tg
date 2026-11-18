# Body points of Kd's reference videos

Made on 2026-11-18 (51c) with
`corepack pnpm --filter @app/movement measure-points "<video>" --keep --replace` from his own folder,
`D:\vidoe referene`; the videos never go to git. Each file is what the phone's own pose model (Google's full
model, as pinned in `scripts/phoneRun.ts`) saw at 30 frames a second, asked for one person, as the phone asks
(51b-ii): `--keep` refuses any other model or number of people. Read with `decodeBodyPoints`
(`scripts/bodyPoints.ts`). The files of 2026-11-16 (50c-i: the heavy model, asked for six) are in git's history.

Asked for one person the model gives one body in every frame, whoever it is, so which videos may set a fitted
number is written in `scripts/keptVideos.ts` after their pictures were looked at, and checked by the plain sign of a
changed body (`bodyChanges`, `scripts/follow.ts`); a video not written there sets nothing.

`corepack pnpm --filter @app/movement body-check` runs the possible-body check and the steady points on all of them
(50c-ii), sets the fitted numbers from them and draws every refused frame into `measured/<label>/body-check/`.
`corepack pnpm --filter @app/movement measure-check` takes the body measures of each, flat and in 3D (50c-iii), says
which reading is the steadier and draws eight frames a video with their numbers into `measured/<label>/measure-check/`.

| File | What it shows | Frames | People | Sets numbers |
|---|---|---|---|---|
| `squat_reference` | a squat, side on | 327 | one in every frame | yes |
| `chair_squat_reference` | a chair squat, side on, a mirror behind her | 224 | one in every frame | yes |
| `bicep_curl_reference` | a bicep curl, side on, the feet below the picture | 174 | one in every frame | yes |
| `bicycle_crunch_reference` | a bicycle crunch | 290 | one in every frame | yes |
| `barbell_bench_press_reference` | a barbell bench press, filmed from the feet | 667 | the man in every frame, never his reflection | no: his knees and feet off the picture |
| `dumbbell_bench_press_reference_head_end` | a dumbbell bench press from the head end, a coach's "mistakes" clip with a text card over the chest | 372 | the man; nobody in 6 | no: his knees and feet hidden |

`../outside/` holds two files of the heavy model asked for six, kept only as cases from outside these: the squat,
which Kd's own `analyze_squat.py` measured on the heavy model's points (the measuring is checked on it), and 0.8 s
of the barbell video where the stand-in follower changes bodies (the plain sign is checked on it). Neither sets a
number.
