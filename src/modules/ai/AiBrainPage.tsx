import type { Lang } from '../../engines/language/languageEngine'

type Props = {
  lang: Lang
}

const signals = [
  { platform: 'Airbnb', ar: 'استراتيجية تسعير هجومية في المزة', en: 'Aggressive pricing strategy in Mazzeh', statusAr: 'يتطلب إجراء', statusEn: 'Needs action', tone: 'danger', time: '2h' },
  { platform: 'Booking', ar: 'تحديث عمولة', en: 'Commission update', statusAr: 'مراقب', statusEn: 'Watching', tone: 'gold', time: '5h' },
  { platform: 'Guesty', ar: 'تحديث واجهة', en: 'Interface update', statusAr: 'معتمد', statusEn: 'Approved', tone: 'green', time: '1d' },
  { platform: 'Local', ar: 'حملة خصومات', en: 'Discount campaign', statusAr: 'جديد', statusEn: 'New', tone: 'red', time: '45m' },
]

const priceSignals = [
  { ar: 'حي المالكي', en: 'Malki district', demandAr: 'مرتفع الطلب', demandEn: 'High demand', confidence: 94, nightly: '1,240', monthly: '32,000', currency: 'SAR' },
  { ar: 'الخبر الشمالية', en: 'North Khobar', demandAr: 'متوسط الطلب', demandEn: 'Medium demand', confidence: 88, nightly: '850', monthly: '22,500', currency: 'SAR' },
  { ar: 'وسط جدة', en: 'Central Jeddah', demandAr: 'مرتفع الطلب', demandEn: 'High demand', confidence: 91, nightly: '980', monthly: '26,000', currency: 'SAR' },
]

const improvements = [
  { ar: 'فيلا موردن الملقا', en: 'Modern Villa Al Malqa', actionAr: 'أضف صور احترافية', actionEn: 'Add professional photos', lift: '+24%', priorityAr: 'عالية', priorityEn: 'High', tone: 'red' },
  { ar: 'شقة فاخرة النرجس', en: 'Luxury apartment Al Narjis', actionAr: 'شارة الثقة', actionEn: 'Trust badge', lift: '+15%', priorityAr: 'متوسطة', priorityEn: 'Medium', tone: 'gold' },
  { ar: 'استوديو المربع', en: 'Murabba Studio', actionAr: 'تعديل السعر', actionEn: 'Adjust price', lift: '+18%', priorityAr: 'عالية', priorityEn: 'High', tone: 'red' },
  { ar: 'قصر الحمراء', en: 'Al Hamra Palace', actionAr: 'تحسين الوصف', actionEn: 'Improve description', lift: '+12%', priorityAr: 'متوسطة', priorityEn: 'Medium', tone: 'gold' },
]

const roadmap = [
  { score: '9.8', ar: 'نظام دفع متكامل', en: 'Integrated payment system', tagAr: 'ابن التالي', tagEn: 'Build next', state: 'PENDING', tone: 'gold' },
  { score: '8.5', ar: 'تحسين محرك الحجز', en: 'Improve booking engine', tagAr: 'حسّن التالي', tagEn: 'Improve next', state: 'IN PROGRESS', tone: 'green' },
  { score: '7.2', ar: 'تنبيه مخاطر السيولة', en: 'Liquidity risk alert', tagAr: 'تنبيه مخاطر', tagEn: 'Risk alert', state: 'PENDING', tone: 'gold' },
  { score: '6.8', ar: 'توسيع سوق جدة', en: 'Expand Jeddah market', tagAr: 'فرصة السوق', tagEn: 'Market opportunity', state: 'IN PROGRESS', tone: 'green' },
]

