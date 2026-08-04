import { useEffect, useMemo, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchPrototypeAdminMetrics, fetchPrototypeReviewQueue, type PlatformAdminMetrics, type PlatformReviewQueue } from '../../shared/api/platformApi'
import { listingTitleText } from '../../shared/i18n/display'
import { navigate } from '../../app/routes'
import { AdminShell } from './AdminShell'

type Section = 'str' | 'realestate' | 'marketplace' | 'cars' | 'advertising' | 'trust'

const CONFIG: Record<Section, { divisions: string[]; active: string; ar: string; en: string; arSub: string; enSub: string }> = {
  str: { divisions: ['STAYS'], active: 'strControl', ar: 'التحكم في الإيجار القصير', en: 'STR control', arSub: 'الحالة الفعلية لإعلانات وحجوزات الإيجار القصير.', enSub: 'Live status of short-term-rental listings and bookings.' },
  realestate: { divisions: ['BUY', 'RENTALS', 'NEW_CONSTRUCTION'], active: 'realestateControl', ar: 'التحكم في العقارات', en: 'Real estate control', arSub: 'إعلانات البيع والإيجار والمشاريع من قاعدة البيانات.', enSub: 'Sale, rental, and development listings from the database.' },
  marketplace: { divisions: ['MARKETPLACE'], active: 'marketplaceControl', ar: 'التحكم في السوق', en: 'Marketplace control', arSub: 'إعلانات السوق وحالة المراجعة الفعلية.', enSub: 'Marketplace listings and their real review state.' },
  cars: { divisions: ['CARS'], active: 'carsControl', ar: 'التحكم في السيارات', en: 'Cars control', arSub: 'إعلانات السيارات والمزادات التي تنتظر الإدارة.', enSub: 'Car and auction listings awaiting administration.' },
  advertising: { divisions: [], active: 'advertisingControl', ar: 'التحكم في الإعلانات', en: 'Advertising control', arSub: 'لا يوجد سجل إعلانات مخصص في قاعدة البيانات حالياً.', enSub: 'No dedicated advertising record exists in the database yet.' },
  trust: { divisions: [], active: 'trustControl', ar: 'الثقة والتحقق', en: 'Trust and verification', arSub: 'طلبات التحقق الحقيقية التي تنتظر قرار الإدارة.', enSub: 'Real identity-verification requests awaiting an admin decision.' },
}

export function AdminSectionOverviewPage({ lang, section, onLanguageChange }: { lang: Lang; section: Section; onLanguageChange?: (lang: Lang) => void }) {
  const cfg = CONFIG[section]
  const isAr = lang === 'ar'
  const [queue, setQueue] = useState<PlatformReviewQueue | null>(null)
  const [metrics, setMetrics] = useState<PlatformAdminMetrics | null>(null)
  const [error, setError] = useState('')

  const load = () => {
    setError('')
    Promise.all([fetchPrototypeReviewQueue(), fetchPrototypeAdminMetrics()])
      .then(([nextQueue, nextMetrics]) => { setQueue(nextQueue); setMetrics(nextMetrics) })
      .catch((cause) => setError(cause instanceof Error ? cause.message : (isAr ? 'تعذر تحميل البيانات' : 'Could not load data')))
  }
  useEffect(load, [section])

  const listings = useMemo(() => (queue?.listings || []).filter((listing) => cfg.divisions.includes(listing.division)), [cfg.divisions, queue])
  const total = cfg.divisions.reduce((sum, division) => sum + (metrics?.listingsByDivision[division] || 0), 0)
  const pendingBookings = section === 'str' ? (queue?.bookings || []).filter((booking) => booking.listing?.division === 'STAYS') : []
  const verificationCount = section === 'trust' ? queue?.idDocuments.length || 0 : 0

  return (
    <AdminShell lang={lang} active={cfg.active} title={isAr ? cfg.ar : cfg.en} subtitle={isAr ? cfg.arSub : cfg.enSub} onLanguageChange={onLanguageChange} onRefresh={load}>
      {error && <div className="alert">{error}</div>}
      <div className="metrics">
        <article className="metric"><span className="metric-label">{isAr ? 'إجمالي السجلات' : 'Total records'}</span><strong className="metric-value">{section === 'trust' ? verificationCount : total}</strong></article>
        <article className="metric"><span className="metric-label">{isAr ? 'بانتظار المراجعة' : 'Awaiting review'}</span><strong className="metric-value">{section === 'trust' ? verificationCount : listings.length}</strong></article>
        {section === 'str' && <article className="metric"><span className="metric-label">{isAr ? 'حجوزات تنتظر القرار' : 'Bookings awaiting decision'}</span><strong className="metric-value">{pendingBookings.length}</strong></article>}
      </div>
      <article className="card">
        <header className="card-header"><div><h2>{isAr ? 'العناصر المباشرة' : 'Live items'}</h2><p>{isAr ? 'القيم هنا من قاعدة البيانات وليست بيانات تجريبية.' : 'These values come from the database, not sample data.'}</p></div></header>
        <div className="rows">
          {section === 'advertising' ? <div className="empty"><div>{isAr ? 'يلزم إنشاء نموذج إعلانات إداري قبل عرض أرقام حقيقية.' : 'An advertising data model is required before real totals can be shown.'}</div></div>
            : section === 'trust' ? (queue?.idDocuments || []).slice(0, 12).map((doc) => <div className="row" key={doc.id}><div className="identity"><div><strong>{doc.displayName}</strong><small>{doc.email || doc.id}</small></div></div><span className="pill gold">{doc.idDocumentStatus || 'PENDING_REVIEW'}</span></div>)
              : listings.slice(0, 12).map((listing) => <div className="row" key={listing.id}><div className="identity"><div><strong>{listingTitleText(listing, lang)}</strong><small>{listing.division} · {listing.status}</small></div></div><span className="pill gold">{listing.status}</span></div>)}
          {section !== 'advertising' && section !== 'trust' && listings.length === 0 && <div className="empty"><div>{isAr ? 'لا توجد عناصر بانتظار المراجعة.' : 'No items are awaiting review.'}</div></div>}
        </div>
        <button className="card-footer" type="button" onClick={() => navigate('/admin/review')}>{isAr ? 'فتح قائمة المراجعة الكاملة' : 'Open full review queue'}</button>
      </article>
    </AdminShell>
  )
}
