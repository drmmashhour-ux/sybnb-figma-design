export type Lang = 'ar' | 'en' | 'fr'

// Every existing `Record<Lang, T>` copy record in the app (there are hundreds, across host/admin/
// seller surfaces well outside the French rollout's current scope) would otherwise be a compile
// error the instant Lang gained a third member -- ar/en stay required, fr is opt-in per record so
// pages can add real French on their own schedule instead of all at once.
export type Localized<T> = Record<'ar' | 'en', T> & Partial<Record<'fr', T>>

const STORAGE_KEY = 'sybnb_v6_language'

export function getInitialLanguage(): Lang {
  if (typeof window === 'undefined') return 'ar'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'en' || stored === 'ar' || stored === 'fr' ? stored : 'ar'
}

export function persistLanguage(lang: Lang) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }
}

// Falls back to English when a record hasn't been translated to French yet, rather than being
// silently wrong -- English is closer to French than Arabic for a reader who doesn't know Arabic.
export function text(pair: Localized<string>, lang: Lang) {
  return lang === 'ar' ? pair.ar : lang === 'fr' ? pair.fr || pair.en : pair.en
}
