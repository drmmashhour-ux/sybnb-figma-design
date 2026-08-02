import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'

// SR (Syria Rides) STANDALONE PLATFORM ENTRY — the independent ride-hailing surface, isolated from the
// STR/stays landing (owner directive: each division is its own platform). Its own hero + branding + the
// three doors into SR: request a ride, drive & earn, and (via the ride page) your trips. Pure
// presentation — no platform data — so it stays cleanly isolated.

type Props = {
  lang: Lang
  onLanguageChange?: (lang: Lang) => void
}

const copy = {
  ar: {
    eyebrow: 'سوريا رايدز',
    title: 'تنقّل في سوريا، بأمان وسعرٍ واضح',
    subtitle: 'رحلات عند الطلب — سائق موثّق، تتبّع مباشر، ودفع محميّ داخل التطبيق.',
    rideTitle: 'اطلب رحلة',
    rideDesc: 'حدّد وجهتك، شاهد السعر مسبقاً، وتتبّع سائقك على الخريطة.',
    rideCta: 'اطلب الآن',
    driveTitle: 'قُد واربح',
    driveDesc: 'انضم كسائق موثّق، استقبل أقرب الطلبات، واسحب أرباحك.',
    driveCta: 'ابدأ القيادة',
    safeTitle: 'رحلة آمنة',
    safeDesc: 'رمز استلام، مشاركة الرحلة، وزر طوارئ — الأمان أولاً.',
    trust: 'سائق موثّق · تتبّع مباشر · دفع محميّ',
    back: 'الرئيسية',
  },
  en: {
    eyebrow: 'Syria Rides',
    title: 'Move around Syria — safely, at a clear price',
    subtitle: 'On-demand rides — a verified driver, live tracking, and protected in-app payment.',
    rideTitle: 'Request a ride',
    rideDesc: 'Set your destination, see the price upfront, and track your driver on the map.',
    rideCta: 'Request now',
    driveTitle: 'Drive & earn',
    driveDesc: 'Join as a verified driver, get the nearest requests, and cash out your earnings.',
    driveCta: 'Start driving',
    safeTitle: 'Safe trips',
    safeDesc: 'Pickup code, trip sharing, and an SOS button — safety first.',
    trust: 'Verified driver · Live tracking · Protected payment',
    back: 'Home',
  },
}

export function SrLandingPage({ lang, onLanguageChange }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const go = (hash: string) => (window.location.hash = hash)

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <header style={styles.topbar}>
        <button style={styles.brandBtn} onClick={() => go('/')}>
          <img src="/assets/logos/sr-ride.png" alt="Syria Rides" style={styles.brandLogo} />
          <span style={styles.brandText}>
            SYBNB <span style={{ color: '#f59e0b' }}>Rides</span>
          </span>
        </button>
        <div style={styles.langRow}>
          <button style={{ ...styles.langBtn, ...(isAr ? styles.langOn : null) }} onClick={() => onLanguageChange?.('ar')}>
            AR
          </button>
          <button style={{ ...styles.langBtn, ...(!isAr ? styles.langOn : null) }} onClick={() => onLanguageChange?.('en')}>
            EN
          </button>
        </div>
      </header>

      <section style={styles.hero}>
        <span style={styles.eyebrow}>{t.eyebrow}</span>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.subtitle}>{t.subtitle}</p>
        <div style={styles.heroCtas}>
          <button style={styles.primaryCta} onClick={() => go('/ride')}>
            {t.rideCta}
          </button>
          <button style={styles.ghostCta} onClick={() => go('/driver')}>
            {t.driveCta}
          </button>
        </div>
        <p style={styles.trust}>{t.trust}</p>
      </section>

      <section style={styles.cards}>
        <Card icon="🚕" title={t.rideTitle} desc={t.rideDesc} cta={t.rideCta} onClick={() => go('/ride')} accent="#14b8a6" />
        <Card icon="🧭" title={t.driveTitle} desc={t.driveDesc} cta={t.driveCta} onClick={() => go('/driver')} accent="#f59e0b" />
        <Card icon="🛡️" title={t.safeTitle} desc={t.safeDesc} accent="#3b82f6" />
      </section>
    </main>
  )
}

function Card({ icon, title, desc, cta, onClick, accent }: { icon: string; title: string; desc: string; cta?: string; onClick?: () => void; accent: string }) {
  return (
    <article style={{ ...styles.card, borderTop: `3px solid ${accent}` }}>
      <div style={styles.cardIcon}>{icon}</div>
      <h2 style={styles.cardTitle}>{title}</h2>
      <p style={styles.cardDesc}>{desc}</p>
      {cta && onClick ? (
        <button style={{ ...styles.cardCta, color: accent, borderColor: accent }} onClick={onClick}>
          {cta} →
        </button>
      ) : null}
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: 'radial-gradient(1200px 500px at 50% -10%, #0e2a2a, #0a0f1d 60%)', color: '#e6ebf4', padding: '0 0 56px' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', maxWidth: 1120, margin: '0 auto' },
  brandBtn: { display: 'inline-flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer' },
  brandLogo: { height: 34, width: 34, objectFit: 'contain', borderRadius: 8 },
  brandText: { fontWeight: 900, fontSize: 20, color: '#2DD4BF', letterSpacing: '.02em' },
  langRow: { display: 'flex', gap: 6, background: '#0f1a24', borderRadius: 999, padding: 4 },
  langBtn: { border: 'none', background: 'transparent', color: '#8f96a8', fontWeight: 800, borderRadius: 999, padding: '6px 14px', cursor: 'pointer' },
  langOn: { background: '#f59e0b', color: '#1a1204' },
  hero: { maxWidth: 820, margin: '0 auto', textAlign: 'center', padding: '40px 22px 26px' },
  eyebrow: { display: 'inline-block', color: '#2DD4BF', fontWeight: 900, letterSpacing: 2, fontSize: 12, textTransform: 'uppercase' },
  title: { fontSize: 40, lineHeight: 1.1, margin: '14px 0 12px', textWrap: 'balance' as CSSProperties['textWrap'] },
  subtitle: { color: '#aeb7c6', fontSize: 17, margin: '0 auto', maxWidth: 620, lineHeight: 1.6 },
  heroCtas: { display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 26 },
  primaryCta: { background: '#2DD4BF', color: '#04211d', border: 'none', borderRadius: 12, padding: '14px 28px', fontWeight: 900, fontSize: 16, cursor: 'pointer' },
  ghostCta: { background: 'transparent', color: '#e6ebf4', border: '1px solid #2a3b4d', borderRadius: 12, padding: '14px 28px', fontWeight: 800, fontSize: 16, cursor: 'pointer' },
  trust: { color: '#7d879a', fontSize: 13, marginTop: 20 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, maxWidth: 1120, margin: '18px auto 0', padding: '0 22px' },
  card: { background: '#0e1622', border: '1px solid #1c2938', borderRadius: 16, padding: 22, display: 'grid', gap: 8, alignContent: 'start' },
  cardIcon: { fontSize: 30 },
  cardTitle: { margin: 0, fontSize: 20 },
  cardDesc: { margin: 0, color: '#9aa6ba', fontSize: 15, lineHeight: 1.55 },
  cardCta: { justifySelf: 'start', marginTop: 8, background: 'transparent', border: '1px solid', borderRadius: 10, padding: '9px 16px', fontWeight: 800, cursor: 'pointer' },
}

export default SrLandingPage
