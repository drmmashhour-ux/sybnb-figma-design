import type { Lang } from '../../engines/language/languageEngine'

type Props = {
  lang: Lang
}

const rows = [
  {
    area: { ar: 'المستخدم الأساسي', en: 'Main user' },
    airbnb: { ar: 'ضيف + مضيف', en: 'Guest + host' },
    booking: { ar: 'ضيف + فندق/عقار', en: 'Guest + hotel/property' },
    guesty: { ar: 'مدير عقارات + مضيف', en: 'Property manager + host' },
    sybnb: { ar: 'ضيف + مضيف + إدارة + سائق + بائع', en: 'Guest + host + admin + driver + seller' },
  },
  {
    area: { ar: 'هدف المنصة', en: 'Platform purpose' },
    airbnb: { ar: 'حجز الإقامات والتجارب', en: 'Book stays and experiences' },
    booking: { ar: 'مقارنة وحجز الإقامات', en: 'Compare and reserve stays' },
    guesty: { ar: 'تشغيل وإدارة أعمال الإيجار', en: 'Operate rental businesses' },
    sybnb: { ar: 'سوق + تشغيل + مدفوعات + تواصل', en: 'Marketplace + operations + payments + contact' },
  },
  {
    area: { ar: 'بحث العميل', en: 'Guest search' },
    airbnb: { ar: 'المكان / التاريخ / الضيوف', en: 'Where / when / who' },
    booking: { ar: 'الوجهة / التاريخ / الضيوف والغرف', en: 'Destination / dates / guests and rooms' },
    guesty: { ar: 'ليس موجهاً للبحث العام', en: 'Not public-search first' },
    sybnb: { ar: 'المكان / التقويم / الضيوف ثم فلاتر مصورة', en: 'Place / calendar / guests, then photo filters' },
  },
  {
    area: { ar: 'التقويم', en: 'Calendar' },
    airbnb: { ar: 'تقويم حجز بسيط', en: 'Simple booking calendar' },
    booking: { ar: 'تقويم توفر وسعر', en: 'Availability and price calendar' },
    guesty: { ar: 'تقويم موحد متعدد القنوات', en: 'Multi-channel calendar' },
    sybnb: { ar: 'تقويم يومي للعميل + نحتاج تقويم عمليات', en: 'Daily guest calendar + operations calendar needed' },
  },
  {
    area: { ar: 'خيارات البحث', en: 'Filters' },
    airbnb: { ar: 'بسيطة ومرئية', en: 'Simple and visual' },
    booking: { ar: 'عملية وكثيفة', en: 'Practical and dense' },
    guesty: { ar: 'إدارية وتشغيلية', en: 'Operational/admin filters' },
    sybnb: { ar: 'صور لمس حسب القسم', en: 'Touch photo filters by division' },
  },
  {
    area: { ar: 'بطاقات النتائج', en: 'Result cards' },
    airbnb: { ar: 'صورة أولاً وتجربة ناعمة', en: 'Photo-first and calm' },
    booking: { ar: 'كثيفة مع سعر وتقييم', en: 'Dense with price and rating' },
    guesty: { ar: 'ليست محور المنتج', en: 'Not the core surface' },
    sybnb: { ar: 'صورة + سعر + حالة + حجز/تفاصيل', en: 'Photo + price + status + book/details' },
  },
  {
    area: { ar: 'الخريطة والموقع', en: 'Map and location' },
    airbnb: { ar: 'خريطة قوية مع أحياء ونطاق سعر', en: 'Strong map with neighborhoods and price ranges' },
    booking: { ar: 'خريطة عملية بجانب النتائج', en: 'Practical map beside results' },
    guesty: { ar: 'حسب موقع الحجز المباشر', en: 'Depends on the direct booking site' },
    sybnb: { ar: 'نحتاج خريطة بحث وخرائط تشغيل للزيارات والرحلات', en: 'Need search map plus operations maps for visits and rides' },
  },
  {
    area: { ar: 'التقييمات والمراجعات', en: 'Reviews and ratings' },
    airbnb: { ar: 'تقييم ضيف ومضيف بعد الإقامة', en: 'Guest and host reviews after stays' },
    booking: { ar: 'تقييمات ضيوف موثقة بعد الحجز', en: 'Verified guest reviews after booking' },
    guesty: { ar: 'إدارة مراجعات عبر القنوات', en: 'Review management across channels' },
    sybnb: { ar: 'نحتاج تقييم ضيف/مضيف/سائق مع مراجعة الإدارة', en: 'Need guest, host, and driver ratings with admin moderation' },
  },
  {
    area: { ar: 'التحقق والثقة', en: 'Verification and trust' },
    airbnb: { ar: 'هوية، مضيفين موثقين، حماية منصة', en: 'Identity, trusted hosts, platform protection' },
    booking: { ar: 'تأكيد حجز رسمي ومكان إقامة موثّق', en: 'Official confirmation and verified property flow' },
    guesty: { ar: 'تحقق ضيوف وحماية أضرار حسب التكامل', en: 'Guest verification and damage protection by integration' },
    sybnb: { ar: 'نحتاج KYC، شارات ثقة، QR، وتحذير لا تدفع خارج المنصة', en: 'Need KYC, trust badges, QR, and do-not-pay-outside warning' },
  },
  {
    area: { ar: 'الإلغاء والاسترداد', en: 'Cancellation and refunds' },
    airbnb: { ar: 'سياسات إلغاء واضحة حسب المضيف', en: 'Clear cancellation policies by host' },
    booking: { ar: 'سياسات مجانية/غير مستردة حسب العرض', en: 'Free/non-refundable policies by rate' },
    guesty: { ar: 'قواعد آلية للحجز المباشر والقنوات', en: 'Automated rules for direct and channel bookings' },
    sybnb: { ar: 'نحتاج محرك استرداد ونزاع مرتبط بالإدارة والمحفظة', en: 'Need refund and dispute engine tied to admin and wallet' },
  },
  {
    area: { ar: 'المدفوعات والتحويلات', en: 'Payments and payouts' },
    airbnb: { ar: 'تحصيل من الضيف وتحويل للمضيف', en: 'Guest collection and host payouts' },
    booking: { ar: 'دفع عبر المنصة أو في العقار حسب السياسة', en: 'Platform or property payment depending on policy' },
    guesty: { ar: 'بوابات دفع ومحاسبة للمشغلين', en: 'Payment gateways and accounting for operators' },
    sybnb: { ar: 'محفظة محلية وإثبات دفع؛ نحتاج جدول تحويلات للمالكين', en: 'Local wallet and proof upload; need owner payout schedule' },
  },
  {
    area: { ar: 'التسعير والعمولة', en: 'Pricing and commission' },
    airbnb: { ar: 'رسوم خدمة وتسعير ذكي للمضيف', en: 'Service fees and smart pricing for hosts' },
    booking: { ar: 'عمولة شريك وعروض وتسعير ديناميكي', en: 'Partner commission, deals, and dynamic pricing' },
    guesty: { ar: 'تسعير وإيرادات عبر أدوات وتكاملات', en: 'Pricing and revenue tools through integrations' },
    sybnb: { ar: 'نحتاج لوحة عمولة وسعر مقترح حسب المنطقة والطلب', en: 'Need commission board and suggested price by area and demand' },
  },
  {
    area: { ar: 'التواصل', en: 'Communication' },
    airbnb: { ar: 'رسائل داخل المنصة', en: 'In-platform messages' },
    booking: { ar: 'رسائل الحجز', en: 'Booking messages' },
    guesty: { ar: 'صندوق موحد لكل القنوات', en: 'Unified inbox across channels' },
    sybnb: { ar: 'IMMOContact موجود ونحتاج توسيعه', en: 'IMMOContact exists and should expand' },
  },
  {
    area: { ar: 'لوحات الإدارة', en: 'Admin dashboards' },
    airbnb: { ar: 'لوحة مضيف أساسية', en: 'Basic host dashboard' },
    booking: { ar: 'Partner extranet', en: 'Partner extranet' },
    guesty: { ar: 'PMS قوي مع تقارير', en: 'Strong PMS with reports' },
    sybnb: { ar: 'لوحة إدارة + مضيف + بائع', en: 'Admin + host + seller dashboards' },
  },
  {
    area: { ar: 'العمليات', en: 'Operations' },
    airbnb: { ar: 'محدودة', en: 'Limited' },
    booking: { ar: 'تشغيل شركاء', en: 'Partner operations' },
    guesty: { ar: 'مهام، تنظيف، صيانة، أتمتة', en: 'Tasks, cleaning, maintenance, automation' },
    sybnb: { ar: 'نحتاج مهام وصيانة وتقويم عمليات', en: 'Need tasks, maintenance, operations calendar' },
  },
  {
    area: { ar: 'التقارير والتحليلات', en: 'Reports and analytics' },
    airbnb: { ar: 'إحصاءات أداء للمضيف', en: 'Host performance insights' },
    booking: { ar: 'تقارير شريك ومؤشرات طلب', en: 'Partner reports and demand insights' },
    guesty: { ar: 'تقارير تشغيل وإيرادات قوية', en: 'Strong operations and revenue reports' },
    sybnb: { ar: 'نحتاج تقارير مبيعات، حجوزات، دفع، وسائقين للإدارة', en: 'Need sales, booking, payment, and driver reports for admin' },
  },
  {
    area: { ar: 'تجربة الموبايل والتابلت', en: 'Mobile and tablet experience' },
    airbnb: { ar: 'تجربة موبايل ممتازة للضيف', en: 'Excellent mobile guest experience' },
    booking: { ar: 'موبايل سريع وكثيف للبحث والحجز', en: 'Fast dense mobile search and booking' },
    guesty: { ar: 'لوحات تشغيل للمديرين والفرق', en: 'Operations dashboards for managers and teams' },
    sybnb: { ar: 'نحو تابلت/لمس للعملاء المهمين والإدارة والتسويق', en: 'Moving toward tablet/touch for VIP clients, admin, and marketing' },
  },
  {
    area: { ar: 'التعدد اللغوي والمحلي', en: 'Language and local market' },
    airbnb: { ar: 'عالمي متعدد اللغات', en: 'Global multi-language product' },
    booking: { ar: 'عالمي مع لغات وأسواق كثيرة', en: 'Global with many languages and markets' },
    guesty: { ar: 'موجه للمشغلين عالمياً', en: 'Global operator-focused product' },
    sybnb: { ar: 'عربي/إنجليزي + دفع محلي + سوق سوريا', en: 'Arabic/English + local payment + Syria market focus' },
  },
  {
    area: { ar: 'الذكاء الاصطناعي', en: 'AI' },
    airbnb: { ar: 'توصيات مخفية', en: 'Mostly hidden recommendations' },
    booking: { ar: 'مساعد تخطيط/بحث', en: 'Trip/search assistant' },
    guesty: { ar: 'وكلاء AI للتشغيل والتسعير والرسائل', en: 'AI agents for ops, pricing, messages' },
    sybnb: { ar: 'SYBNB Brain للفلاتر، الإدارة، والمراجعة', en: 'SYBNB Brain for filters, admin, review' },
  },
]

