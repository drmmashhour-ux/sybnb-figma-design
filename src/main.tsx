import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './shared/theme/global.css'

// Stale-deploy recovery: when a tab has been open across a deploy, its old index.html points at
// lazy chunk hashes the server has since removed, so navigating to a lazy route throws
// "Failed to fetch dynamically imported module" and the page goes blank. Vite fires `vite:preloadError`
// in that case — reload once to pull the fresh build instead of showing a blank screen. The
// sessionStorage guard prevents a reload loop if the failure is not actually a stale chunk.
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem('sybnb-preload-reloaded')) return
  sessionStorage.setItem('sybnb-preload-reloaded', '1')
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
