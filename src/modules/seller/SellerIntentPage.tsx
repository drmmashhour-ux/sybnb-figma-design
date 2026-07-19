import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../../shared/brand'
import { SELLER_PLANS } from './sellerData'
import type { CSSVars } from '../../shared/theme/cssVars'

type Props = {
  lang: Lang
  intent: 'host' | 'rent' | 'sell' | 'car'
}

const ROLE_STORAGE_KEY = 'sybnb_v6_selected_seller_role'
const FLOW_STORAGE_KEY = 'sybnb_v6_sell_flow'
// Mirrors DRAFT_STORAGE_KEY in SellerListingWizard.tsx -- that wizard reads `division` off this
// same sessionStorage key on mount. Keep both in sync if either key ever changes.
const DRAFT_STORAGE_KEY = 'sybnb_v6_sell_wizard_draft'

// STR_ADMIN_COMMISSION_RATE mirrors server/lib/finance-ledger.mjs. RENTALS and BUY have no
// per-transaction commission -- both are flat-plan, self-managed, matching SellerEntryPage's
// "seller-plan" mode copy.
const STR_COMMISSION_LABEL = { ar: '13%', en: '13%' }

type IntentConfig = {
  division: 'STAYS' | 'RENTALS' | 'BUY' | 'CARS'
  eyebrow: Record<Lang, string>
  title: Record<Lang, string>
  body: Record<Lang, string>
  logoCaption: Record<Lang, string>
  perks: Array<Record<Lang, string>>
  pricingTitle: Record<Lang, string>
  pricingBody: Record<Lang, string>
  altLinkLabel: Record<Lang, string>
}

