import type { Lang } from '../../engines/language/languageEngine'
import type { PlatformListing } from '../api/platformApi'

export const statusLabels: Record<Lang, Record<string, string>> = {
  ar: {
    ACTIVE: 'نشط',
    APPROVED: 'مقبول',
    CANCELLED: 'ملغى',
    CLAIM_PENDING: 'بانتظار المراجعة',
    CLAIMED: 'مستلمة',
    COMPLETED: 'مكتملة',
    CONFIRMED: 'مؤكد',
    CREDIT: 'إضافة رصيد',
    CREATED: 'تم الإنشاء',
    DEBIT: 'خصم رصيد',
    DRAFT: 'مسودة',
    DRIVER_ARRIVING: 'السائق في الطريق',
    DRIVER_ASSIGNED: 'تم تعيين السائق',
    DISPUTED: 'قيد النزاع',
    EXPIRED: 'منتهي الصلاحية',
    IN_PROGRESS: 'قيد التنفيذ',
    LOCKED: 'مقفلة',
    MATCHING: 'جاري البحث',
    PAUSED: 'متوقف',
    PAYMENT_APPROVED: 'الدفع مقبول',
    PAYMENT_PENDING: 'بانتظار إثبات الدفع',
    PENDING_ADMIN_REVIEW: 'بانتظار مراجعة فريق SYBNB',
    PENDING_PROOF: 'بانتظار الإثبات',
    PENDING_REVIEW: 'قيد المراجعة',
    RELEASE: 'تحرير رصيد',
    REFUNDED: 'مسترد',
    REJECTED: 'مرفوض',
    REQUESTED: 'تم إرسال الطلب',
    SENT: 'مرسلة',
  },
  en: {
    ACTIVE: 'Active',
    APPROVED: 'Approved',
    CANCELLED: 'Cancelled',
    CLAIM_PENDING: 'Pending review',
    CLAIMED: 'Claimed',
    COMPLETED: 'Completed',
    CONFIRMED: 'Confirmed',
    CREDIT: 'Credit',
    CREATED: 'Created',
    DEBIT: 'Debit',
    DRAFT: 'Draft',
    DRIVER_ARRIVING: 'Driver arriving',
    DRIVER_ASSIGNED: 'Driver assigned',
    DISPUTED: 'Disputed',
    EXPIRED: 'Expired',
    IN_PROGRESS: 'In progress',
    LOCKED: 'Locked',
    MATCHING: 'Matching',
    PAUSED: 'Paused',
    PAYMENT_APPROVED: 'Payment approved',
    PAYMENT_PENDING: 'Awaiting payment proof',
    PENDING_ADMIN_REVIEW: 'Pending SYBNB review',
    PENDING_PROOF: 'Pending proof',
    PENDING_REVIEW: 'Pending review',
    RELEASE: 'Release',
    REFUNDED: 'Refunded',
    REJECTED: 'Rejected',
    REQUESTED: 'Requested',
    SENT: 'Sent',
  },
  fr: {
    ACTIVE: 'Actif',
    APPROVED: 'Approuvé',
    CANCELLED: 'Annulé',
    CLAIM_PENDING: 'En attente de vérification',
    CLAIMED: 'Réclamé',
    COMPLETED: 'Terminé',
    CONFIRMED: 'Confirmé',
    CREDIT: 'Crédit',
    CREATED: 'Créé',
    DEBIT: 'Débit',
    DRAFT: 'Brouillon',
    DRIVER_ARRIVING: 'Chauffeur en approche',
    DRIVER_ASSIGNED: 'Chauffeur assigné',
    DISPUTED: 'Litige en cours',
    EXPIRED: 'Expiré',
    IN_PROGRESS: 'En cours',
    LOCKED: 'Verrouillé',
    MATCHING: 'Recherche en cours',
    PAUSED: 'En pause',
    PAYMENT_APPROVED: 'Paiement approuvé',
    PAYMENT_PENDING: 'Justificatif de paiement attendu',
    PENDING_ADMIN_REVIEW: 'En attente de vérification SYBNB',
    PENDING_PROOF: 'Justificatif en attente',
    PENDING_REVIEW: 'En attente de vérification',
    RELEASE: 'Déblocage',
    REFUNDED: 'Remboursé',
    REJECTED: 'Refusé',
    REQUESTED: 'Demande envoyée',
    SENT: 'Envoyé',
  },
}

