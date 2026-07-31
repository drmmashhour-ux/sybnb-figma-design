import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './shared/theme/global.css'

// Stale-deploy recovery: when a tab has been open across a deploy, its old index.html points at
// lazy chunk hashes the server has since removed, so navigating to a lazy route throws
// "Failed to fetch dynamically imported module" and the page goes blank. Reload to pull the fresh
// build instead of showing a blank screen. The guard is TIME-based (not once-per-session): a tab open
// across several deploys must be able to recover each time, while a reload that immediately hits the
// same error again (not actually a stale chunk) must not loop — so we only reload if the last recovery
// reload was more than 12s ago.
function recoverFromStaleChunk() {
  const key = 'sybnb-preload-reloaded-at'
  const last = Number(sessionStorage.getItem(key) || 0)
  if (Date.now() - last < 12000) return // just reloaded — the error persists, so don't loop
  sessionStorage.setItem(key, String(Date.now()))
  window.location.reload()
}
window.addEventListener('vite:preloadError', recoverFromStaleChunk)
// Backstop: React.lazy import failures surface as an unhandled rejection, not always vite:preloadError.
window.addEventListener('unhandledrejection', (event) => {
  const msg = String(event?.reason?.message || event?.reason || '')
  if (/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(msg)) recoverFromStaleChunk()
})

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
