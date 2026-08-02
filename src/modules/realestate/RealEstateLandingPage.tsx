import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'

// SYBNB Homes — the STANDALONE real-estate platform entry (Buy / Rent / Sell), isolated from the STR
// stays landing and the SR ride landing per the owner's "each division is its own platform" directive.
// Centris-style: a single hero that toggles Buy vs Rent and funnels into the existing search pages
// (/buy, /rentals), plus a door for owners to list a property (/sell). Pure presentation — no platform
// data — so it stays cleanly isolated.

type Props = {
  lang: Lang
  onLanguageChange?: (lang: Lang) => void
}

const copy = {
  ar: {
    eyebrow: 'سكن سوريا',
    title: 'ابحث عن منزلك في سوريا — شراءً أو إيجاراً',
    subtitle: 'آلاف العقارات الموثّقة: شقق، فلل، ومحلات — بحث بالخريطة والفلاتر، وتواصل آمن مع المالك.',
    tabBuy: 'شراء',
    tabRent: 'إيجار شهري',
    searchBuy: 'تصفح عقارات البيع',
    searchRent: 'تصفح عقارات الإيجار',
    buyTitle: 'شراء عقار',
    buyDesc: 'شقق، فلل، وأراضٍ — قارن الأسعار، شاهد التفاصيل، وأرسل طلب زيارة.',
    rentTitle: 'إيجار شهري',
    rentDesc: 'سكن طويل المدى بميزانيتك — فلترة بالمدينة، الغرف، والمزايا.',
    sellTitle: 'اعرض عقارك',
    sellDesc: 'انشر إعلانك مجاناً، وتواصل مع المهتمين عبر IMMOContact الآمن.',
    sellCta: 'أضف إعلاناً',
    trust: 'عقارات موثّقة · بحث بالخريطة · تواصل محميّ',
    back: 'الرئيسية',
  },
  en: {
    eyebrow: 'Syria Homes',
    title: 'Find your home in Syria — to buy or to rent',
    subtitle: 'Thousands of verified properties: apartments, villas, and shops — map + filter search, and safe contact with the owner.',
    tabBuy: 'Buy',
    tabRent: 'Monthly rent',
    searchBuy: 'Browse properties for sale',
    searchRent: 'Browse rentals',
    buyTitle: 'Buy property',
    buyDesc: 'Apartments, villas, and land — compare prices, view details, and send a visit request.',
    rentTitle: 'Monthly rent',
    rentDesc: 'Long-term homes on your budget — filter by city, rooms, and amenities.',
    sellTitle: 'List your property',
    sellDesc: 'Publish your listing for free and reach interested people through safe IMMOContact.',
    sellCta: 'Add a listing',
    trust: 'Verified listings · Map search · Protected contact',
    back: 'Home',
  },
}

export function RealEstateLandingPage({ lang, onLanguageChange }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [tab, setTab] = useState<'buy' | 'rent'>('buy')
  const go = (hash: string) => (window.location.hash = hash)

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <header style={styles.topbar}>
        <button style={styles.brandBtn} onClick={() => go('/')}>
          <span style={styles.brandMark}>🏠</span>
          <span style={styles.brandText}>
            SYBNB <span style={{ color: '#D4AF6A' }}>Homes</span>
          </span>
        </button>
        <div style={styles.langRow}>
          <button style={{ ...styles.langBtn, ...(isAr ? styles.langOn : null) }} onClick={() => onLanguageChange?.('ar')}>AR</button>
          <button style={{ ...styles.langBtn, ...(!isAr ? styles.langOn : null) }} onClick={() => onLanguageChange?.('en')}>EN</button>
        </div>
      </header>

      <section style={styles.hero}>
        <span style={styles.eyebrow}>{t.eyebrow}</span>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.subtitle}>{t.subtitle}</p>

        <div style={styles.tabs} role="tablist">
          <button role="tab" aria-selected={tab === 'buy'} style={{ ...styles.tab, ...(tab === 'buy' ? styles.tabOn : null) }} onClick={() => setTab('buy')}>
            {t.tabBuy}
          </button>
          <button role="tab" aria-selected={tab === 'rent'} style={{ ...styles.tab, ...(tab === 'rent' ? styles.tabOn : null) }} onClick={() => setTab('rent')}>
            {t.tabRent}
          </button>
        </div>
        <button style={styles.primaryCta} onClick={() => go(tab === 'buy' ? '/buy' : '/rentals')}>
          {tab === 'buy' ? t.searchBuy : t.searchRent} →
        </button>
        <p style={styles.trust}>{t.trust}</p>
      </section>

      <section style={styles.cards}>
        <Card icon="🏢" title={t.buyTitle} desc={t.buyDesc} cta={t.tabBuy} onClick={() => go('/buy')} accent="#2DD4BF" />
        <Card icon="🔑" title={t.rentTitle} desc={t.rentDesc} cta={t.tabRent} onClick={() => go('/rentals')} accent="#38bdf8" />
        <Card icon="➕" title={t.sellTitle} desc={t.sellDesc} cta={t.sellCta} onClick={() => go('/sell')} accent="#D4AF6A" />
      </section>
    </main>
  )
}

