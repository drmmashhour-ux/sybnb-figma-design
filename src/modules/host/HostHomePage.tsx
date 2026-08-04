import { useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import type { CSSVars } from '../../shared/theme/cssVars'
import { SELLER_PLANS } from '../seller/sellerData'

type Props = {
  lang: Lang
}

// SYBNB takes a flat 10% commission per booking (one-time listing plan is paid separately).
// This is a real platform rule, not a market estimate.
const COMMISSION_RATE = 0.1

// Hero background photo. SWAP THIS ONE VALUE when the owner supplies the real
// Damascus-courtyard photo (drop the file in public/assets and point this at it).
const HERO_BG_IMAGE = '/assets/divisions/daily-rental.webp'

// Same handoff key the guest landing writes, so "Search stays" here lands in the real search.
const STAY_SEARCH_KEY = 'sybnb_v6_stay_search'

const COPY = {
  ar: {
    brand: 'SYBNB · STR',
    heroEyebrow: 'استضف معنا',
    heroTitleLead: 'شارك بيتك،',
    heroTitleAccent: 'واربح بثقة',
    heroTrust: 'منازل موثّقة · بلا رسوم خفية · دعم محلي',
    becomeHost: 'أصبح مضيفاً',
    hostCardTitle: 'عندك مكان تستضيف فيه؟',
    hostCardSub: 'انشر إقامتك وابدأ باستقبال الحجوزات بحماية كاملة.',
    orSearch: 'أو ابحث عن إقامة',
    where: 'الوجهة',
    whereAll: 'كل الوجهات',
    checkIn: 'الوصول',
    checkOut: 'المغادرة',
    guests: 'الضيوف',
    searchStays: 'ابحث عن إقامة',
    trustRow: [
      { icon: '✓', t: 'منازل موثّقة', b: 'إعلانات تُراجَع قبل نشرها.' },
      { icon: '⊘', t: 'بلا رسوم خفية', b: 'عمولة واضحة 10% لكل حجز فقط.' },
      { icon: '☎', t: 'دعم محلي', b: 'فريق بشري حقيقي بالعربية.' },
    ],
    estTitle: 'قدّر أرباحك',
    estNote: 'تقدير حسب إدخالك — أرقامك أنت، بلا متوسطات سوق.',
    estNightly: 'سعر الليلة (دولار)',
    estNights: 'ليالٍ محجوزة شهرياً',
    estGross: 'الإجمالي الشهري',
    estCommission: 'عمولة SYBNB (10%)',
    estNet: 'صافي أرباحك',
    estNightsUnit: 'ليلة',
    whyTitle: 'لماذا تستضيف مع SYBNB',
    why: [
      { t: 'دفع محمي', b: 'أموال الحجز محمية حتى يكتمل الحجز.' },
      { t: 'حماية الحجز والصرف', b: 'حماية للحجز وصرف أرباحك بأمان.' },
      { t: 'مراجعة النزاعات', b: 'فريق يراجع أي نزاع بإنصاف.' },
      { t: 'دعم محلي', b: 'دعم بشري حقيقي بالعربية.' },
      { t: 'تحكم كامل بالأسعار والتقويم', b: 'أنت تحدّد السعر والتواريخ المتاحة.' },
    ],
    howTitle: 'كيف تعمل الاستضافة',
    how: [
      { n: 1, t: 'اعرض مساحتك', b: 'وصف + صور + خيارات البحث لتظهر إقامتك بأفضل صورة.' },
      { n: 2, t: 'حدّد السعر والتقويم', b: 'اضبط سعر الليلة والتواريخ المتاحة كما تريد.' },
      { n: 3, t: 'استقبل الحجوزات', b: 'استقبل الحجوزات واحصل على أرباحك بأمان.' },
    ],
    plansTitle: 'خطط النشر',
    plansNote: 'خطة لمرة واحدة + عمولة 10% لكل حجز.',
    payMethods: 'ادفع بشام كاش أو ببطاقة (Stripe/ماستر كارد).',
    planPayOnce: 'ادفع مرة واحدة لنشر إعلانك.',
    planCta: 'ابدأ بهذه الخطة',
    finalTitle: 'جاهز لاستقبال ضيوفك؟',
    finalBody: 'انشر إقامتك اليوم وابدأ الاستضافة مع حماية كاملة.',
    finalCta: 'أصبح مضيفاً',
  },
  en: {
    brand: 'SYBNB · STR',
    heroEyebrow: 'Host with us',
    heroTitleLead: 'Share your home,',
    heroTitleAccent: 'earn with confidence',
    heroTrust: 'Verified homes · No hidden fees · Local support',
    becomeHost: 'Become a host',
    hostCardTitle: 'Have a place to host?',
    hostCardSub: 'List your stay and start receiving bookings with full protection.',
    orSearch: 'Or search a stay',
    where: 'Where',
    whereAll: 'All destinations',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    guests: 'Guests',
    searchStays: 'Search stay',
    trustRow: [
      { icon: '✓', t: 'Verified homes', b: 'Listings are reviewed before they go live.' },
      { icon: '⊘', t: 'No hidden fees', b: 'A clear 10% commission per booking, nothing else.' },
      { icon: '☎', t: 'Local support', b: 'A real human team in Arabic.' },
    ],
    estTitle: 'Estimate your earnings',
    estNote: 'Estimate based on your input — your own numbers, no market averages.',
    estNightly: 'Nightly price (USD)',
    estNights: 'Booked nights per month',
    estGross: 'Monthly gross',
    estCommission: 'SYBNB commission (10%)',
    estNet: 'Your net',
    estNightsUnit: 'nights',
    whyTitle: 'Why host with SYBNB',
    why: [
      { t: 'Protected payment', b: 'Booking funds are protected until the booking completes.' },
      { t: 'Booking & payout protection', b: 'Protection for the booking and safe payout of your earnings.' },
      { t: 'Dispute review', b: 'A team reviews any dispute fairly.' },
      { t: 'Local support', b: 'Real human support in Arabic.' },
      { t: 'Full price & calendar control', b: 'You set the price and the available dates.' },
    ],
    howTitle: 'How hosting works',
    how: [
      { n: 1, t: 'List your place', b: 'Description + photos + search options so your stay shows at its best.' },
      { n: 2, t: 'Set price & calendar', b: 'Set the nightly price and available dates however you want.' },
      { n: 3, t: 'Get bookings', b: 'Receive bookings and get paid safely.' },
    ],
    plansTitle: 'Listing plans',
    plansNote: 'One-time plan + 10% commission per booking.',
    payMethods: 'Pay with Sham Cash or card (Stripe / Mastercard).',
    planPayOnce: 'Pay once to list your place.',
    planCta: 'Start with this plan',
    finalTitle: 'Ready to welcome your guests?',
    finalBody: 'Publish your stay today and start hosting with full protection.',
    finalCta: 'Become a host',
  },
}

export function HostHomePage({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = COPY[lang]
  const serif = isAr ? '' : ' hosth-serif'
  const usd = (value: number) => `$${Math.max(0, Math.round(value)).toLocaleString(isAr ? 'ar-SY' : 'en-US')}`

  // Earnings estimator (USD) — pure math on the host's own inputs.
  const [nightly, setNightly] = useState(40)
  const [nights, setNights] = useState(10)
  const gross = Math.max(0, Math.round(nightly)) * Math.max(0, nights)
  const commission = Math.round(gross * COMMISSION_RATE)
  const net = gross - commission

  const startHosting = () => navigate('/host/stays')
  const scrollToPlans = () =>
    document.getElementById('hosth-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <main className="hosth-page" dir={isAr ? 'rtl' : 'ltr'}>
      {/* 1 — HERO (warm courtyard, hybrid) */}
      <section
        className="hosth-hero"
        style={{ backgroundImage: `url(${HERO_BG_IMAGE})` }}
        aria-label={`${t.heroTitleLead} ${t.heroTitleAccent}`}
      >
        <div className="hosth-hero-inner">
          <span className="hosth-eyebrow">{t.heroEyebrow}</span>
          <h1 className={`hosth-hero-title${serif}`}>
            {t.heroTitleLead} <span className="hosth-hero-accent">{t.heroTitleAccent}</span>
          </h1>
          <p className="hosth-hero-sub">{t.heroTrust}</p>

          {/* Two clear CTAs: become a host, or jump to the guest stay search. */}
          <div className="hosth-hero-actions" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 24 }}>
            <button className="hosth-btn-primary" onClick={startHosting}>
              {t.becomeHost}
            </button>
            <button className="hosth-btn-ghost" onClick={() => navigate('/search-preview')}>
              {t.searchStays}
            </button>
          </div>
        </div>
      </section>

      {/* HOST STORY VIDEO — autoplays (muted) so guests see it the moment they open the page */}
      <section
        style={{ padding: '18px clamp(22px, 4vw, 54px) 0', maxWidth: 1180, margin: '0 auto', width: '100%' }}
        aria-label={isAr ? 'قصة المضيف مع SYBNB' : 'Host story with SYBNB'}
      >
        <video
          src="/assets/videos/host-ar.mp4"
          autoPlay
          muted
          loop
          controls
          playsInline
          preload="auto"
          style={{ width: '100%', borderRadius: 20, display: 'block', border: '1px solid var(--hairline)', background: '#000' }}
        />
      </section>

      {/* Trust row */}
      <section className="hosth-trustrow" aria-label={t.heroTrust}>
        {t.trustRow.map((item) => (
          <div className="hosth-trust-item" key={item.t}>
            <span className="hosth-trust-icon" aria-hidden="true">{item.icon}</span>
            <div>
              <strong>{item.t}</strong>
              <p>{item.b}</p>
            </div>
          </div>
        ))}
      </section>

      {/* 2 — HONEST EARNINGS ESTIMATOR (USD) */}
      <section className="hosth-est" aria-label={t.estTitle}>
        <div className="hosth-est-copy">
          <h2 className={`hosth-section-title${serif}`}>{t.estTitle}</h2>
          <p className="hosth-est-note">{t.estNote}</p>

          <label className="hosth-field" htmlFor="hosth-nightly">
            <span>{t.estNightly}</span>
            <input
              id="hosth-nightly"
              type="number"
              min={0}
              step={5}
              value={nightly}
              onChange={(e) => setNightly(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>

          <label className="hosth-field" htmlFor="hosth-nights">
            <span>
              {t.estNights}: <b>{nights} {t.estNightsUnit}</b>
            </span>
            <input
              id="hosth-nights"
              type="range"
              min={0}
              max={30}
              step={1}
              value={nights}
              onChange={(e) => setNights(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="hosth-est-result" aria-live="polite">
          <div className="hosth-est-row">
            <span>{t.estGross}</span>
            <strong>{usd(gross)}</strong>
          </div>
          <div className="hosth-est-row hosth-est-row-sub">
            <span>{t.estCommission}</span>
            <strong>-{usd(commission)}</strong>
          </div>
          <div className="hosth-est-row hosth-est-row-net">
            <span>{t.estNet}</span>
            <strong>{usd(net)}</strong>
          </div>
          <p className="hosth-est-fineprint">{t.estNote}</p>
        </div>
      </section>

      {/* 3 — WHY HOST */}
      <section className="hosth-why" aria-label={t.whyTitle}>
        <h2 className={`hosth-section-title${serif}`}>{t.whyTitle}</h2>
        <div className="hosth-why-grid">
          {t.why.map((card) => (
            <article className="hosth-why-card" key={card.t}>
              <span className="hosth-why-mark" aria-hidden="true">✦</span>
              <b>{card.t}</b>
              <p>{card.b}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 4 — HOW IT WORKS */}
      <section className="hosth-how" aria-label={t.howTitle}>
        <h2 className={`hosth-section-title${serif}`}>{t.howTitle}</h2>
        <div className="hosth-how-grid">
          {t.how.map((phase) => (
            <article className="hosth-phase" key={phase.n}>
              <span className="hosth-phase-num" aria-hidden="true">{phase.n}</span>
              <h3>{phase.t}</h3>
              <p>{phase.b}</p>
            </article>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="hosth-final" aria-label={t.finalTitle}>
        <div className="hosth-final-inner">
          <h2 className={serif.trim()}>{t.finalTitle}</h2>
          <p>{t.finalBody}</p>
          <button className="hosth-btn-primary" onClick={startHosting}>
            {t.finalCta}
          </button>
          <p className="hosth-pay-methods hosth-pay-methods-final">{t.payMethods}</p>
        </div>
      </section>
    </main>
  )
}
