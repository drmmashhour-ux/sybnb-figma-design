// Client-side "recently viewed listings" capsule, shared across platforms (STR stays + Synitres
// property/buy/rentals). A lightweight snapshot is stored per view in localStorage, so a returning
// visitor can jump straight back to what they looked at — no server, no account, no migration. The
// snapshot carries everything a card needs, so the strip renders instantly without re-fetching.
//
// RETENTION POLICY (device-local, privacy-light by design):
//   • Scope: this browser only. No server, no account id, no cross-device sync, no analytics/tracking.
//     It makes NO cross-user assumptions — two people on the same device share one history, and clearing
//     browser storage (or calling clearRecentlyViewed) wipes it.
//   • Size: at most MAX_ITEMS (15) most-recently-viewed listings are kept; older ones fall off.
//   • Freshness: snapshots are point-in-time copies (title/price/image as seen), so they can be slightly
//     stale; a deleted listing's card simply lands on a "not found" detail page, and a broken image
//     falls back to a placeholder in the strip.
//   • Safety: the payload is versioned (SCHEMA_VERSION). On ANY version mismatch, malformed JSON, or
//     tampered/unsafe values the whole store is treated as empty (fail safe) rather than mis-parsed, and
//     every individual record is validated + coerced on read. Bumping SCHEMA_VERSION cleanly retires old
//     data without a migration step.

export type ViewedListing = {
  id: string
  division: string
  title: string
  priceMinor: number
  currency: string
  image: string
  at: number // epoch ms of the view, for most-recent-first ordering
}

const STORAGE_KEY = 'sybnb.v6.recentlyViewed'
const SCHEMA_VERSION = 1
const MAX_ITEMS = 15
// The listing divisions this store will accept — anything else is treated as untrusted and dropped.
const KNOWN_DIVISIONS = new Set(['STAYS', 'RENTALS', 'BUY', 'CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION'])
// Listing ids are uuids/cuids: a conservative id shape that can be safely interpolated into a hash route.
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

type StoredPayload = { v: number; items: ViewedListing[] }

// Safe localStorage handle. Accessing `window.localStorage` can itself throw (storage disabled/blocked,
// partitioned contexts), so every access goes through here and degrades to a no-op when unavailable.
function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

// Only allow image URLs we know are safe to drop straight into an <img src>. Anything odd (javascript:,
// arbitrary schemes, non-strings) becomes '' so the strip renders its placeholder instead.
function isSafeImage(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    (url.startsWith('/') || url.startsWith('https://') || url.startsWith('http://') || url.startsWith('blob:') || url.startsWith('data:image/'))
  )
}

// Validate + coerce one raw record into a trusted ViewedListing, or null if it can't be trusted.
function sanitize(raw: unknown): ViewedListing | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !ID_PATTERN.test(r.id)) return null
  if (typeof r.division !== 'string' || !KNOWN_DIVISIONS.has(r.division)) return null
  if (typeof r.priceMinor !== 'number' || !Number.isFinite(r.priceMinor) || r.priceMinor < 0) return null
  const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0
  const title = typeof r.title === 'string' ? r.title.slice(0, 200) : ''
  const currency = typeof r.currency === 'string' && r.currency.trim() ? r.currency.trim().slice(0, 8) : 'USD'
  const image = isSafeImage(r.image) ? r.image : ''
  return { id: r.id, division: r.division, title, priceMinor: Math.floor(r.priceMinor), currency, image, at }
}

function readAll(): ViewedListing[] {
  const store = storage()
  if (!store) return []
  let raw: string | null
  try {
    raw = store.getItem(STORAGE_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  // Fail safe: only the current versioned shape is trusted. An old bare array, a future version, or a
  // tampered blob is treated as empty rather than mis-read.
  if (!parsed || typeof parsed !== 'object') return []
  const payload = parsed as Partial<StoredPayload>
  if (payload.v !== SCHEMA_VERSION || !Array.isArray(payload.items)) return []
  const clean: ViewedListing[] = []
  const seen = new Set<string>()
  for (const item of payload.items) {
    const safe = sanitize(item)
    if (safe && !seen.has(safe.id)) {
      seen.add(safe.id)
      clean.push(safe)
    }
  }
  return clean.slice(0, MAX_ITEMS)
}

function writeAll(items: ViewedListing[]) {
  const store = storage()
  if (!store) return
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, items: items.slice(0, MAX_ITEMS) } satisfies StoredPayload))
  } catch {
    /* quota exceeded / storage blocked — non-fatal, the feature just doesn't persist this write */
  }
}

// Record (or refresh) a viewed listing: most-recent-first, de-duplicated by id, capped at MAX_ITEMS.
// Invalid input is dropped rather than stored, so callers can pass raw listing fields safely.
export function recordViewed(view: Omit<ViewedListing, 'at'>) {
  const candidate = sanitize({ ...view, at: Date.now() })
  if (!candidate) return
  const next = [candidate, ...readAll().filter((v) => v.id !== candidate.id)].slice(0, MAX_ITEMS)
  writeAll(next)
}

// Read recently-viewed listings, newest first, optionally limited to certain divisions (e.g. a Synitres
// surface passes ['BUY','RENTALS'] to keep STR history out) and/or excluding one id (the current listing).
export function getRecentlyViewed(options?: { divisions?: string[]; excludeId?: string; limit?: number }): ViewedListing[] {
  const { divisions, excludeId, limit } = options || {}
  // The store is maintained newest-first by recordViewed; a defensive stable sort by `at` descending keeps
  // ordering deterministic even if the array were ever out of order, with insertion order breaking ties.
  let rows = readAll()
    .slice()
    .sort((a, b) => b.at - a.at)
  if (divisions && divisions.length) {
    const set = new Set(divisions)
    rows = rows.filter((v) => set.has(v.division))
  }
  if (excludeId) rows = rows.filter((v) => v.id !== excludeId)
  return typeof limit === 'number' && limit >= 0 ? rows.slice(0, limit) : rows
}

// Wipe the history (for a future "clear recently viewed" control, and for privacy hygiene).
export function clearRecentlyViewed() {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(STORAGE_KEY)
  } catch {
    /* non-fatal */
  }
}

// Route a viewed listing back to its detail page: real-estate → /property/:id, everything else (stays,
// cars, marketplace) → the shared /listing/:id detail. Exported so the strip and any future surface agree.
export function detailHrefFor(division: string, id: string): string {
  return division === 'BUY' || division === 'RENTALS' ? `#/property/${id}` : `#/listing/${id}`
}
