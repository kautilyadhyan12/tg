// P2.2 — module schema surface (R7.2): contracts live in @app/shared; this
// file only re-exports what the exercises module consumes.
export {
  bundleQuerySchema,
  bundleResponseSchema,
  catalogListQuerySchema,
  catalogPageSchema,
  exerciseCatalogItemSchema,
  exerciseDefinitionSchema,
} from "@app/shared";
export type {
  BundleQuery,
  CatalogListQuery,
  CatalogPage,
  DefinitionBundle,
  ExerciseCatalogItem,
} from "@app/shared";