const gaps = [
  { ar: 'تقويم عمليات موحد للحجوزات، المدفوعات، الصيانة، والرحلات.', en: 'Unified operations calendar for bookings, payments, maintenance, and rides.' },
  { ar: 'صندوق رسائل موحد لكل العميل/المضيف/البائع/السائق/الإدارة.', en: 'Unified inbox for guest, host, seller, driver, and admin.' },
  { ar: 'نظام مهام للتنظيف، الصيانة، مراجعة الوثائق، ومراجعة الدفع.', en: 'Task system for cleaning, maintenance, document review, and payment review.' },
  { ar: 'بوابة مالك تعرض الإيراد، الحجوزات، الحالة، والمدفوعات.', en: 'Owner portal for revenue, bookings, status, and payouts.' },
  { ar: 'محرك تسعير واقتراحات حسب المنطقة والموسم والطلب.', en: 'Pricing suggestion engine by area, season, and demand.' },
]

const marketSignals = [
  { ar: 'منافس جديد في السوق', en: 'New competitor in the market' },
  { ar: 'ميزة جديدة عند Airbnb أو Booking أو Guesty', en: 'New feature from Airbnb, Booking, or Guesty' },
  { ar: 'تغيير في التسعير أو العمولة', en: 'Pricing or commission changes' },
  { ar: 'اتجاه جديد في الحجز أو الإدارة أو الذكاء الاصطناعي', en: 'New trend in booking, operations, or AI' },
]

