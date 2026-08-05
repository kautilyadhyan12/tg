// P2.8 web repoint (exercise library card) — the exercise LIBRARY on the NEW
// /v1 API. Discharges the RUNBOOK/cutover.md prerequisite for
// `ExerciseLibrary.jsx → exerciseApi`.
//
// The page is untestable without a DOM and this file is not, so every decision
// the repoint makes lives here and the page just draws the result — the
// `workoutHistory.js` / `activeWorkoutEngine.js` pattern.
//
// FIVE THINGS THE OLD BACKEND DID THAT THE NEW ONE DOES NOT, each answered here
// rather than faked or dropped:
//
// 1. THE WORDS. `/exercises` returned name, description, instructions, common
//    mistakes, muscles, equipment, difficulty and category out of Mongo.
//    `/v1/exercises` returns slug/nameKey/family/tier/tracking/met — the Part 4
//    §3.4 DDL declares no column for any of the rest, and inventing columns is
//    R0.2. Kd ruled 2026-08-05 that the words ship as a FILE: `EXERCISE_CONTENT`
//    in @app/shared, a verbatim port of `scripts/seed_exercises.py`, joined here
//    by slug. That is the DDL's own model — `name_key` exists because v1 §14
//    puts human text in locale tables so hi/as is a translation task.
//
// 2. SERVER-SIDE SEARCH, FILTERS AND PAGING. `/v1/exercises` takes `{limit,
//    cursor}` and nothing else (`catalogListQuerySchema` is `.strict()`), so
//    there is no `search=`, no `category=`, no `difficulty=` and no page number
//    to send. The whole catalog is 58 rows, so this file reads ALL of it in one
//    or two requests and filters in memory. Not a downgrade: search now responds
//    without a round trip, and the "Load more" button pages a list that is
//    already in hand.
//
// 3. THE TOTAL. The old response carried `total`, which the hero headline and
//    the results line print. A cursor page carries no count. Once every page is
//    read the total is simply the number of rows — an exact figure, not an
//    estimate — and `hasMore` below is about how many are being DRAWN.
//
// 4. `getExercise(<mongo id>)` FOR THE DEEP LINK. The Dashboard links
//    `/exercises?exercise=<id>` with an id minted by the OLD backend. There is
//    no by-id route on the new API and no Mongo id in the new database, so the
//    deep link now speaks SLUGS and is resolved against the rows already read —
//    no extra request. Dashboard still sends old ids until its own repoint (it
//    rides `recommendationApi`, which is still on the old backend); an id that
//    matches nothing opens nothing, exactly as a stale id does today. Tracked in
//    OWED.md rather than half-fixed from here.
//
// 5. THE "AI" BADGE. `ai_supported` is TRUE on eight rows in the Mongo seed
//    while the engine ships definitions for THREE. Kd ruled 2026-08-05: the
//    badge is a CAPABILITY, read from the definitions the client actually holds
//    (`hasDefinition` below, injected so this file stays pure). Five exercises
//    stop advertising camera form-checking that does not happen, and each new
//    published definition lights its own badge with no edit here.
//
// WHAT IS NOT FILTERED OUT ANY MORE: Mountain Pose and Brisk Walking. The web's
// `REMOVED_EXERCISES` set hid them; Part 4 §3.4:366-369 rules Mountain Pose
// `status 'live'` and says in as many words that "the `REMOVED_EXERCISES`
// frontend hack dies with the migration". Both are seeded live, so the library
// now lists 58 where it listed 56. That is the ruling, not a side effect.
import { EXERCISE_CONTENT, contentForSlug } from '@app/shared';

/** `catalogListQuerySchema`'s own ceiling (packages/shared/src/catalog.ts:27:
 *  `.max(100)`) — quoted, not chosen. Asking for more is a 400. */
export const CATALOG_PAGE_LIMIT = 100;

/** The cursor walk's hard stop. The catalog is 58 rows and the API caps a page
 *  at 100, so ONE page holds it today and a second exists only for growth. The
 *  cap is not sized to the catalog: it is the guard against a server that keeps
 *  handing back a cursor, which would otherwise spin forever. 20 pages = 2,000
 *  exercises, ~34× the catalog. */
export const CATALOG_MAX_PAGES = 20;

