import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'

type Props = {
  lang: Lang
  offerLabel: Record<Lang, string>
  offerHref: string
}

// Every division on the platform follows the same three-part structure as its reference model
// (Uber: rider demand / driver offer -- Airbnb/Booking: guest demand / host offer -- Centris:
// buyer-tenant demand / seller-landlord offer -- CarGurus: buyer demand / seller offer): a demand
// side (this page, searching/booking), an offer side (the seller/host/driver entry hook), and an
// admin side (review queue). This strip makes all three visible together instead of the offer
// side being buried in a banner further down the page.
export function DivisionTriad({ lang, offerLabel, offerHref }: Props) {
  const isAr = lang === 'ar'
  return (
    <nav className="division-triad" aria-label={isAr ? 'أقسام هذا القسم' : 'Sections for this division'}>
      <span className="division-triad-item active">{isAr ? 'ابحث واحجز' : 'Search & book'}</span>
      <button type="button" className="division-triad-item" onClick={() => navigate(offerHref)}>
        {offerLabel[lang]}
      </button>
      <button type="button" className="division-triad-item" onClick={() => navigate('/admin/review')}>
        {isAr ? 'لوحة الإدارة' : 'Admin review'}
      </button>
    </nav>
  )
}