const bookingClickRows = [
  {
    step: { ar: 'بعد ضغط الحجز', en: 'After clicking book' },
    airbnb: { ar: 'يفتح تأكيد الحجز مع التواريخ والضيوف والسعر.', en: 'Opens reservation confirmation with dates, guests, and price.' },
    booking: { ar: 'ينتقل إلى اختيار الغرفة/الخيار ثم إدخال بيانات الضيف.', en: 'Moves to room/rate choice, then guest details.' },
    guesty: { ar: 'غالباً حجز مباشر من موقع المالك مع قواعده الخاصة.', en: 'Usually direct booking from the owner brand site with its rules.' },
    sybnb: { ar: 'ينشئ طلب حجز ثم يفتح الدفع/الإيصال/مراجعة الإدارة.', en: 'Creates booking request, then opens payment/receipt/admin review.' },
  },
  {
    step: { ar: 'السعر والرسوم', en: 'Price and fees' },
    airbnb: { ar: 'يعرض السعر، الرسوم، الضرائب، وسياسة الإلغاء.', en: 'Shows price, fees, taxes, and cancellation policy.' },
    booking: { ar: 'يعرض السعر النهائي، الضرائب، شروط الدفع والإلغاء.', en: 'Shows final price, taxes, payment and cancellation terms.' },
    guesty: { ar: 'حسب محرك الحجز المباشر: سعر، وديعة، رسوم تنظيف.', en: 'Depends on direct engine: rate, deposit, cleaning fees.' },
    sybnb: { ar: 'نحتاج تفصيل أوضح: سعر، رسوم منصة، دفع محلي، حالة الموافقة.', en: 'Need clearer breakdown: price, platform fee, local payment, approval state.' },
  },
  {
    step: { ar: 'الدفع', en: 'Payment' },
    airbnb: { ar: 'دفع فوري أو خطط دفع/ادفع لاحقاً في بعض الحالات.', en: 'Immediate payment or pay-later/payment plans in some cases.' },
    booking: { ar: 'الدفع عبر المنصة أو لدى مكان الإقامة حسب السياسة.', en: 'Payment through platform or at property depending on policy.' },
    guesty: { ar: 'يدعم بوابات دفع وحلول مالية لصاحب العقار.', en: 'Supports payment gateways and financial tools for operators.' },
    sybnb: { ar: 'محفظة/إثبات دفع محلي ثم موافقة الإدارة قبل التأكيد.', en: 'Local wallet/proof upload, then admin approval before confirmation.' },
  },
  {
    step: { ar: 'الثقة والأمان', en: 'Trust and safety' },
    airbnb: { ar: 'سياسة إلغاء، مضيف موثق، تقييمات، حماية المنصة.', en: 'Cancellation policy, host trust, reviews, platform protection.' },
    booking: { ar: 'تأكيد رسمي، رسائل داخلية، وتحذير من روابط خارجية.', en: 'Official confirmation, in-platform messages, avoid outside links.' },
    guesty: { ar: 'تحقق ضيف، حماية ضرر، أتمتة رسائل ومراجعات.', en: 'Guest verification, damage protection, messaging/review automation.' },
    sybnb: { ar: 'نحتاج شاشة ثقة عند الدفع: لا تدفع خارج SYBNB، رقم مراجعة، QR.', en: 'Need trust screen at payment: do not pay outside SYBNB, review ID, QR.' },
  },
  {
    step: { ar: 'بعد التأكيد', en: 'After confirmation' },
    airbnb: { ar: 'رحلة في الحساب، رسائل المضيف، تعليمات الوصول.', en: 'Trip in account, host messages, arrival instructions.' },
    booking: { ar: 'تأكيد/PIN، رسائل مكان الإقامة، إدارة الحجز.', en: 'Confirmation/PIN, property messages, manage booking.' },
    guesty: { ar: 'تطبيق/بوابة ضيف، رسائل تلقائية، مهام تشغيلية.', en: 'Guest app/portal, automated messages, operational tasks.' },
    sybnb: { ar: 'لوحة الحجز، إيصال الدفع، IMMOContact، وتقويم العمليات.', en: 'Booking dashboard, payment receipt, IMMOContact, operations calendar.' },
  },
]

