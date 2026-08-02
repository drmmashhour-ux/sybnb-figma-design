import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.sybnb.platform',
  appName: 'SYBNB',
  webDir: 'dist',
  server: {
    // Points the native shell at the deployed API/site during development. Swap to a
    // fully offline bundle (drop this whole `server` block) once the app talks to
    // production exclusively through server/lib/prisma-backed API calls, not page loads.
    androidScheme: 'https',
  },
}

export default config
