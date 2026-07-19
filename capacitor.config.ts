import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.sybnb.str',
  appName: 'SYBNB',
  // Built by `npm run build:mobile` (vite.capacitor.config.ts), NOT the plain `dist` from `npm run
  // build` -- the mobile build bakes in VITE_API_BASE_URL=https://sybnb.app since the native webview's
  // own origin is capacitor://localhost (iOS) / https://localhost (Android), so relative /api/... calls
  // (which work fine for the same-origin Vercel web deploy) would otherwise resolve against the webview
  // itself instead of the real backend.
  webDir: 'dist-mobile',
  server: {
    // Matches the Android origin server/lib/allowed-origins.mjs already allows (CAPACITOR_APP_ORIGINS).
    androidScheme: 'https',
  },
};

export default config;
