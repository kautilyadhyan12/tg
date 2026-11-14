import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { contentSecurityPolicyPlugin } from './src/contentSecurityPolicy.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // The addresses the build talks to (`.env` and the shell's VITE_ ones), for the page's policy.
  plugins: [react(), contentSecurityPolicyPlugin(loadEnv(mode, process.cwd(), 'VITE_'))],
  // Two pages: the console and the member web (`index.html`, every address but one), and the front page
  // (`home.html`, ROADMAP Stage 4 item 12a), which the server shows at the site's own address alone
  // (`infra/Caddyfile.selfhost`). In development it is at /home.html.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        home: fileURLToPath(new URL('./home.html', import.meta.url)),
      },
    },
  },
}))