export function AiBrainPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const firstSignal = signals[0]
  const firstPrice = priceSignals[0]
  const go = (route: string) => {
    window.location.hash = route
  }

  return (
    <main className="ai-brain-page" dir={isAr ? 'rtl' : 'ltr'}>
      <header className="ai-brain-top">
        <div>
          <span>◉</span>
          <strong>SYBNB AI BRAIN</strong>
          <small>MARKET INTELLIGENCE</small>
        </div>
        <p>{isAr ? 'آخر تحديث:' : 'Last updated:'} <b>2024.05.24 14:02</b></p>
        <button onClick={() => (window.location.hash = '/admin/review')}>{isAr ? 'الإدارة' : 'Admin'}</button>
      </header>

      <section className="ai-brain-grid">
        <aside className="ai-detail-panel">
          <SectionTitle icon="⌘" title={isAr ? 'تفاصيل الإشارة' : 'Signal Detail'} subtitle="SIGNAL DETAIL" />
          <article className="ai-signal-detail-card">
            <div>
              <span className="ai-source">{isAr ? 'المنافسين المتأخرين' : 'Late competitors'}</span>
              <strong>{isAr ? firstSignal.ar : firstSignal.en}</strong>
              <p>{isAr ? 'لاحظت خوارزمية Airbnb انخفاضاً في أسعار منطقة المزة بنسبة 15% خلال الأسبوع الماضي. هذا يهدد حصتك السوقية في فئة الغرف الفاخرة.' : 'Airbnb-style pricing dropped in the area by 15% this week, which may pressure premium inventory.'}</p>
            </div>
            <div className="ai-impact">
              <b>HIGH</b>
              <i />
              <span>{isAr ? 'تأثير SYBNB المتوقع' : 'Expected SYBNB impact'}</span>
            </div>
            <div className="ai-detail-facts">
              <span>{isAr ? 'الحالة' : 'Status'} <b>{isAr ? firstSignal.statusAr : firstSignal.statusEn}</b></span>
              <span>{isAr ? 'الأولوية' : 'Priority'} <b>{isAr ? 'عالية' : 'High'}</b></span>
              <span>{isAr ? 'الفريق المسؤول' : 'Owner team'} <b>{isAr ? 'فريق العمليات' : 'Operations team'}</b></span>
            </div>
            <p className="ai-action-note">AI: {isAr ? 'فعّل التسعير الديناميكي فوراً لتقليل الفجوة السعرية مع المنافسين بمقدار 8%.' : 'Activate dynamic pricing now to reduce the competitor pricing gap by 8%.'}</p>
            <div className="ai-detail-actions">
              <button onClick={() => go('/finance')}>{isAr ? 'الموافقة على الإجراء' : 'Approve action'}</button>
              <button onClick={() => go('/operations')}>{isAr ? 'إنشاء مهمة' : 'Create task'}</button>
              <button onClick={() => go('/competitors')}>{isAr ? 'تجاهل' : 'Ignore'}</button>
            </div>
          </article>
        </aside>

        <section className="ai-roadmap-column">
          <SectionTitle icon="⚑" title={isAr ? 'خارطة التطوير' : 'Platform Roadmap'} subtitle="PLATFORM ROADMAP" />
          {roadmap.map((item) => (
            <article className={`ai-roadmap-card ${item.tone}`} key={item.en}>
              <span>{item.score}</span>
              <div>
                <strong>{isAr ? item.ar : item.en}</strong>
                <small>{item.state}</small>
              </div>
              <b>{isAr ? item.tagAr : item.tagEn}</b>
            </article>
          ))}
        </section>

        <section className="ai-improvements-column">
          <SectionTitle icon="✣" title={isAr ? 'تحسين الإعلانات' : 'Listing Improvements'} subtitle="LISTING IMPROVEMENTS" />
          {improvements.map((item) => (
            <article className="ai-improvement-card" key={item.en}>
              <span className={item.tone}>{isAr ? item.priorityAr : item.priorityEn}</span>
              <div>
                <strong>{isAr ? item.ar : item.en}</strong>
                <small>{isAr ? item.actionAr : item.actionEn}</small>
                <b>{item.lift} {isAr ? 'مشاهدات' : 'views'}</b>
              </div>
              <button onClick={() => go('/host')}>{isAr ? 'تطبيق' : 'Apply'}</button>
            </article>
          ))}
        </section>

        <section className="ai-price-column">
          <SectionTitle icon="♕" title={isAr ? 'ذكاء الأسعار' : 'Price Intelligence'} subtitle="PRICE INTELLIGENCE" />
          {priceSignals.map((item) => (
            <article className="ai-price-card" key={item.en}>
              <div className="ai-confidence"><b>{item.confidence}%</b></div>
              <div>
                <h3>{isAr ? item.ar : item.en}</h3>
                <small>{isAr ? item.demandAr : item.demandEn}</small>
                <p>{isAr ? 'السعر الليلي' : 'Nightly price'} <strong>{item.nightly} {item.currency}</strong></p>
                <p>{isAr ? 'الإيجار الشهري' : 'Monthly rent'} <strong>{item.monthly} {item.currency}</strong></p>
              </div>
              <svg viewBox="0 0 160 44" aria-hidden="true">
                <polyline points="0,34 28,24 58,30 92,16 125,9 160,12" />
              </svg>
            </article>
          ))}
        </section>

        <section className="ai-competitor-column">
          <SectionTitle icon="◉" title={isAr ? 'رصد المنافسين' : 'Competitor Watch'} subtitle="COMPETITOR WATCH" />
          {signals.map((signal) => (
            <article className="ai-competitor-card" key={`${signal.platform}-${signal.en}`}>
              <button aria-label="close" onClick={() => go('/competitors')}>×</button>
              <div>
                <strong>{signal.platform}</strong>
                <span>{isAr ? signal.ar : signal.en}</span>
                <small>{signal.time} ago</small>
              </div>
              <b className={signal.tone}>{isAr ? signal.statusAr : signal.statusEn}</b>
              <i>⌁ ◉</i>
            </article>
          ))}
        </section>
      </section>

      <section className="ai-summary">
        <div>☼</div>
        <h2>{isAr ? 'ملخص اليوم' : 'Today Summary'}</h2>
        <p>{isAr ? 'هناك زيادة ملحوظة بنسبة 12% في الطلب على العقارات الفاخرة في شمال الرياض. نقترح رفع أسعار الوحدات في حي النرجس والملقا فوراً للاستفادة من فجوة العرض لدى المنافسين.' : 'Demand for premium inventory is up 12%. Raise selected prices and create tasks for listings missing trust badges or stronger photos.'}</p>
      </section>

      <section className="ai-panel-previews">
        <PreviewPanel title={isAr ? 'اقتراح السعر الذكي' : 'Smart price suggestion'} value={firstPrice.nightly} />
        <PreviewPanel title={isAr ? 'تحسين القائمة الذكي' : 'Smart listing improvement'} value="+109%" />
        <PreviewPanel title={isAr ? 'لوحة اقتراحات الخارطة' : 'Roadmap suggestions'} value="9.8" />
      </section>
    </main>
  )
}

function SectionTitle({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <header className="ai-section-title">
      <span>{icon}</span>
      <div>
        <h2>{title}</h2>
        <small>{subtitle}</small>
      </div>
    </header>
  )
}

function PreviewPanel({ title, value }: { title: string; value: string }) {
  return (
    <article>
      <button onClick={() => (window.location.hash = '/ai-brain')}>×</button>
      <h2>{title}</h2>
      <strong>{value}</strong>
      <p>AI Brain</p>
    </article>
  )
}
