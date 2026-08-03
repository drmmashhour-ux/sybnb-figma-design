// Client-side "recently viewed listings" capsule, shared across platforms (STR stays + Synitres
// property/buy/rentals). A lightweight snapshot is stored per view in localStorage, so a returning
// visitor can jump straight back to what they looked at — no server, no account, no migration. The
// snapshot carries everything a card needs, so the strip renders instantly without re-fetching.

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
const MAX = 12

function readAll(): ViewedListing[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as ViewedListing[]).filter((v) => v && typeof v.id === 'string') : []
  } catch {
    return []
  }
}

// Record (or refresh) a viewed listing: most-recent-first, de-duplicated by id, capped at MAX.
export function recordViewed(view: Omit<ViewedListing, 'at'>) {
  if (typeof window === 'undefined' || !view?.id) return
  try {
    const next = [{ ...view, at: Date.now() }, ...readAll().filter((v) => v.id !== view.id)].slice(0, MAX)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* storage full / disabled — non-fatal, the feature just doesn't persist */
  }
}

// Read recently-viewed listings, newest first, optionally limited to certain divisions (e.g. a Synitres
// surface asks for BUY + RENTALS only), and optionally excluding one id (the listing being viewed now).
export function getRecentlyViewed(options?: { divisions?: string[]; excludeId?: string; limit?: number }): ViewedListing[] {
  const { divisions, excludeId, limit } = options || {}
  let rows = readAll().sort((a, b) => b.at - a.at)
  if (divisions && divisions.length) rows = rows.filter((v) => divisions.includes(v.division))
  if (excludeId) rows = rows.filter((v) => v.id !== excludeId)
  return typeof limit === 'number' ? rows.slice(0, limit) : rows
}
