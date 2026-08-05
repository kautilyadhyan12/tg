// P2.8 web repoint (exercise library card) — the catalog read now rides the
// NEW /v1 API via the Card-1 cookie client. Shape is @app/shared `catalog.ts`
// (`catalogPageSchema`); `api/exerciseLibrary.js` is the reader that joins each
// row to its words and turns the result into what the library draws.
//
// THIS FILE PREVIOUSLY SAID "DELIBERATELY NOT REPOINTED", and its reasoning was
// sound at the time and is now discharged rather than overruled: the catalog
// stored none of the content the screen renders, so the page stayed on the old
// backend under the no-removal rule. Kd ruled on 2026-08-05 that the content
// ships as a FILE in @app/shared (the Part 4 §3.4 DDL declares no column for it
// and `name_key` says why), which gives the words a home without a migration.
// Nothing was removed to make the repoint fit — see the reader's header for
// where each of the five old behaviours went.
//
// FOUR OLD CALLS ARE GONE FROM THIS FILE. None of them is a feature being
// dropped; three had NO CALLER AT ALL (verified by grep across apps/web/src —
// `exerciseService` is imported by exactly one file, `ExerciseLibrary.jsx`, and
// it used only `getExercises` and `getExercise`):
//   getCategories — the category pills are a hardcoded list in the page with
//                   their own images; this endpoint was never called. The pills
//                   are now checked AGAINST the data (`categoryNames`), so the
//                   feature is better served, not lost.
//   getMuscles    — never called. Muscle chips render from each exercise's own
//                   `muscles_primary`, as they always did.
//   getMedia      — never called. Photos and demo GIFs are files inside this app
//                   (`utils/exerciseMedia.js`), matched by name; the old
//                   endpoint was a metered RapidAPI lookup the page never used.
//   getExercise   — the `?exercise=<id>` deep link. It took a Mongo id, which
//                   the new database does not have. The panel now opens from the
//                   rows already read, so the link costs no request at all; see
//                   the reader's note 4 for the Dashboard half, which is owed.
import authApi from './authApi';

export const exerciseService = {
  /** NEW API. One keyset page of the catalog — `@app/shared`
   *  `catalogListQuerySchema` (`{ limit ≤ 100, cursor }`, `.strict()`), and
   *  `.strict()` is why no `search`/`category`/`page` may be added here: an
   *  unknown key is a 400, by design. Filtering is the reader's job.
   *
   *  Callers should use `fetchAllExercises` rather than this directly — the
   *  catalog is read whole (58 rows) and a lone page is not the library. */
  getExercisePage: (params) => authApi.get('/v1/exercises', { params }),
};