export function CompetitorsPage({ lang }: Props) {
  const isAr = lang === 'ar'

  return (
    <main className="competitors-page" dir={isAr ? 'rtl' : 'ltr'}>
      <section className="competitors-hero">
        <p>{isAr ? 'تقييم السوق' : 'Market evaluation'}</p>
        <h1>{isAr ? 'المنافسين وموقع SYBNB' : 'Competitors and SYBNB Position'}</h1>
        <span>
          {isAr
            ? 'نقارن ما يراه العميل وما يستخدمه المضيف والإدارة حتى نعرف أين نقف وما الذي نبنيه لاحقاً.'
            : 'We compare what guests see and what hosts/admins operate so we know where we stand and what to build next.'}
        </span>
      </section>

      <section className="competitors-table-card">
        <div className="competitors-table">
          <div className="competitors-row competitors-head">
            <strong>{isAr ? 'المجال' : 'Area'}</strong>
            <strong>Airbnb</strong>
            <strong>Booking</strong>
            <strong>Guesty</strong>
            <strong>SYBNB V6</strong>
          </div>
          {rows.map((row) => (
            <div className="competitors-row" key={row.area.en}>
              <strong>{row.area[lang]}</strong>
              <span>{row.airbnb[lang]}</span>
              <span>{row.booking[lang]}</span>
              <span>{row.guesty[lang]}</span>
              <span className="sybnb-cell">{row.sybnb[lang]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="competitors-gaps">
        <h2>{isAr ? 'قائمة ما ينقصنا حالياً' : 'Current Missing Pieces'}</h2>
        <div>
          {gaps.map((gap, index) => (
            <article key={gap.en}>
              <strong>{String(index + 1).padStart(2, '0')}</strong>
              <p>{gap[lang]}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="competitors-booking-flow">
        <div className="competitors-card-title">
          <p>{isAr ? 'تجربة العميل بعد الحجز' : 'Client Experience After Booking Click'}</p>
          <h2>{isAr ? 'ماذا يرى العميل عند الضغط على حجز؟' : 'What does the client see after clicking book?'}</h2>
        </div>
        <div className="competitors-table-card compact">
          <div className="competitors-table booking-flow-table">
            <div className="competitors-row competitors-head">
              <strong>{isAr ? 'المرحلة' : 'Step'}</strong>
              <strong>Airbnb</strong>
              <strong>Booking</strong>
              <strong>Guesty</strong>
              <strong>SYBNB V6</strong>
            </div>
            {bookingClickRows.map((row) => (
              <div className="competitors-row" key={row.step.en}>
                <strong>{row.step[lang]}</strong>
                <span>{row.airbnb[lang]}</span>
                <span>{row.booking[lang]}</span>
                <span>{row.guesty[lang]}</span>
                <span className="sybnb-cell">{row.sybnb[lang]}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="competitors-brain">
        <div>
          <p>{isAr ? 'SYBNB Brain' : 'SYBNB Brain'}</p>
          <h2>{isAr ? 'مراقبة السوق والمنافسين' : 'Market and Competitor Watch'}</h2>
          <span>
            {isAr
              ? 'نربط هذا القسم لاحقاً مع AI Brain حتى يحدّثنا عندما تظهر منصة جديدة، ميزة جديدة، أو فجوة يجب أن نبنيها.'
              : 'Later, this section can connect to AI Brain so it updates us when a new platform, feature, or gap appears.'}
          </span>
        </div>
        <div className="brain-signal-grid">
          {marketSignals.map((signal) => (
            <article key={signal.en}>
              <strong>AI</strong>
              <span>{signal[lang]}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
