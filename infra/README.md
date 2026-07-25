# infra — the deploy path for `api` + `worker`

Implements v1 §19 ("1× Hetzner VPS (CX32-class), Docker Compose: `caddy` (TLS) +
`api` + `worker`") and Part 8 §1's topology row, which names this directory.

| File | What it is |
|---|---|
| `Dockerfile` | One image, two modes (v1 §6). Default command = API; the worker service overrides it. |
| `Dockerfile.dockerignore` | Build-context excludes. BuildKit reads this in preference to a root `.dockerignore`. |
| `docker-compose.yml` | **Production**: `caddy` + `api` + `worker`. |
| `docker-compose.dev.yml` | **Dev**: `api` + `worker` + local `postgres` + `redis`. |
| `Caddyfile` | TLS terminator; also sets the `X-Forwarded-Proto` the secure-cookie contract depends on. |

## WHERE THE WORKER RUNS — the sentence the DPDP gate asks for

`RUNBOOK/cutover.md`'s Day-14 prerequisite requires this entry to **name where the
purge runs**. It is the **`worker` service in `infra/docker-compose.yml`**, on the
same Hetzner VPS as the API, from the same image, started by
`docker compose -f infra/docker-compose.yml up -d`.

`apps/api/src/worker.ts` registers a BullMQ job scheduler for `dpdp.purge` on the
`rollups` queue at `0 3 * * *` (03:00 UTC) with a deterministic jobId, so a
redeploy re-registers rather than stacking schedules.

**Do not scale `worker` above 1** without first reading the single-marker
concurrency line in `OWED.md`: the guarantee that one purge writes exactly one
audit marker currently rests on a single production call site, with no unique
index behind it.

> **This file existing does not discharge the gate.** The checkbox closes when the
> compose is actually running on a provisioned host — not when the YAML is
> committed. A sweep scheduled nowhere still deletes nothing.

## Environment

`config.ts` parses **20** variables once at boot and refuses to start on a bad one.
Only these are hard-required (no default, not optional):

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon in prod (v1 §19). |
| `WEB_ORIGIN` | Must EXACTLY match the browser origin — CORS is exact-origin with credentials (Part IV #6). |
| `JWT_SECRET` | 32+ chars enforced. |
| `REDIS_URL` | Required **in production only**, via config's `.refine()`. Upstash in prod. |

Everything else has a default or is optional; an unset `GROQ_API_KEY` cleanly
disables the coach rather than breaking boot, and the same pattern covers
`ORS_API_KEY` and the three `GOOGLE_*` values.

**Secrets never enter the repo or the image (R3.6).** Production values go in
`infra/api.env` **on the host** — gitignored, dockerignored, and listed in the
Part 8 §1 escrow doc with a rotation command. Two rotations are outstanding and
tracked in `OWED.md`: `GROQ_API_KEY` and `GOOGLE_CLIENT_SECRET`.

## Run it locally

```
docker compose -f infra/docker-compose.dev.yml up --build
```

Postgres is published on host port **5433** and Redis on **6380**, so the legacy
root `docker-compose.yml` (the old Mongo stack, still serving the old backend
until P2.8) can run at the same time without a clash.

Migrations and seeds run from a **host** checkout, not the container —
`drizzle-kit` is a devDependency and the image installs `--prod`:

```
DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg corepack pnpm --filter api exec drizzle-kit migrate
DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg corepack pnpm --filter api exec tsx src/db/seed.ts
```

That matches v1 §19's CI pipeline, where migrate is its own step before deploy,
and `RUNBOOK/cutover.md`, which already runs both this way.

## Why the model weights are baked into the image

The coach embeds the **user's question in-process on every request**
(`modules/coach/routes.ts` wires `createMiniLmEmbedder()` as the default;
`service.ts` calls `retrieve(sql, embedder, message)`), so all-MiniLM-L6-v2
(~90 MB) has to be inside the container.

It **cannot** be supplied by a mounted volume: transformers.js v4.2.0 reads no
`process.env` at all — `DEFAULT_CACHE_DIR = path.join(dirname__, '/.cache/')`
resolves inside the package's own `node_modules` directory, so `HF_HOME` and
`TRANSFORMERS_CACHE` do nothing. The Dockerfile therefore runs one warm embed at
build time and asserts the returned dimension is Part 4 §3.7's pinned 384.

Consequences worth knowing: the image is large, a redeploy costs no re-download,
and a container with no route to HuggingFace still answers coach questions.

## Deploying

Part 8 §2.1 is the procedure and this does not replace it: PR → CI gates → merge →
staging → smoke → one manual promote → 15 minutes watching Sentry and the 5xx
rate. Deploy window 11:00–15:00 IST, never Friday after 15:00 — gyms peak 06–09
and 17–21.

Rollback is `ops rollback api <previous-tag>`, safe by construction because
migrations are expand-then-contract (Part 4 §1). **The `ops` CLI is a P6 item and
does not exist yet**, so today rollback is `API_IMAGE=<previous-tag> docker compose
-f infra/docker-compose.yml up -d`.

Not built by this card, and each still open: a CI image-build/push job (there is no
registry and no VPS yet), auto-deploy on merge, and the backup/restore drill —
all three are prerequisites in `RUNBOOK/cutover.md`.
