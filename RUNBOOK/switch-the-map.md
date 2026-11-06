# Move every phone's run map to our own copy

ROADMAP Stage 5 item 37b-i; `apps/api/src/modules/geo/mapSource.ts`; Kd's rulings in
`rulings/2026-11-06-37b-i.md`. The phones draw a run on OpenFreeMap's public map
(openfreemap.org: free, no limit on views, run by one person on donations, no guarantee). The
server tells every phone which map to read (`GET /v1/geo/map`), so moving to our own copy needs a
server setting and no new app version. Until it is done, runs still record and their trail still
draws, on a plain background.

## Symptoms

- Run maps show no streets for everybody, with the internet on, and `https://tiles.openfreemap.org/planet`
  does not answer, or answers with an error.
- openfreemap.org, or its X or Bluesky account, says the public map is closing or limiting large apps.

## What our own copy is

- **The map:** Protomaps' world map, one `.pmtiles` file, rebuilt every day from OpenStreetMap
  (ODbL; `docs.protomaps.com/basemaps/downloads` asks that it be copied to your own storage, not
  linked to). The build of 2026-11-05 was 139,339,872,322 bytes (`curl -I`, 2026-11-06). The
  phone's map engine reads the one file directly, piece by piece; no map server is run.
- **The letters** of street names: Protomaps' fonts, `github.com/protomaps/basemaps-assets`,
  folder `fonts` (SIL Open Font Licence): `Noto Sans Regular`, `Noto Sans Italic`, `Noto Sans Medium`.
- **Where:** a Cloudflare R2 bucket with a public custom domain (R2 answers the range requests the
  map engine makes, and charges nothing for traffic out; check Cloudflare's own price page for
  storage before starting; the sums of 2026-08-24 were about $2 a month for the world).

## Steps

1. Make the bucket and its public domain (for example `maps.<our domain>`) in Cloudflare's dashboard.
2. Copy the newest build into it, from a machine with a fast line (a cloud machine, not the laptop):
   find the newest file at `https://maps.protomaps.com/builds/`, then copy
   `https://build.protomaps.com/<YYYYMMDD>.pmtiles` to the bucket as `world.pmtiles`
   (`rclone copyurl`, or download then `rclone copy`, which uploads large files in parts).
   A smaller copy of only the countries we serve: `pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles ours.pmtiles --bbox=<west>,<south>,<east>,<north>`
   (the `pmtiles` tool: `github.com/protomaps/go-pmtiles/releases`).
3. Copy the three font folders into the bucket under `fonts/`, keeping their names.
4. Check from a browser that `https://maps.<our domain>/world.pmtiles` answers and that
   `https://maps.<our domain>/fonts/Noto%20Sans%20Regular/0-255.pbf` downloads.
5. On the server, set and restart the api:

   ```
   MAP_SOURCE=protomaps
   MAP_PROTOMAPS_FILE=https://maps.<our domain>/world.pmtiles
   MAP_PROTOMAPS_GLYPHS=https://maps.<our domain>/fonts/{fontstack}/{range}.pbf
   ```

   The api refuses to start with one of the three missing, or with `http://` in production.

## Going back

Remove the three settings (or set `MAP_SOURCE=openfreemap`) and restart the api. Each phone reads
OpenFreeMap's again the next time a run's map opens.

## Keeping it fresh

OpenStreetMap changes every day; the copy does not. Copy a newer build every few months (steps 2
and 4); the phones need nothing.

## Verify recovered

- Signed in, `GET /v1/geo/map` answers `"maker":"protomaps"` and the two addresses above.
- On a phone: open a run's map (start a run, or a saved run's summary). Streets show; the corner
  says `Protomaps © OpenStreetMap`. A phone that was offline moves over the next time a run's map opens.
