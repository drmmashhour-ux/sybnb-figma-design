import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchApprovedListings, type PlatformListing } from '../../shared/api/platformApi'
import { DivisionTriad } from '../../shared/layout/DivisionTriad'
import { listingTitleText, moneyText } from '../../shared/i18n/display'
import { MARKETPLACE_CATEGORIES, MARKETPLACE_CONDITIONS, categoryLabel, conditionLabel } from '../../shared/marketplace/categories'

// Facebook-style marketplace browse: category chips, search + filters (category/price/condition/city),
// and a result grid. Boosts/favorites/offers are Phase 2 (not built).
const copy = {
  ar: {
    title: 'السوق',
    subtitle: 'اشترِ وبع السلع محليًا.',
    sell: '+ بيع شيء ما',
    search: 'ابحث في السوق...',
    all: 'الكل',
    city: 'المدينة',
    minPrice: 'أقل سعر',
    maxPrice: 'أعلى سعر',
    condition: 'الحالة',
    anyCondition: 'أي حالة',
    feed: 'أحدث المعروضات',
    loading: 'جار التحميل...',
    empty: 'لا توجد نتائج مطابقة.',
    error: 'تعذر تحميل المعروضات.',
  },
  en: {
    title: 'Marketplace',
    subtitle: 'Buy and sell goods locally.',
    sell: '+ Sell something',
    search: 'Search marketplace…',
    all: 'All',
    city: 'City',
    minPrice: 'Min price',
    maxPrice: 'Max price',
    condition: 'Condition',
    anyCondition: 'Any condition',
    feed: 'Newest listings',
    loading: 'Loading…',
    empty: 'No matching results.',
    error: 'Could not load listings.',
  },
}

export function MarketplaceBrowsePage({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const t = isAr ? copy.ar : copy.en
  const [category, setCategory] = useState('')
  const [condition, setCondition] = useState('')
  const [city, setCity] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [query, setQuery] = useState('')
  const [listings, setListings] = useState<PlatformListing[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    setState('loading')
    fetchApprovedListings('MARKETPLACE', {
      category: category || undefined,
      condition: condition || undefined,
      city: city.trim() || undefined,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
    })
      .then((rows) => { if (alive) { setListings(rows); setState('ready') } })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [category, condition, city, minPrice, maxPrice])

  // Text search is applied client-side over the fetched result set (title match).
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return listings
    return listings.filter((l) => `${l.titleAr} ${l.titleEn || ''}`.toLowerCase().includes(q))
  }, [listings, query])

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <DivisionTriad
        lang={lang}
        offerLabel={{ ar: 'بيع شيء ما', en: 'Sell something', fr: 'Vendre un article' }}
        offerHref="/marketplace/sell"
      />
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>{t.title}</h1>
          <p style={styles.subtitle}>{t.subtitle}</p>
        </div>
        <button style={styles.sellButton} onClick={() => (window.location.hash = '/marketplace/sell')}>{t.sell}</button>
      </div>

      <input style={styles.search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} />

      <div style={styles.chips}>
        <button style={category === '' ? styles.chipActive : styles.chip} onClick={() => setCategory('')}>{t.all}</button>
        {MARKETPLACE_CATEGORIES.map((c) => (
          <button key={c.id} style={category === c.id ? styles.chipActive : styles.chip} onClick={() => setCategory(c.id)}>
            {c.icon} {isAr ? c.ar : c.en}
          </button>
        ))}
      </div>

      <div style={styles.filters}>
        <input style={styles.filterInput} value={city} onChange={(e) => setCity(e.target.value)} placeholder={t.city} />
        <input style={styles.filterInput} type="number" inputMode="numeric" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder={t.minPrice} />
        <input style={styles.filterInput} type="number" inputMode="numeric" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder={t.maxPrice} />
        <select style={styles.filterInput} value={condition} onChange={(e) => setCondition(e.target.value)}>
          <option value="">{t.anyCondition}</option>
          {MARKETPLACE_CONDITIONS.map((c) => <option key={c.id} value={c.id}>{isAr ? c.ar : c.en}</option>)}
        </select>
      </div>

      <h2 style={styles.feedTitle}>{t.feed}</h2>
      {state === 'loading' && <p style={styles.muted}>{t.loading}</p>}
      {state === 'error' && <p style={styles.error}>{t.error}</p>}
      {state === 'ready' && results.length === 0 && <p style={styles.muted}>{t.empty}</p>}
      {state === 'ready' && results.length > 0 && (
        <div style={styles.grid}>
          {results.map((l) => {
            const photo = (l.media && l.media[0] && (l.media[0].url as string)) || ''
            return (
              <article key={l.id} style={styles.item} onClick={() => (window.location.hash = `/listing/${l.id}`)} role="button">
                <div style={{ ...styles.thumb, ...(photo ? { backgroundImage: `url(${photo})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}) }}>
                  {!photo && <span style={styles.thumbEmoji}>📦</span>}
                </div>
                <strong style={styles.price}>{moneyText(l.priceMinor, l.currency, lang)}</strong>
                <span style={styles.itemTitle}>{listingTitleText(l, lang)}</span>
                <span style={styles.itemMeta}>
                  {[categoryLabel(l.metadata?.category as string, lang), conditionLabel(l.metadata?.condition as string, lang), String(l.metadata?.city || '')].filter(Boolean).join(' · ')}
                </span>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 960, margin: '0 auto', padding: '20px 16px 64px', display: 'flex', flexDirection: 'column', gap: 12 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  title: { fontSize: 24, margin: 0 },
  subtitle: { margin: 0, color: '#555', fontSize: 14 },
  sellButton: { padding: '10px 18px', borderRadius: 12, border: 'none', background: '#2f6fed', color: '#fff', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  search: { padding: '12px 14px', borderRadius: 12, border: '1px solid #ccd', fontSize: 15 },
  chips: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 },
  chip: { padding: '8px 14px', borderRadius: 999, border: '1px solid #dde', background: '#fff', color: '#333', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
  chipActive: { padding: '8px 14px', borderRadius: 999, border: '1px solid #2f6fed', background: '#eef3ff', color: '#2f6fed', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  filters: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  filterInput: { padding: '9px 12px', borderRadius: 10, border: '1px solid #ccd', fontSize: 14, minWidth: 110, flex: 1 },
  feedTitle: { fontSize: 16, margin: '4px 0 0' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 },
  item: { display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer', border: '1px solid #eef', borderRadius: 12, overflow: 'hidden', background: '#fff' },
  thumb: { width: '100%', aspectRatio: '1 / 1', background: '#f1f2f7', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  thumbEmoji: { fontSize: 40, opacity: 0.5 },
  price: { fontSize: 16, padding: '6px 10px 0' },
  itemTitle: { fontSize: 14, padding: '0 10px', color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  itemMeta: { fontSize: 12, padding: '0 10px 10px', color: '#777' },
  muted: { color: '#888', fontSize: 14 },
  error: { color: '#b3261e', fontSize: 14 },
}
