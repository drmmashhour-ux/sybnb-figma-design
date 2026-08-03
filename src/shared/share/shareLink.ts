export type ShareResult = 'shared' | 'copied' | 'unavailable'

// Cross-platform "share this link" capsule. Opens the native Web Share sheet when available (on mobile
// that's WhatsApp / Messages / etc.), otherwise copies the URL to the clipboard. Returns what happened
// so the caller can show the right feedback ('shared' → the OS sheet handled it, no toast needed).
// Used by the STR stays detail and the Synitres property detail so both share links the same way.
export async function shareLink(input: { url: string; title?: string; text?: string }): Promise<ShareResult> {
  if (typeof window === 'undefined') return 'unavailable'
  const nav = navigator as Navigator & { share?: (data: { url?: string; title?: string; text?: string }) => Promise<void> }
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ url: input.url, title: input.title, text: input.text })
    } catch {
      // The user dismissed the sheet, or the share failed — either way the native path was offered, so
      // don't silently fall back to a clipboard copy behind their back.
    }
    return 'shared'
  }
  try {
    await navigator.clipboard?.writeText(input.url)
    return 'copied'
  } catch {
    return 'unavailable'
  }
}
