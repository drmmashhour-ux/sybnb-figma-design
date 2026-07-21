import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cspConnectSrcPlugin } from './vite-csp-plugin.mjs'

export default defineConfig({
  plugins: [react(), cspConnectSrcPlugin()],
})
