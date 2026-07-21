import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import type { CountryKey } from '../../engines/search'
import { LocationCascade, type LocationValue } from '../../modules/search/LocationCascade'
import type { SearchCapsuleState } from './index'

// Search Capsule (capsules/SYBNB_REUSABLE_CAPSULES.md): "main group, governorate, city, area,
// optional date, search button." This component only ever calls onSearch() when the button is
// pressed -- it renders no results itself, so a caller that waits for onSearch before fetching/
// showing anything automatically satisfies the Hard Rule ("results and details appear only after
// the client presses Search").
export type SearchCapsuleMainGroupOption = { key: string; ar: string; en: string }

export type SearchCapsuleProps = {
  lang: Lang
  division: SearchCapsuleState['division']
  // The "main group" is division-specific (property type for STR, vehicle body for CARS, category
  // for MARKETPLACE, ...) -- the capsule has no opinion on what the options are, only that one can
  // be picked before searching.
  mainGroupOptions?: SearchCapsuleMainGroupOption[]
  // STR/SR-style capsules want a date; RENTALS/BUY/MARKETPLACE typically don't.
  showDate?: boolean
  allowCanada?: boolean
  initialValue?: Partial<LocationValue & { mainGroup: string; date: string }>
  onSearch: (state: Omit<SearchCapsuleState, 'requiresSearchBeforeResults'> & { country: CountryKey; date: string }) => void
}

const copy = {
  ar: { mainGroup: 'الفئة الرئيسية', date: 'التاريخ (اختياري)', search: 'بحث', chooseMainGroup: 'اختر الفئة' },
  en: { mainGroup: 'Main group', date: 'Date (optional)', search: 'Search', chooseMainGroup: 'Choose a category' },
}

export function SearchCapsule({ lang, division, mainGroupOptions, showDate = false, allowCanada = false, initialValue, onSearch }: SearchCapsuleProps) {
  const isAr = lang === 'ar'
  const t = copy[isAr ? 'ar' : 'en']
  const [location, setLocation] = useState<LocationValue>({
    country: initialValue?.country || 'SY',
    governorate: initialValue?.governorate || '',
    city: initialValue?.city || '',
    area: initialValue?.area || '',
  })
  const [mainGroup, setMainGroup] = useState(initialValue?.mainGroup || mainGroupOptions?.[0]?.key || '')
  const [date, setDate] = useState(initialValue?.date || '')

  function search() {
    onSearch({
      division,
      selectedMainGroup: mainGroup,
      selectedGovernorate: location.governorate,
      selectedCity: location.city,
      selectedArea: location.area,
      country: location.country,
      date,
    })
  }

  return (
    <section dir={isAr ? 'rtl' : 'ltr'} style={styles.shell}>
      {mainGroupOptions && mainGroupOptions.length > 0 && (
        <label style={styles.label}>
          <span>{t.mainGroup}</span>
          <select style={styles.select} value={mainGroup} onChange={(event) => setMainGroup(event.target.value)}>
            <option value="">{t.chooseMainGroup}</option>
            {mainGroupOptions.map((item) => (
              <option key={item.key} value={item.key}>{isAr ? item.ar : item.en}</option>
            ))}
          </select>
        </label>
      )}

      <LocationCascade lang={lang} value={location} onChange={setLocation} allowCanada={allowCanada} />

      {showDate && (
        <label style={styles.label}>
          <span>{t.date}</span>
          <input style={styles.dateInput} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      )}

      <button type="button" style={styles.searchButton} onClick={search}>
        {t.search}
      </button>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  shell: { display: 'grid', gap: 12 },
  label: { color: '#9ca3af', display: 'grid', fontSize: 12, fontWeight: 900, gap: 6 },
  select: { background: '#0f172a', border: '1px solid #30405f', borderRadius: 12, color: '#f8fafc', fontWeight: 800, minHeight: 48, padding: '0 12px' },
  dateInput: { background: '#0f172a', border: '1px solid #30405f', borderRadius: 12, color: '#f8fafc', fontWeight: 800, minHeight: 48, padding: '0 12px' },
  searchButton: { background: '#19d7ff', border: 0, borderRadius: 12, color: '#051014', fontWeight: 950, minHeight: 52, fontSize: 15 },
}