/** Every category a row can be FILTERED BY, first-seen order — derived, never a
 *  second hand-written list, so a category cannot exist in the data and be
 *  unreachable in the UI.
 *
 *  T3 round 1, F5: this read only `primaryCategory` while `filterLibrary` below
 *  matches the primary category OR the row's `categories` TAGS, so the pill
 *  cross-check was narrower than the claim written over it — a tag-only category
 *  would have been unreachable on screen and unnoticed by the test. Harmless
 *  today and measured so (both sets are the same 11; there are no tag-only
 *  categories), which is exactly why it needed fixing before that stopped being
 *  true. The union is now the definition, matching what the filter actually
 *  does. */
export function categoryNames(rows = EXERCISE_CONTENT) {
  const seen = [];
  const add = (v) => {
    if (typeof v === 'string' && v !== '' && !seen.includes(v)) seen.push(v);
  };
  for (const r of rows) {
    add(r.primaryCategory);
    for (const tag of r.categories || []) add(tag);
  }
  return seen;
}

/** `slug_case` → `Slug Case`, for a catalog row this build stocks no words for.
 *  A LABEL DERIVED FROM THE VALUE, never a name invented for it — the same
 *  function and the same reasoning as `workoutHistory.exerciseLabel`. */
function labelFromSlug(slug) {
  return String(slug)
    .split(/[_-]+/)
    .filter((w) => w !== '')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** One `/v1/exercises` page → its rows, or `null` when the payload is not a
 *  readable page. `null` is not "empty": the caller must be able to tell a
 *  server that answered nothing from one that answered something unreadable,
 *  because drawing an empty library reads as "there are no exercises". */
export function readCatalogPage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (!Array.isArray(data.items)) return null;
  const items = [];
  for (const item of data.items) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.slug !== 'string' || item.slug === '') continue;
    items.push(item);
  }
  // T3 round 1, F4. A page that HANDED BACK ROWS and yielded not one readable
  // row is not an empty page — it is an unreadable one, and the difference is
  // the whole point of returning null. Dropping rows one at a time meant a
  // server that renamed `slug` composed two individually-correct behaviours into
  // the exact lie the `failed` state was built to remove: "0 Exercises", "No
  // exercises found", and a "Clear filters" button blaming the user's search for
  // a payload the client could not read. An items array that is genuinely EMPTY
  // still reads as empty — that is a server saying "no rows", which is an answer.
  if (items.length === 0 && data.items.length > 0) return null;
  const cursor = typeof data.nextCursor === 'string' && data.nextCursor !== '' ? data.nextCursor : null;
  return { items, nextCursor: cursor };
}

/** Read the whole catalog. `fetchPage({ limit, cursor })` is injected so this is
 *  testable without a network and so the test can assert WHICH client was called
 *  — a repoint nothing asserts is one the next edit undoes (DECISIONS :2912).
 *
 *  Returns `{ items, truncated }`. `truncated` means the page cap was hit with a
 *  cursor still outstanding; the caller says so rather than silently drawing a
 *  short library. An unreadable page ends the walk and THROWS, because a partial
 *  catalog presented as the whole one is the failure this shape exists to stop. */
export async function fetchAllExercises(fetchPage) {
  const items = [];
  // T3 round 1, F2 — the SAME SHAPE :4855's F2 fixed on the calendar the same
  // day, one screen over. A cursor that does not ADVANCE is not hypothetical
  // (the calendar met it), and without this Set every page repeats the same rows
  // until the cap: the hero headline and the results line print an INVENTED
  // number, the grid draws each card CATALOG_MAX_PAGES times under duplicate
  // React keys, and the truncation toast says "Showing part of the library"
  // while showing 20× the library. Dedupe on slug, which is the catalog's own
  // identity and this row's React key.
  const seen = new Set();
  let cursor = null;
  for (let page = 0; page < CATALOG_MAX_PAGES; page++) {
    const params = { limit: CATALOG_PAGE_LIMIT };
    if (cursor !== null) params.cursor = cursor;
    const res = await fetchPage(params);
    const read = readCatalogPage(res && res.data);
    if (read === null) throw new Error('exercise catalog: unreadable page');
    for (const item of read.items) {
      if (seen.has(item.slug)) continue;
      seen.add(item.slug);
      items.push(item);
    }
    if (read.nextCursor === null) return { items, truncated: false };
    cursor = read.nextCursor;
  }
  return { items, truncated: true };
}

