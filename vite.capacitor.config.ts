import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Builds the web app for the Capacitor native shell (iOS/Android), separate from the plain `npm
// run build` output Vercel serves. The native webview's own origin is capacitor://localhost /
// https://localhost, not the real backend domain, so this build bakes in an absolute
// VITE_API_BASE_URL (see capacitor.config.ts) instead of the relative same-origin calls the web
// deploy relies on.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-mobile',
  },
})
