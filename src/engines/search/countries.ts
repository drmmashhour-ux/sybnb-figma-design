export type CountryKey = 'SY' | 'CA'

export type Country = {
  key: CountryKey
  ar: string
  en: string
  fr: string
}

// Syria first (the platform's original market) so existing behavior/defaults never change unless a
// host/guest explicitly picks Canada.
export const COUNTRIES: Country[] = [
  { key: 'SY', ar: 'سوريا', en: 'Syria', fr: 'Syrie' },
  { key: 'CA', ar: 'كندا', en: 'Canada', fr: 'Canada' },
]

export function getCountry(key: string) {
  return COUNTRIES.find((country) => country.key === key)
}
