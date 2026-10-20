import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { contentSecurityPolicyPlugin } from './src/contentSecurityPolicy.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // The addresses the build talks to (`.env` and the shell's VITE_ ones), for the page's policy.
  plugins: [react(), contentSecurityPolicyPlugin(loadEnv(mode, process.cwd(), 'VITE_'))],
}))
