export type Lang = 'ar' | 'en'

const STORAGE_KEY = 'sybnb_v6_language'

export function getInitialLanguage(): Lang {
  if (typeof window === 'undefined') return 'ar'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'en' || stored === 'ar' ? stored : 'ar'
}

export function persistLanguage(lang: Lang) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }
}

export function text(pair: { ar: string; en: string }, lang: Lang) {
  return lang === 'ar' ? pair.ar : pair.en
}
