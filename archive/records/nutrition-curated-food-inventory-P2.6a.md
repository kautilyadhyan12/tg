# P2.6a curated food constants inventory

Source: `backend-ml/app/ai/nutrition/food_database.py`.

The binding machine-readable inventory is `apps/api/src/modules/nutrition/foods.ts`. It contains exactly 130 rows. Every row preserves the salvage `name`, `kcal`, `p`, `c`, `f`, `fib`, `serving`, and `unit` values and carries `sourceLine`, the original Python line number. The TypeScript field mapping is:

| Python | TypeScript | Units |
|---|---|---|
| `name` | `name` | label |
| `kcal` | `kcal` | kcal per 100 g |
| `p` | `proteinG` | g per 100 g |
| `c` | `carbsG` | g per 100 g |
| `f` | `fatG` | g per 100 g |
| `fib` | `fiberG` | g per 100 g |
| `serving` | `serving` | amount in `unit` |
| `unit` | `unit` | salvage unit |

No nutritional value was re-derived or replaced. `canonical` is the sole derived field: a deterministic lowercase identifier generated from `name` for matching.
