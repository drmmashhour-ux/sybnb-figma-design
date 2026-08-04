// SYBNB service worker — makes the app installable (PWA) and keeps the last office-dashboard snapshot
// available OFFLINE on the tablet. Deliberately conservative so it can never serve stale application
// code to the whole origin:
//   • Navigations (HTML)  → NETWORK-FIRST, cached shell only as an offline fallback. A new deploy always
//     wins online, which also keeps main.tsx's stale-chunk recovery correct.
//   • Hashed static assets (/assets, /fonts, /icons) → CACHE-FIRST. Their URLs are content-hashed and
//     immutable, so a fresh index.html simply requests new hashes the cache doesn't have yet.
//   • /api/admin/office-dashboard → NETWORK-FIRST with cache fallback, so offline shows the last snapshot.
//   • Every OTHER /api/ call and every CROSS-ORIGIN request → untouched (no respondWith), so live data,
//     auth, map tiles and the Blob CDN behave exactly as without a service worker.
// Bump VERSION to invalidate old caches on the next activation.

const VERSION = 'sybnb-sw-v1'
const STATIC_CACHE = `${VERSION}-static`
const DATA_CACHE = `${VERSION}-data`
const OFFLINE_DASHBOARD = '/api/admin/office-dashboard'

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.add('/')))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(request, cacheName, fallbackPath) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response && response.ok) cache.put(request, response.clone())
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) return cached
    if (fallbackPath) {
      const shell = await cache.match(fallbackPath)
      if (shell) return shell
    }
    throw error
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok) cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  // Never intervene on cross-origin (OSM tiles, Vercel Blob CDN, etc.) — let the browser handle them.
  if (url.origin !== self.location.origin) return

  // The office dashboard data: last-good snapshot survives offline.
  if (url.pathname === OFFLINE_DASHBOARD) {
    event.respondWith(networkFirst(request, DATA_CACHE))
    return
  }

  // All other API traffic: leave entirely to the network (never cache dynamic/auth data).
  if (url.pathname.startsWith('/api/')) return

  // SPA navigations: network-first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE, '/'))
    return
  }

  // Immutable, content-hashed static assets: cache-first for speed + offline.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }
})
