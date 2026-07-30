import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { SYRIA_GOVERNORATES } from '../../engines/search/syriaData'

type Props = {
  lang: Lang
}

/* ---------------------------------------------------------------------------
 * Centralized brand / destination config. To clone this STR platform for
 * another country, swap this block + the destinations import (SYRIA_GOVERNORATES)
 * — no city/country strings are hard-coded inline below.
 * ------------------------------------------------------------------------- */
const PLATFORM = {
  brand: 'SYBNB',
  suffix: 'STR',
  country: { ar: 'سوريا', en: 'Syria' },
  destinationCount: SYRIA_GOVERNORATES.length,
  heroPhoto: '/assets/divisions/daily-rental.webp',
  staySearchKey: 'sybnb_v6_stay_search',
}

const COPY = {
  ar: {
    heroBadge: 'اكتشف سوريا من جديد',
    searchStay: 'ابحث عن إقامة',
    becomeHost: 'أصبح مضيفاً',
    heroTitle: 'تشعر أنك في المكان الصحيح',
    heroSub: 'إقامات موثوقة · أسعار واضحة · دعم محلي',
    trustVerified: 'إقامات موثوقة',
    trustVerifiedBody: 'إعلانات تُراجَع قبل نشرها.',
    trustSecure: 'حجز آمن',
    trustSecureBody: 'دفع محميّ ومراجعة للنزاعات.',
    trustSupport: 'دعم محلي',
    trustSupportBody: 'فريق حقيقي من الحجز حتى المغادرة.',
    howTitle: 'كيف تعمل',
    step1: 'ابحث واختر',
    step1Body: 'حدّد وجهتك وتواريخك وعدد الضيوف، وتصفّح الإقامات.',
    step2: 'احجز وادفع بأمان',
    step2Body: 'أكمل الحجز وادفع عبر دفع محميّ قبل وصولك.',
    step3: 'تابع رحلتك',
    step3Body: 'تابع حجوزاتك ومدفوعاتك ورحلتك من رحلاتي.',
    tripsTitle: 'رحلاتي',
    tripsBody: 'حجوزاتك ومدفوعاتك ورحلاتك في مكان واحد.',
    tripsCta: 'افتح رحلاتي',
    aboutEyebrow: 'SYBNB · STR',
    aboutTitle: 'إقامات سوريا، بثقة وحماية.',
    aboutBody:
      'SYBNB منصّة إقامات قصيرة الأمد داخل سوريا: ابحث عن مكانك، احجز، وادفع بحماية كاملة، وتابع رحلتك من مكان واحد.',
    missionTitle: 'المهمة',
    missionBody: 'تسهيل حجز الإقامات داخل سوريا بطريقة موثوقة وآمنة للضيف والمضيف.',
    visionTitle: 'الرؤية',
    visionBody: 'أن تصبح SYBNB الوجهة الأولى لحجز الإقامات المحمية في سوريا.',
    sloganTitle: 'الشعار',
    sloganBody: 'ابحث بثقة. احجز بأمان. تابع كل شيء من مكان واحد.',
  },
  en: {
    heroBadge: 'Discover Syria, reimagined',
    searchStay: 'Search stay',
    becomeHost: 'Become a host',
    heroTitle: 'Stay somewhere that feels right',
    heroSub: 'Verified homes · Clear prices · Local support',
    trustVerified: 'Verified homes',
    trustVerifiedBody: 'Listings are reviewed before they go live.',
    trustSecure: 'Secure booking',
    trustSecureBody: 'Protected payment and dispute review.',
    trustSupport: 'Local support',
    trustSupportBody: 'A real team from booking to checkout.',
    howTitle: 'How it works',
    step1: 'Search & choose',
    step1Body: 'Set your destination, dates, and guests, then browse stays.',
    step2: 'Book & pay safely',
    step2Body: 'Complete the booking and pay through protected payment before arrival.',
    step3: 'Track your trip',
    step3Body: 'Follow your bookings, payments, and trip from My Trips.',
    tripsTitle: 'My Trips',
    tripsBody: 'Your bookings, payments, and trips in one place.',
    tripsCta: 'Open My Trips',
    aboutEyebrow: 'SYBNB · STR',
    aboutTitle: 'Stays in Syria, with trust and protection.',
    aboutBody:
      'SYBNB is a short-term stays platform inside Syria: find your place, book it, pay with full protection, and track your trip from one place.',
    missionTitle: 'Mission',
    missionBody: 'Make booking stays inside Syria trusted and safe for both guests and hosts.',
    visionTitle: 'Vision',
    visionBody: 'Become the first destination for protected stay bookings in Syria.',
    sloganTitle: 'Slogan',
    sloganBody: 'Search with trust. Book safely. Track everything in one place.',
  },
}

export function LandingPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = COPY[lang]
  const serif = isAr ? '' : ' stay-serif'

  const trust = [
    { icon: '✓', title: t.trustVerified, body: t.trustVerifiedBody },
    { icon: '⛨', title: t.trustSecure, body: t.trustSecureBody },
    { icon: '☎', title: t.trustSupport, body: t.trustSupportBody },
  ]

  const steps = [
    { n: 1, title: t.step1, body: t.step1Body },
    { n: 2, title: t.step2, body: t.step2Body },
    { n: 3, title: t.step3, body: t.step3Body },
  ]

  return (
    <main className="landing-page str-landing">
      {/* 1 — STAYS HERO */}
      <section
        id="stay-search"
        className="str-hero"
        style={{ backgroundImage: `url(${PLATFORM.heroPhoto})` }}
        aria-label={t.heroTitle}
      >
        <div className="str-hero-inner">
          <span className="str-hero-badge">{t.heroBadge}</span>
          <h1 className={`str-hero-title${serif}`}>{t.heroTitle}</h1>
          <p className="str-hero-sub">{t.heroSub}</p>

          <div className="str-hero-actions">
            <button className="str-btn-teal" onClick={() => navigate('/search-preview')}>
              {t.searchStay}
            </button>
            <button className="str-btn-outline" onClick={() => navigate('/become-host')}>
              {t.becomeHost}
            </button>
          </div>
        </div>
      </section>

      {/* 2 — TRUST STRIP */}
      <section className="str-trust" aria-label={t.heroSub}>
        {trust.map((item) => (
          <div className="str-trust-item" key={item.title}>
            <span className="str-trust-icon" aria-hidden="true">{item.icon}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </div>
          </div>
        ))}
      </section>

      {/* 3 — HOW IT WORKS */}
      <section className="str-how" aria-label={t.howTitle}>
        <h2 className={`str-section-title${serif}`}>{t.howTitle}</h2>
        <div className="str-how-grid">
          {steps.map((step) => (
            <article className="str-step" key={step.n}>
              <span className="str-step-num" aria-hidden="true">{step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 4 — ABOUT */}
      <section id="platform-about" className="str-about" aria-label={t.aboutEyebrow}>
        <span className="str-about-eyebrow">{t.aboutEyebrow}</span>
        <h2 className={serif.trim()}>{t.aboutTitle}</h2>
        <p className="str-about-lead">{t.aboutBody}</p>
        <div className="str-about-pillars">
          <article>
            <b>{t.missionTitle}</b>
            <p>{t.missionBody}</p>
          </article>
          <article>
            <b>{t.visionTitle}</b>
            <p>{t.visionBody}</p>
          </article>
          <article>
            <b>{t.sloganTitle}</b>
            <p>{t.sloganBody}</p>
          </article>
        </div>
      </section>
    </main>
  )
}