/** Join one catalog row to its words.
 *
 *  The result carries the OLD payload's field names on purpose. `ExerciseCard`,
 *  `ExerciseDetail`, `WorkoutBuilder`, `PreWorkout` and the `workout_builder`
 *  draft in localStorage all read `name` / `difficulty` / `muscles_primary` /
 *  `reps_default` and the rest; renaming them here would be a rewrite of four
 *  more screens inside a card that repoints one, and R1.1 says no. The shape is
 *  the contract between this file and the components, and it has not moved.
 *
 *  `id` is the SLUG. It keys React rows, dedupes the workout draft, and is what
 *  the deep link now carries.
 *
 *  THE LOAD-BEARING FIELD IS `name`. `WorkoutBuilder` puts this exact string in
 *  the draft, `ActiveWorkout` hands it to `slugForLegacyName` at save time, and
 *  that lookup is exact-match — it returns null rather than guessing, and a null
 *  parks the whole workout unsynced. So `name` is the content table's verbatim
 *  legacy name, and for a slug we stock no words for it is the derived label
 *  (which resolves to nothing, correctly, rather than to the wrong exercise).
 *
 *  `hasDefinition(slug)` supplies the AI badge. Injected, not imported, so this
 *  file has no engine dependency and a test can drive both answers. */
export function buildLibraryRow(item, hasDefinition) {
  const slug = item.slug;
  const c = contentForSlug(slug);
  const ai = typeof hasDefinition === 'function' ? hasDefinition(slug) === true : false;

  if (c === null) {
    // A catalog row this build stocks no words for — a new exercise published
    // ahead of the content table. Everything absent is absent, not blank-filled:
    // the detail panel already hides each section it has nothing for, and a
    // fabricated instruction list is worse than a short card.
    return {
      id: slug,
      slug,
      name: labelFromSlug(slug),
      description: null,
      primary_category: null,
      categories: [],
      difficulty: null,
      equipment: [],
      muscles_primary: [],
      muscles_secondary: [],
      calories_per_min: null,
      reps_default: null,
      sets_default: null,
      duration_seconds: null,
      instructions: [],
      common_mistakes: [],
      ai_supported: ai,
    };
  }

  return {
    id: slug,
    slug,
    name: c.name,
    description: c.description,
    primary_category: c.primaryCategory,
    categories: c.categories,
    difficulty: c.difficulty,
    equipment: c.equipment,
    muscles_primary: c.musclesPrimary,
    muscles_secondary: c.musclesSecondary,
    calories_per_min: c.caloriesPerMin,
    reps_default: c.repsDefault,
    sets_default: c.setsDefault,
    duration_seconds: c.durationSeconds,
    instructions: c.instructions,
    common_mistakes: c.commonMistakes,
    ai_supported: ai,
  };
}

/** All catalog rows, joined and ordered by name — the old list's default sort
 *  (`sort=name`, the only one the page ever sent). `localeCompare` is fine here
 *  and forbidden only inside the engine (R5.1); this is display ordering. */
export function buildLibraryRows(items, hasDefinition) {
  return items
    .map((item) => buildLibraryRow(item, hasDefinition))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Does this row match the search box? Name, category and muscles — the fields
 *  the old placeholder promises ("Search exercises, muscles..."). The old server
 *  searched a Mongo text index over name and description; description is
 *  included here so a search that used to hit does not suddenly miss. */
function matchesSearch(row, needle) {
  const hay = [
    row.name,
    row.primary_category,
    row.description,
    ...(row.categories || []),
    ...(row.muscles_primary || []),
    ...(row.muscles_secondary || []),
    ...(row.equipment || []),
  ];
  return hay.some((v) => typeof v === 'string' && v.toLowerCase().includes(needle));
}

/** The screen's three filters, applied in memory.
 *
 *  `category` matches EITHER the primary category or the row's `categories`
 *  list, which is what the old server did (its two `$or` arms) — Push-ups are
 *  primarily Strength Training and also tagged Upper Body, and tapping Upper
 *  Body must find them. */
export function filterLibrary(rows, { search = '', category = 'All', difficulty = 'All' } = {}) {
  const needle = String(search).trim().toLowerCase();
  return rows.filter((row) => {
    if (category !== 'All') {
      const inPrimary = row.primary_category === category;
      const inList = (row.categories || []).includes(category);
      if (!inPrimary && !inList) return false;
    }
    if (difficulty !== 'All' && row.difficulty !== difficulty) return false;
    if (needle !== '' && !matchesSearch(row, needle)) return false;
    return true;
  });
}