const INTENT_CONFIG: Record<Props['intent'], IntentConfig> = {
  host: {
    division: 'STAYS',
    eyebrow: { ar: 'SYBNB / الاستضافة', en: 'SYBNB / Hosting' },
    title: { ar: 'كن مضيفاً مع SYBNB', en: 'Become a host with SYBNB' },
    body: {
      ar: 'استضف عقارك للإيجار اليومي واكسب دخلاً إضافياً. تسعير واضح من أول خطوة: خطة نشر ثابتة، وعمولة حجز واحدة بدون رسوم مخفية.',
      en: 'List your place for short stays and earn extra income. Clear pricing from step one: a fixed publishing plan, and one booking commission, no hidden fees.',
    },
    logoCaption: { ar: 'استضافة موثوقة، دفع محمي', en: 'Trusted hosting, protected payment' },
    perks: [
      { ar: 'استقبل حجوزات من عملاء حقيقيين داخل سوريا مباشرة.', en: 'Get real bookings from guests across Syria, directly.' },
      { ar: 'الدفع محمي ويُراجع من الإدارة قبل تأكيد كل حجز.', en: 'Payment is protected and admin-reviewed before every booking is confirmed.' },
      { ar: 'تتابع الحجوزات ومداخيلك من لوحة استضافة واحدة.', en: 'Track bookings and earnings from one hosting dashboard.' },
    ],
    pricingTitle: { ar: 'تسعيرك من أول يوم', en: 'Your pricing, from day one' },
    pricingBody: {
      ar: `تختار خطة نشر ثابتة، وتدفع عمولة ${STR_COMMISSION_LABEL.ar} فقط من قيمة الإيجار عند كل حجز مكتمل -- لا رسوم إضافية مفاجئة.`,
      en: `Pick a fixed publishing plan, and pay just ${STR_COMMISSION_LABEL.en} commission on the rent amount for every completed booking -- no surprise fees later.`,
    },
    altLinkLabel: { ar: 'تريد بيع عقار أو سيارة أو منتج بدلاً من ذلك؟', en: 'Want to sell a property, car, or product instead?' },
  },
  rent: {
    division: 'RENTALS',
    eyebrow: { ar: 'SYBNB / الإيجار الشهري', en: 'SYBNB / Monthly rental' },
    title: { ar: 'أجّر عقارك مع SYBNB', en: 'Rent out your property with SYBNB' },
    body: {
      ar: 'انشر عقارك للإيجار الشهري وصِل إلى مستأجرين حقيقيين. خطة نشر ثابتة، بدون أي عمولة على الإيجار -- أنت تدير التواصل والمستأجرين مباشرة.',
      en: 'List your property for monthly rent and reach real tenants. A fixed publishing plan, no commission on the rent -- you manage inquiries and tenants directly.',
    },
    logoCaption: { ar: 'نشر واضح، تواصل مباشر مع المستأجرين', en: 'Clear listing, direct contact with tenants' },
    perks: [
      { ar: 'يصل عقارك لباحثين عن إيجار شهري داخل سوريا.', en: 'Your property reaches people searching for monthly rentals across Syria.' },
      { ar: 'مستندات الملكية تُراجع من الإدارة قبل النشر.', en: 'Ownership documents are reviewed by admin before publishing.' },
      { ar: 'تدير طلبات التواصل والمستأجرين من حسابك مباشرة.', en: 'Manage inquiries and tenants directly from your account.' },
    ],
    pricingTitle: { ar: 'تسعيرك من أول يوم', en: 'Your pricing, from day one' },
    pricingBody: {
      ar: 'تختار خطة نشر ثابتة (Plus أو Premium) وتدفعها مرة واحدة -- بدون أي عمولة على الإيجار الشهري.',
      en: 'Pick a fixed publishing plan (Plus or Premium) and pay it once -- no commission on the monthly rent.',
    },
    altLinkLabel: { ar: 'تريد بيع العقار بدلاً من تأجيره؟', en: 'Want to sell the property instead of renting it?' },
  },
  sell: {
    division: 'BUY',
    eyebrow: { ar: 'SYBNB / بيع العقارات', en: 'SYBNB / Property sales' },
    title: { ar: 'بيع عقارك مع SYBNB', en: 'Sell your property with SYBNB' },
    body: {
      ar: 'انشر عقارك للبيع وصِل إلى مشترين جادين. خطة نشر ثابتة، بدون أي عمولة على سعر البيع -- أنت تدير التفاوض والمتابعة مباشرة.',
      en: 'List your property for sale and reach serious buyers. A fixed publishing plan, no commission on the sale price -- you manage negotiation and follow-up directly.',
    },
    logoCaption: { ar: 'نشر واضح، تفاوض مباشر مع المشترين', en: 'Clear listing, direct negotiation with buyers' },
    perks: [
      { ar: 'يصل عقارك لمشترين يبحثون فعلاً داخل سوريا.', en: 'Your property reaches buyers actively searching across Syria.' },
      { ar: 'مستندات الملكية تُراجع من الإدارة قبل النشر.', en: 'Ownership documents are reviewed by admin before publishing.' },
      { ar: 'التفاوض على السعر يتم مباشرة عبر IMMOContact.', en: 'Price negotiation happens directly through IMMOContact.' },
    ],
    pricingTitle: { ar: 'تسعيرك من أول يوم', en: 'Your pricing, from day one' },
    pricingBody: {
      ar: 'تختار خطة نشر ثابتة (Plus أو Premium) وتدفعها مرة واحدة -- بدون أي عمولة على سعر البيع. تفضل أن تدير SYBNB البيع كاملاً بدلاً منك؟ عمولة 5% فقط عند إتمام البيع.',
      en: 'Pick a fixed publishing plan (Plus or Premium) and pay it once -- no commission on the sale price. Prefer SYBNB to manage the whole sale instead? Just 5% commission when it closes.',
    },
    altLinkLabel: { ar: 'تفضل أن تدير SYBNB عملية البيع بالكامل؟', en: 'Prefer SYBNB to manage the whole sale for you?' },
  },
  car: {
    division: 'CARS',
    eyebrow: { ar: 'SYBNB / المركبات', en: 'SYBNB / Cars' },
    title: { ar: 'بيع سيارتك مع SYBNB', en: 'Sell your car with SYBNB' },
    body: {
      ar: 'انشر سيارتك للبيع وصِل إلى مشترين جادين داخل سوريا. خطة نشر ثابتة، بدون أي عمولة على سعر البيع -- أنت تدير التفاوض والمتابعة مباشرة.',
      en: 'List your car for sale and reach serious buyers across Syria. A fixed publishing plan, no commission on the sale price -- you manage negotiation and follow-up directly.',
    },
    logoCaption: { ar: 'نشر واضح، تفاوض مباشر مع المشترين', en: 'Clear listing, direct negotiation with buyers' },
    perks: [
      { ar: 'يصل إعلان سيارتك لمشترين يبحثون فعلاً داخل سوريا.', en: 'Your car reaches buyers actively searching across Syria.' },
      { ar: 'أوراق المركبة تُراجع من الإدارة قبل النشر.', en: 'Vehicle papers are reviewed by admin before publishing.' },
      { ar: 'تدير طلبات التواصل والمعاينة من حسابك مباشرة.', en: 'Manage inquiries and viewing requests directly from your account.' },
    ],
    pricingTitle: { ar: 'تسعيرك من أول يوم', en: 'Your pricing, from day one' },
    pricingBody: {
      ar: 'تختار خطة نشر ثابتة (Plus أو Premium) وتدفعها مرة واحدة -- بدون أي عمولة على سعر بيع السيارة.',
      en: 'Pick a fixed publishing plan (Plus or Premium) and pay it once -- no commission on the car sale price.',
    },
    altLinkLabel: { ar: 'تريد بيع سلعة أخرى بدلاً من ذلك؟', en: 'Want to sell something else instead?' },
  },
}

