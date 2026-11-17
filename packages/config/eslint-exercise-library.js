// New code never uses the old exercise code (spec Part 2 §13.1, principle 2; job 60a). The old
// 58-exercise tables, the family-code helpers and the old catalog routes' shapes stay exactly as
// they are for the web's old pages, and for the files that use them today until the job that
// reaches each moves it to the Exercise Library (packages/shared/library). This block refuses
// them everywhere else it is applied, so it is GitHub that holds the rule, not a promise.

/** What `@app/shared` still exports from the old exercise code. */
export const OLD_EXERCISE_NAMES = [
  "CATALOG_58",
  "CatalogExercise",
  "EXERCISE_CONTENT",
  "ExerciseContent",
  "slugForLegacyName",
  "exerciseNameOf",
  "exerciseNameKey",
  "exerciseIsHeld",
  "exerciseCountWord",
  "exerciseCountsReps",
  "exerciseCatalogItemSchema",
  "ExerciseCatalogItem",
  "catalogPageSchema",
  "CatalogPage",
  "catalogListQuerySchema",
  "CatalogListQuery",
];

const message =
  "New code reads the Exercise Library (spec Part 2 §13), never the old exercise code; the old code is kept only for the web's old pages.";

export default {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [{ name: "@app/shared", importNames: OLD_EXERCISE_NAMES, message }],
        // The old files by their own paths: exerciseCatalog and exerciseContent anywhere, and the
        // old catalog.ts only as reached from inside packages/shared, so that a new file of the
        // Library's may itself be called catalog.
        patterns: [
          { regex: String.raw`(^|/)(exerciseCatalog|exerciseContent)(\.js)?$`, message },
          { regex: String.raw`^(\.\./)+(src/)?catalog(\.js)?$`, message },
        ],
      },
    ],
  },
};