export const divisionLabels: Record<Lang, Record<string, string>> = {
  ar: {
    STAYS: 'الإيجار اليومي',
    RENTALS: 'الإيجار الشهري',
    BUY: 'شراء عقار',
    CARS: 'السيارات',
    MARKETPLACE: 'السوق',
    NEW_CONSTRUCTION: 'مشاريع جديدة',
  },
  en: {
    STAYS: 'Daily stays',
    RENTALS: 'Monthly rentals',
    BUY: 'Buy property',
    CARS: 'Cars',
    MARKETPLACE: 'Marketplace',
    NEW_CONSTRUCTION: 'New construction',
  },
  fr: {
    STAYS: 'Séjours courts',
    RENTALS: 'Locations mensuelles',
    BUY: 'Acheter un bien',
    CARS: 'Véhicules',
    MARKETPLACE: 'Marché',
    NEW_CONSTRUCTION: 'Nouveaux projets',
  },
}

export const divisionDescriptions: Record<string, Record<Lang, string>> = {
  STAYS: {
    ar: 'ابحث بالتاريخ والضيوف ثم أرسل طلب الحجز.',
    en: 'Search by dates and guests, then request a stay.',
    fr: 'Recherchez par dates et voyageurs, puis envoyez une demande de réservation.',
  },
  RENTALS: {
    ar: 'خيارات حسب المدينة، الميزانية، والغرف.',
    en: 'Filter by city, budget, and bedrooms.',
    fr: 'Filtrez par ville, budget et nombre de chambres.',
  },
  BUY: {
    ar: 'شاهد العقارات، أرسل عرضاً، أو احجز زيارة.',
    en: 'View properties, make an offer, or request a visit.',
    fr: 'Consultez les biens, faites une offre ou demandez une visite.',
  },
  CARS: {
    ar: 'ابحث عن السيارة، تحقق من التفاصيل، وتواصل مع البائع.',
    en: 'Find a car, inspect details, and contact the seller.',
    fr: 'Trouvez une voiture, vérifiez les détails et contactez le vendeur.',
  },
  MARKETPLACE: {
    ar: 'تصفح المنتجات وتواصل مع البائع بعد إنشاء حساب.',
    en: 'Browse items and contact sellers after account.',
    fr: 'Parcourez les articles et contactez les vendeurs après création d’un compte.',
  },
  NEW_CONSTRUCTION: {
    ar: 'شاهد المشروع على أقسام: الأسلوب، المخططات، الطوابق، التشطيب، والدفع.',
    en: 'View projects by sections: style, plans, floors, finishing, and terms.',
    fr: 'Explorez les projets par sections : style, plans, étages, finitions et conditions.',
  },
}

export function hasArabic(value = '') {
  return /[\u0600-\u06ff]/.test(value)
}

export function statusText(status: string | null | undefined, lang: Lang) {
  if (!status) return '-'
  return statusLabels[lang][status] || status.replace(/_/g, ' ')
}

export function divisionText(division: string | null | undefined, lang: Lang) {
  if (!division) return '-'
  return divisionLabels[lang][division] || division.replace(/_/g, ' ')
}

const MONEY_LOCALE_BY_LANG: Record<Lang, string> = { ar: 'ar-SY', en: 'en-US', fr: 'fr-CA' }

export function moneyText(amountMinor: number | null | undefined, currency = 'SYP', lang: Lang) {
  const amount = Number(amountMinor || 0).toLocaleString(MONEY_LOCALE_BY_LANG[lang])
  const currencyText = lang === 'ar' && currency === 'SYP' ? 'ل.س' : currency
  return `${amount} ${currencyText}`
}

export function listingTitleText(
  listing: Pick<PlatformListing, 'id' | 'division' | 'titleAr' | 'titleEn'>,
  lang: Lang,
) {
  if (lang === 'en') return listing.titleEn || listing.titleAr
  if (hasArabic(listing.titleAr)) return listing.titleAr
  return `${divisionText(listing.division, lang)} ${listing.id.slice(0, 8).toUpperCase()}`
}

export function listingDescriptionText(
  listing: Pick<PlatformListing, 'division' | 'description'>,
  lang: Lang,
) {
  if (lang === 'en') return listing.description || divisionDescriptions[listing.division]?.[lang] || ''
  if (listing.description && hasArabic(listing.description)) return listing.description
  return divisionDescriptions[listing.division]?.[lang] || ''
}

export function providerText(provider: string | null | undefined, lang: Lang) {
  if (!provider) return '-'
  if (provider === 'syrian_local_wallet') {
    if (lang === 'ar') return 'المحفظة المحلية السورية'
    if (lang === 'fr') return 'Portefeuille local syrien'
  }
  return provider.replace(/_/g, ' ')
}