export function SellerIntentPage({ lang, intent }: Props) {
  const isAr = lang === 'ar'
  const config = INTENT_CONFIG[intent]
  const plus = SELLER_PLANS.find((plan) => plan.id === 'plus') ?? SELLER_PLANS[0]
  const premium = SELLER_PLANS.find((plan) => plan.id === 'premium') ?? SELLER_PLANS[1]

  function startFlow() {
    window.localStorage.setItem(ROLE_STORAGE_KEY, config.division === 'CARS' ? 'multi' : 'owner')
    window.localStorage.setItem(FLOW_STORAGE_KEY, 'listing')
    if (config.division !== 'STAYS') {
      window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ division: config.division }))
    } else {
      window.sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    }
    navigate('/sell/account')
  }

  return (
    <main className="seller-page become-host-page" dir={isAr ? 'rtl' : 'ltr'}>
      <section className="seller-hero become-host-hero">
        <button className="back-button seller-back" onClick={() => navigate('/')}>
          {isAr ? 'رجوع' : 'Back'}
        </button>
        <div className="seller-hero-grid">
          <div>
            <p className="eyebrow">{config.eyebrow[lang]}</p>
            <h1>{config.title[lang]}</h1>
            <p>{config.body[lang]}</p>
          </div>
          <div className="seller-logo-panel">
            <BrandLogo logo="plus" size="hero" />
            <span>{config.logoCaption[lang]}</span>
          </div>
        </div>
      </section>

      <section className="become-host-perks" aria-label={isAr ? 'المزايا' : 'Perks'}>
        {config.perks.map((perk) => (
          <div className="become-host-perk" key={perk.en}>
            <span aria-hidden="true">✓</span>
            <p>{perk[lang]}</p>
          </div>
        ))}
      </section>

      <section className="seller-design-note">
        <strong>{config.pricingTitle[lang]}</strong>
        <span>{config.pricingBody[lang]}</span>
      </section>

      <section className="seller-role-grid become-host-plans" aria-label={isAr ? 'خطط النشر' : 'Publishing plans'}>
        {[plus, premium].map((plan) => (
          <div className="seller-role-card become-host-plan-card" key={plan.id} style={{ '--accent': plan.accent } as CSSVars}>
            <span className="seller-role-title">
              {plan.label[lang]} <strong>{plan.price}</strong>
            </span>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature.en}>{feature[lang]}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="seller-action-panel become-host-action" style={{ '--accent': '#526cff' } as CSSVars}>
        <div>
          <p>{isAr ? 'جاهز؟' : 'Ready?'}</p>
          <strong>{isAr ? 'ابدأ إعداد حسابك' : 'Start setting up your account'}</strong>
          <span>{isAr ? 'حساب + مستندات + خطة ودفع، خطوة بخطوة.' : 'Account, documents, then plan and payment -- one step at a time.'}</span>
        </div>
        <button className="seller-primary-button" onClick={startFlow}>
          {isAr ? 'ابدأ الآن' : 'Get started'}
        </button>
      </section>

      <button className="become-host-alt-link" type="button" onClick={() => navigate('/sell')}>
        {config.altLinkLabel[lang]}
      </button>
    </main>
  )
}