function Card({ icon, title, desc, cta, onClick, accent }: { icon: string; title: string; desc: string; cta: string; onClick: () => void; accent: string }) {
  return (
    <article style={{ ...styles.card, borderTop: `3px solid ${accent}` }}>
      <div style={styles.cardIcon}>{icon}</div>
      <h2 style={styles.cardTitle}>{title}</h2>
      <p style={styles.cardDesc}>{desc}</p>
      <button style={{ ...styles.cardCta, color: accent, borderColor: accent }} onClick={onClick}>{cta} →</button>
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: 'radial-gradient(1200px 500px at 50% -10%, #0e2a2a, #0a0f1d 60%)', color: '#e6ebf4', padding: '0 0 56px' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', maxWidth: 1120, margin: '0 auto' },
  brandBtn: { display: 'inline-flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer' },
  brandMark: { fontSize: 26 },
  brandText: { fontWeight: 900, fontSize: 20, color: '#2DD4BF', letterSpacing: '.02em' },
  langRow: { display: 'flex', gap: 6, background: '#0f1a24', borderRadius: 999, padding: 4 },
  langBtn: { border: 'none', background: 'transparent', color: '#8f96a8', fontWeight: 800, borderRadius: 999, padding: '6px 14px', cursor: 'pointer' },
  langOn: { background: '#D4AF6A', color: '#1a1204' },
  hero: { maxWidth: 820, margin: '0 auto', textAlign: 'center', padding: '40px 22px 26px' },
  eyebrow: { display: 'inline-block', color: '#2DD4BF', fontWeight: 900, letterSpacing: 2, fontSize: 12, textTransform: 'uppercase' },
  title: { fontSize: 40, lineHeight: 1.1, margin: '14px 0 12px', textWrap: 'balance' as CSSProperties['textWrap'] },
  subtitle: { color: '#aeb7c6', fontSize: 17, margin: '0 auto', maxWidth: 640, lineHeight: 1.6 },
  tabs: { display: 'inline-flex', gap: 4, background: '#0f1a24', borderRadius: 999, padding: 5, marginTop: 26 },
  tab: { border: 'none', background: 'transparent', color: '#8f96a8', fontWeight: 800, borderRadius: 999, padding: '9px 22px', cursor: 'pointer', fontSize: 15 },
  tabOn: { background: '#2DD4BF', color: '#04211d' },
  primaryCta: { display: 'block', margin: '16px auto 0', background: '#2DD4BF', color: '#04211d', border: 'none', borderRadius: 12, padding: '14px 28px', fontWeight: 900, fontSize: 16, cursor: 'pointer' },
  trust: { color: '#7d879a', fontSize: 13, marginTop: 20 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, maxWidth: 1120, margin: '18px auto 0', padding: '0 22px' },
  card: { background: '#0e1622', border: '1px solid #1c2938', borderRadius: 16, padding: 22, display: 'grid', gap: 8, alignContent: 'start' },
  cardIcon: { fontSize: 30 },
  cardTitle: { margin: 0, fontSize: 20 },
  cardDesc: { margin: 0, color: '#9aa6ba', fontSize: 15, lineHeight: 1.55 },
  cardCta: { justifySelf: 'start', marginTop: 8, background: 'transparent', border: '1px solid', borderRadius: 10, padding: '9px 16px', fontWeight: 800, cursor: 'pointer' },
}

export default RealEstateLandingPage
