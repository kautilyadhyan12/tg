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
# BASE IS glibc (bookworm), NOT alpine/musl, DELIBERATELY: three runtime deps ship
# platform-specific native binaries — @node-rs/argon2 (every login), plus
# onnxruntime-node and sharp via @huggingface/transformers (every coach question).
# pnpm-lock.yaml carries both linux-x64-gnu and linux-x64-musl variants of argon2,
# so either would resolve; glibc is the conservative default and the local PROVE
# exercises a real login and a real coach answer through the container rather than
# assuming the natives loaded.

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

# NO GPU EXECUTION PROVIDERS. onnxruntime-node's postinstall otherwise downloads
# the CUDA nupkg and extracts libonnxruntime_providers_cuda.so (316 MB) plus a
# TensorRT provider — measured in the first build of this image, which came out at
# 3.14 GB. The target is a CPU-only Hetzner CX32 (v1 §19); those providers can
# never load there. `skip` omits only the files NOT bundled in the npm package —
# the CPU libonnxruntime.so.1 ships inside the tarball, so inference is unaffected,
# and the build's own warm embed is what proves that rather than this comment.
# (Flag verified against the installed script/install.js: ONNXRUNTIME_NODE_INSTALL
# is current; ONNXRUNTIME_NODE_INSTALL_CUDA is deprecated.)
ENV ONNXRUNTIME_NODE_INSTALL=skip

# --prod: runtime dependencies only. tsx is a RUNTIME dep of apps/api for exactly
# this reason (this card moved it out of devDependencies). drizzle-kit and vitest
# are deliberately absent — migrations run from CI or a host checkout per v1 §19's
# pipeline and RUNBOOK/cutover.md's own commands, never from the app container.
# `api...` selects api plus its workspace dependencies (@app/shared, @app/engine).
#
# --no-side-effects-cache IS LOAD-BEARING, not tidiness. pnpm caches a package's
# POSTINSTALL OUTPUT in the store, so with a warm store mount the onnxruntime
# postinstall does not re-run and the ENV above is never consulted — measured: the
# second build of this image logged no onnxruntime postinstall at all and still
# shipped the 316 MB CUDA provider. The flag makes the skip actually govern.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --no-side-effects-cache --filter api...

# The build FAILS rather than silently shipping GPU providers. A cache behaviour
# is not a guarantee, and this exact skip was already defeated once by one — so the
# property is asserted rather than trusted. If this ever fires, onnxruntime changed
# its install contract; re-read script/install.js before changing the flag.
RUN set -eu; \
    cuda="$(find /app/node_modules -name 'libonnxruntime_providers_cuda.so' -print -quit)"; \
    if [ -n "$cuda" ]; then \
      echo "FAIL: GPU execution provider present at $cuda — the CPU-only target (v1 §19) must not ship it"; \
      exit 1; \
    fi; \
    test -f "$(find /app/node_modules -path '*napi-v6/linux/x64/libonnxruntime.so.1' -print -quit)" \
      || { echo 'FAIL: CPU onnxruntime.so.1 not found under napi-v6/linux/x64 — either the skip removed too much OR the napi ABI dir changed (check bin/ layout before touching the flag)'; exit 1; }; \
    echo 'onnxruntime: CPU runtime present, no GPU providers'

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

# Drop privileges BEFORE the warm, so the model cache is written by the same uid
# that will read it at runtime. Warming as root and then switching users is how a
# container passes its build and fails its first request.
USER node

# WEIGHTS ARE BAKED IN, NOT DOWNLOADED AT RUNTIME — and this is load-bearing.
# The coach embeds the USER'S QUESTION in-process on every request
# (modules/coach/routes.ts wires createMiniLmEmbedder() as the default; service.ts
# calls retrieve(sql, embedder, message)), so all-MiniLM-L6-v2 (~90 MB) must be
# present in the container. It CANNOT be placed by a mounted volume: transformers.js
# v4.2.0 reads no process.env — its cacheDir defaults to a `.cache/` directory
# INSIDE its own node_modules folder (src/env.js: DEFAULT_CACHE_DIR =
# path.join(dirname__, '/.cache/')), so HF_HOME/TRANSFORMERS_CACHE do nothing.
# Warming here writes into that path as an image layer. Consequence: a fresh
# container answers coach questions with zero network to HuggingFace, and a
# redeploy costs no re-download. The dim assertion makes this a real check, not a
# hopeful curl — a silently-failed warm would leave the download to first request.
RUN node --input-type=module -e "\
import { pipeline } from '@huggingface/transformers'; \
const extract = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'); \
const out = await extract(['warm the model cache'], { pooling: 'mean', normalize: true }); \
const dim = out.tolist()[0].length; \
if (dim !== 384) { throw new Error('expected the Part 4 §3.7 pinned dim 384, got ' + dim); } \
console.log('model cache warmed, dim', dim);"

EXPOSE 3000

# start-period is generous: tsx transpiles the module graph at boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default mode = api. The worker service overrides this with src/worker.ts.
# node is invoked directly (not via pnpm) so SIGTERM reaches the process that
# handles it — worker.ts installs SIGINT/SIGTERM handlers that close the queue
# without tearing down a purge transaction mid-cascade.
CMD ["node", "--import", "tsx", "src/index.ts"]
