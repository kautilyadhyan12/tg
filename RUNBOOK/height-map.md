# The height map under a run's elevation gain

ROADMAP Stage 5 item 37b-ii; `apps/api/src/modules/geo/heights.adapter.ts`; the maths in
`packages/shared/src/runClimb.ts`; Kd's rulings in `rulings/2026-11-06-37b-ii.md`. The server works
out how many metres a run climbed from two free public height maps it keeps on its own disk, one file
per degree square (about 110 km a side) a run has been in. Nothing about a run ever goes to either
map's owner: the server fetches a whole square by its name, once, the first time any run reaches it.

## What it keeps

| Map | What it is | Where it comes from | A square |
|---|---|---|---|
| Copernicus GLO-30 | the surface, roofs and treetops included; true on open ground and beaches | `https://copernicus-dem-30m.s3.amazonaws.com/<name>/<name>.tif` (AWS open data, free, no account) | 15.8 to 48.6 MB (seven measured 2026-11-06) |
| Mapzen terrain tiles ("skadi") | the bare ground: the US survey's 3DEP in the US, NASA's SRTM in most other places | `https://elevation-tiles-prod.s3.amazonaws.com/skadi/N28/N28W081.hgt.gz` (AWS open data, free, no account) | 2.0 to 11.1 MB packed, 25.9 MB kept unpacked |

A place's height is the lower of the two: the ground is never above a roof, and Mapzen's coasts hold
false bumps that Copernicus does not. Measured on 2026-11-06 against the US survey's own ground, the
lower of the two was within 2 m on every case where either alone was off by up to 146 m
(`packages/shared/test/fixtures/real-climbs.json`).

In `HEIGHTS_DIR`, per square: `<copernicus name>.tif` and `.json` (its checked header) and `<N28W081>.hgt`.
Only squares on Copernicus's own list of land are ever asked (`apps/api/src/modules/geo/copernicusSquares.ts`,
made from its `tileList.txt`, 26,450 squares): the sea has no heights and is never fetched; in Armenia and
Azerbaijan, which Copernicus withholds, the Mapzen map alone is read. At 20 gyms in about 15 cities that is
15 to 30 squares, about 2 GB; it grows only where members run. It never passes `HEIGHTS_MOST_SQUARES_KEPT`
squares for each map (200 unless set: about 5.2 GB of Mapzen, 9.7 GB of Copernicus at most). Each map downloads
one square at a time, 30 new squares an hour at most, and one person's runs bring at most 6 new squares a
day (counted in Redis). A run in more than 6 squares (no runner's) has no number.

## Settings

- `HEIGHTS_DIR`: the folder, on a disk that lasts (required in production; elsewhere a folder under
  the system's temporary one).
- `HEIGHTS_COPERNICUS`, `HEIGHTS_MAPZEN`: where each map is fetched from; the AWS copies above unless
  set, `https://` in production. Under the tests nothing is ever fetched.
- `HEIGHTS_MOST_SQUARES_KEPT`: the most squares each map keeps (200 unless set). Reaching it logs
  `geo.heights_disk_full` at error: new places then wait, and after three days have no number. Raise it
  when real members reach that many places and the disk has room (ls `HEIGHTS_DIR`: `*.json` and `*.hgt`).
  If made-up runs filled it (about 34 accounts can, at 6 new squares each a day), the files are only a copy:
  stop the api and the worker, delete every `.tif`, `.json` and `.hgt` in `HEIGHTS_DIR`, and start them
  again. The places members run in come back as they run, each person bringing 6 a day. The api and the
  worker each count the folder before a download, so the ceiling can be passed by a square or two.

## How a run gets its number

1. The summary on the phone asks `POST /v1/geo/runs/climb` with the points Save will send. The server
   waits up to 25 s for a square it does not have yet; past that the phone shows "--" and asks again
   every 30 s, for 15 minutes at most.
2. Save works it out again from the same points and keeps it (`runs.climb_m`, `runs.climb_state`).
   It waits up to 10 s for a missing square, then saves the run `waiting`.
3. The worker (`geo.climb_sweep`, minutes 14, 29, 44 and 59) works out up to 50 `waiting` runs each time.

A square that failed to arrive (a 404 included: every square asked is land, so a 404 means the source has
gone or moved) is not fetched again for 10 minutes. A file that is not one this server reads, or unpacks
bigger than it should, is logged as `geo.heights_bad_file` and not kept. A run still `waiting` three days
after it was saved gives up: `none`. Past 30 new squares in an hour, `geo.heights_hour_full` is logged and
the runs wait for the next hour.

## Symptoms

- Many runs stay `waiting`: `SELECT count(*) FROM runs WHERE climb_state = 'waiting'`. Look for
  `geo.heights_fetch_failed` in the logs (its `status` or `errName`), and try one address from the
  server with `curl -I`.
- `geo.heights_bad_file`: the source changed its files. Do not delete anything; ask the terminal.

## If a source stops

Copy the same files to our own storage (a Cloudflare R2 bucket with a public domain, as the run map's
own copy, `RUNBOOK/switch-the-map.md`), keeping their paths, set `HEIGHTS_COPERNICUS` or
`HEIGHTS_MAPZEN` to it and restart the api and the worker. Squares already kept are read from the disk
as before.

## Limits, measured 2026-11-06

- **Bridges:** both maps hold the ground under a bridge, so a bridge's own climb is not counted
  (a Garmin's barometer read 49 m on a Florida run over a causeway; both maps 0). Strava says the same
  of its public maps.
- **Tower blocks outside the US:** where Mapzen is NASA's SRTM, the lower of the two still reads roofs
  among tall buildings: on Manhattan's Fifth and Park Avenues, worked with SRTM in Mapzen's place, 43 m
  and 72 m against 20 m and 19 m of ground. On three- and four-storey and low-rise streets it was within
  1 m (Brooklyn, Queens).

## Credits

`HEIGHT_MAP_CREDITS` in `packages/shared/src/runClimb.ts` holds every line both licences ask for: the
Copernicus WorldDEM-30 licence's Article 6(b) and 6(c), word for word, and the Mapzen tiles' list
(`github.com/tilezen/joerd/blob/master/docs/attribution.md`). The run's summary shows a small (i) beside the
number, as the run map's own, that opens the whole list. The Terms (Stage 5 item 21) also carry Copernicus's
sentence that its organisations "do not incur any liability for any use of the Copernicus WorldDEM-30".
