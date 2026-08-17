import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `public/mediapipe/` is VENDOR WebAssembly glue fetched by
  // `tools/fetch-pose-assets.mjs`, not source. Without this, `eslint .` lints
  // two minified emscripten loaders and reports **578 errors**, and
  // `pnpm --filter web lint` fails for anyone who has run `dev` or `build`.
  //
  // It is ignored ALONGSIDE `dist` for the same reason — neither is ours to
  // fix — and the coupling is worth knowing: lint passes in CI today only
  // because CI never runs the fetch script, so the assets are not there. The
  // day that gap closes (OWED 🔴, the unrecorded Vercel build command), lint
  // would have started failing instead. Found 2026-08-17 by running `eslint .`
  // rather than the changed files, which is how the packet had been checked.
  globalIgnores(['dist', 'public/mediapipe']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
