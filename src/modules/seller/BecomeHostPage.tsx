import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../../shared/brand'
import { SELLER_PLANS } from './sellerData'
import type { CSSVars } from '../../shared/theme/cssVars'

type Props = {
  lang: Lang
}

const ROLE_STORAGE_KEY = 'sybnb_v6_selected_seller_role'
const FLOW_STORAGE_KEY = 'sybnb_v6_sell_flow'

// STR_ADMIN_COMMISSION_RATE mirrors server/lib/finance-ledger.mjs -- if that rate changes,
// update this copy to match (see [[str-commission-source]] pattern used elsewhere in seller UI).
const STR_COMMISSION_LABEL = { ar: '13%', en: '13%' }

const HOST_PERKS = [
  { ar: 'استقبل حجوزات من عملاء حقيقيين داخل سوريا مباشرة.', en: 'Get real bookings from guests across Syria, directly.' },
  { ar: 'الدفع محمي ويُراجع من الإدارة قبل تأكيد كل حجز.', en: 'Payment is protected and admin-reviewed before every booking is confirmed.' },
  { ar: 'تتابع الحجوزات ومداخيلك من لوحة استضافة واحدة.', en: 'Track bookings and earnings from one hosting dashboard.' },
]

export function BecomeHostPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const plus = SELLER_PLANS.find((plan) => plan.id === 'plus') ?? SELLER_PLANS[0]
  const premium = SELLER_PLANS.find((plan) => plan.id === 'premium') ?? SELLER_PLANS[1]

  function startHosting() {
    window.localStorage.setItem(ROLE_STORAGE_KEY, 'owner')
    window.localStorage.setItem(FLOW_STORAGE_KEY, 'listing')
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
            <p className="eyebrow">{isAr ? 'SYBNB / الاستضافة' : 'SYBNB / Hosting'}</p>
            <h1>{isAr ? 'كن مضيفاً مع SYBNB' : 'Become a host with SYBNB'}</h1>
            <p>
              {isAr
                ? 'استضف عقارك للإيجار اليومي واكسب دخلاً إضافياً. تسعير واضح من أول خطوة: خطة نشر ثابتة، وعمولة حجز واحدة بدون رسوم مخفية.'
                : 'List your place for short stays and earn extra income. Clear pricing from step one: a fixed publishing plan, and one booking commission, no hidden fees.'}
            </p>
          </div>
          <div className="seller-logo-panel">
            <BrandLogo logo="plus" size="hero" />
            <span>{isAr ? 'استضافة موثوقة، دفع محمي' : 'Trusted hosting, protected payment'}</span>
          </div>
        </div>
      </section>

      <section className="become-host-perks" aria-label={isAr ? 'مزايا الاستضافة' : 'Hosting perks'}>
        {HOST_PERKS.map((perk) => (
          <div className="become-host-perk" key={perk.en}>
            <span aria-hidden="true">✓</span>
            <p>{perk[lang]}</p>
          </div>
        ))}
      </section>

      <section className="seller-design-note">
        <strong>{isAr ? 'تسعيرك من أول يوم' : 'Your pricing, from day one'}</strong>
        <span>
          {isAr
            ? `تختار خطة نشر ثابتة، وتدفع عمولة ${STR_COMMISSION_LABEL.ar} فقط من قيمة الإيجار عند كل حجز مكتمل -- لا رسوم إضافية مفاجئة.`
            : `Pick a fixed publishing plan, and pay just ${STR_COMMISSION_LABEL.en} commission on the rent amount for every completed booking -- no surprise fees later.`}
        </span>
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
          <strong>{isAr ? 'ابدأ إعداد حسابك كمضيف' : 'Start setting up your host account'}</strong>
          <span>{isAr ? 'حساب + مستندات + خطة ودفع، خطوة بخطوة.' : 'Account, documents, then plan and payment -- one step at a time.'}</span>
        </div>
        <button className="seller-primary-button" onClick={startHosting}>
          {isAr ? 'ابدأ الآن' : 'Get started'}
        </button>
      </section>

      <button className="become-host-alt-link" type="button" onClick={() => navigate('/sell')}>
        {isAr ? 'تريد بيع عقار أو سيارة أو منتج بدلاً من ذلك؟' : 'Want to sell a property, car, or product instead?'}
      </button>
    </main>
  )
}
