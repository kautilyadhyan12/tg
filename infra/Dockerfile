# syntax=docker/dockerfile:1.7
#
# ONE IMAGE, TWO MODES (v1 §6): `api` (HTTP) and `worker` (BullMQ queues) are the
# same image with a different command. apps/api/src/worker.ts is the second
# entrypoint; infra/docker-compose.yml runs both from this one build.
#
# WHY tsx AND NOT A COMPILED dist/ (the deploy card's one real fork, Kd-approved):
# no package this image needs has a build script — apps/api has none, and
# @app/shared / @app/engine both export raw `"main": "./src/index.ts"`. The whole
# repo (dev, tests, every PROVE run) executes TypeScript through tsx. Compiling
# would mean adding build scripts to three packages and repointing their exports,
# which changes module resolution for typecheck/test everywhere — past the
# one-thing-per-chat ceiling (Part I §7b). So the container runs exactly what the
# test suite runs. A real compile step is an owed optimisation, not a prerequisite.
#
# BASE IS glibc (bookworm), NOT alpine/musl, DELIBERATELY: @node-rs/argon2 (every
# login) ships platform-specific native binaries. pnpm-lock.yaml carries both
# linux-x64-gnu and linux-x64-musl variants, so either would resolve; glibc is the
# conservative default.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — manifests only, so a source edit does not invalidate the install layer.
# EVERY workspace manifest is copied even though only `api` is installed:
# pnpm-workspace.yaml globs apps/* and packages/*, and --frozen-lockfile compares
# the lockfile against the manifests it finds. A missing one reads as drift.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/

# --prod: runtime dependencies only. tsx is a RUNTIME dep of apps/api for exactly
# this reason (this card moved it out of devDependencies). drizzle-kit and vitest
# are deliberately absent — migrations run from CI or a host checkout per v1 §19's
# pipeline and RUNBOOK/cutover.md's own commands, never from the app container.
# `api...` selects api plus its workspace dependencies (@app/shared, @app/engine).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter api...

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production

# Ownership is applied AS THE LAYERS ARE WRITTEN. A separate `RUN chown -R` pass
# cost 170s in the first build of this image, because it rewrites every file in a
# ~3 GB tree into a new layer.
COPY --from=deps --chown=node:node /app /app
COPY --chown=node:node packages/ ./packages/
COPY --chown=node:node apps/api/ ./apps/api/

WORKDIR /app/apps/api

USER node

EXPOSE 3000

# start-period is generous: tsx transpiles the module graph at boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default mode = api. The worker service overrides this with src/worker.ts.
# node is invoked directly (not via pnpm) so SIGTERM reaches the process that
# handles it — worker.ts installs SIGINT/SIGTERM handlers that close the queue
# without tearing down a purge transaction mid-cascade.
CMD ["node", "--import", "tsx", "src/index.ts"]
