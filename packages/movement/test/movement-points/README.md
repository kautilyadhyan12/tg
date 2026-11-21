# Body points of the videos a movement is proven on

Made on 2026-11-19 (52a) from Kd's folder `D:\exercise video collection` with
`corepack pnpm --filter @app/movement measure-points "<video>" --label <name> --keep`, then moved here from
`../body-points`, whose files set the body's own numbers (50c) and are kept apart. Each is what the phone's own pose model
saw at 30 frames a second, asked for one person, as the phone asks. The videos never go to git.

`scripts/movementVideos.ts` says, for each file, the movement it shows (or another movement, which must count 0), the
person, where the phone stood, the reps counted by eye, and whether it may set a movement's numbers; `scripts/movementCheck.ts`
says how the numbers are set. `corepack pnpm --filter @app/movement movement-check` prints the proof table;
`--write` puts the numbers into `movements/<name>.json`.

Three files are cut from a video, never the video itself: `sumo_squat_2a` and `sumo_squat_2b` are the two people of
`sumo squat2.mp4` before and after its cut at 12.2 s; `squat_normal_2` is `squat2.mp4` to 4.55 s, before it cuts from the
man half way down to him standing. A file whose name starts `fresh_` was measured after the squat's rules and numbers were
fixed, and was never used to choose them: it is the squat's test on videos nobody had looked at.

`floor_phone_test` and `usual_v02` to `usual_v14` (52a-ii-b-i, 2026-11-20) are a man's own videos with his phone on the floor
and raised, measured from even copies at 30 pictures a second (a phone's recording has uneven frame times): squats in three of
them, played as sets by `cut`, the usual positions of other exercises in eleven. The videos stay on his laptop; exercise
folder 1's `reviews/floor-phone/README.md` says what each shows.
