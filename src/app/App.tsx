import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react'
import { findDivisionByRoute, gatedDivisionForPath } from '../engines/navigation/divisions'
import { ClosedBetaDivisionNotice } from '../modules/beta/ClosedBetaDivisionNotice'
import type { Lang } from '../engines/language/languageEngine'
import { getInitialLanguage, persistLanguage, text } from '../engines/language/languageEngine'
import { AppShell } from '../shared/layout/AppShell'
import { isSellerRoute } from '../modules/seller/sellerRoutes'
import { isTrustProtectionRoute } from '../modules/trust/trustRoutes'
import { isGiftFlowRoute } from '../modules/wallet/giftRoutes'
import { getCurrentPath } from './routes'

const AdminReviewPage = lazyNamed(() => import('../modules/admin/AdminReviewPage'), 'AdminReviewPage')
const CapsulePreviewPage = lazyNamed(() => import('../modules/capsules/CapsulePreviewPage'), 'CapsulePreviewPage')
const AiBrainPage = lazyNamed(() => import('../modules/ai/AiBrainPage'), 'AiBrainPage')
const BookingDetailPage = lazyNamed(() => import('../modules/bookings/BookingDetailPage'), 'BookingDetailPage')
const BookingReviewPage = lazyNamed(() => import('../modules/bookings/BookingReviewPage'), 'BookingReviewPage')
const CompetitorsPage = lazyNamed(() => import('../modules/competitors/CompetitorsPage'), 'CompetitorsPage')
const DivisionLivePage = lazyNamed(() => import('../modules/divisions/DivisionLivePage'), 'DivisionLivePage')
const DriverDashboardPage = lazyNamed(() => import('../modules/driver/DriverDashboardPage'), 'DriverDashboardPage')
const DriverVehiclesPage = lazyNamed(() => import('../modules/driver/DriverVehiclesPage'), 'DriverVehiclesPage')
const DriverTaxProfilePage = lazyNamed(() => import('../modules/driver/DriverTaxProfilePage'), 'DriverTaxProfilePage')
const HostTaxProfilePage = lazyNamed(() => import('../modules/host/HostTaxProfilePage'), 'HostTaxProfilePage')
const DisputesPage = lazyNamed(() => import('../modules/disputes/DisputesPage'), 'DisputesPage')
const AdminDisputesPage = lazyNamed(() => import('../modules/disputes/AdminDisputesPage'), 'AdminDisputesPage')
const SettingsPage = lazyNamed(() => import('../modules/account/SettingsPage'), 'SettingsPage')
const AdminReportsPage = lazyNamed(() => import('../modules/safety/AdminReportsPage'), 'AdminReportsPage')
const MarketplaceBrowsePage = lazyNamed(() => import('../modules/marketplace/MarketplaceBrowsePage'), 'MarketplaceBrowsePage')
const MarketplaceSellPage = lazyNamed(() => import('../modules/marketplace/MarketplaceSellPage'), 'MarketplaceSellPage')
const FinanceReconciliationPage = lazyNamed(() => import('../modules/finance/FinanceReconciliationPage'), 'FinanceReconciliationPage')
const GiftFlowRoutes = lazyNamed(() => import('../modules/wallet/GiftFlowRoutes'), 'GiftFlowRoutes')
const HostDashboardPage = lazyNamed(() => import('../modules/host/HostDashboardPage'), 'HostDashboardPage')
const HostEarningsPage = lazyNamed(() => import('../modules/host/HostEarningsPage'), 'HostEarningsPage')
const HostInsightsPanel = lazyNamed(() => import('../modules/host/HostInsightsPanel'), 'HostInsightsPanel')
const HostInquiriesPage = lazyNamed(() => import('../modules/host/HostInquiriesPage'), 'HostInquiriesPage')
const ImmocontactPage = lazyNamed(() => import('../modules/immocontact/ImmocontactPage'), 'ImmocontactPage')
const LandingPage = lazyNamed(() => import('../modules/landing/LandingPage'), 'LandingPage')
const LegalPlaceholderPage = lazyNamed(() => import('../modules/legal/LegalPlaceholderPage'), 'LegalPlaceholderPage')
const ListingDetailPage = lazyNamed(() => import('../modules/listings/ListingDetailPage'), 'ListingDetailPage')
const OperationsCalendarPage = lazyNamed(() => import('../modules/operations/OperationsCalendarPage'), 'OperationsCalendarPage')
const PaymentReceiptPage = lazyNamed(() => import('../modules/payments/PaymentReceiptPage'), 'PaymentReceiptPage')
const PlatformStatusPage = lazyNamed(() => import('../modules/status/PlatformStatusPage'), 'PlatformStatusPage')
const RentalsPage = lazyNamed(() => import('../modules/rentals/RentalsPage'), 'RentalsPage')
const SearchPreviewPage = lazyNamed(() => import('../modules/search/SearchPreviewPage'), 'SearchPreviewPage')
const SellerDivisionRoutes = lazyNamed(() => import('../modules/seller'), 'SellerDivisionRoutes')
const SrRidePage = lazyNamed(() => import('../modules/sr/SrRidePage'), 'SrRidePage')
const StaffAccessPage = lazyNamed(() => import('../modules/account/StaffAccessPage'), 'StaffAccessPage')
const SyrianLocalWalletPaymentPage = lazyNamed(
  () => import('../modules/payments/SyrianLocalWalletPaymentPage'),
  'SyrianLocalWalletPaymentPage',
)
const TripLookupPage = lazyNamed(() => import('../modules/bookings/TripLookupPage'), 'TripLookupPage')
const TrustProtectionRoutes = lazyNamed(() => import('../modules/trust/TrustProtectionRoutes'), 'TrustProtectionRoutes')
const WalletPage = lazyNamed(() => import('../modules/wallet-live/WalletPage'), 'WalletPage')

function lazyNamed<T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
) {
  return lazy(async () => ({ default: (await loader())[exportName] as ComponentType<any> }))
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => getInitialLanguage())
  const [path, setPath] = useState(() => getCurrentPath())
  const [, setAuthVersion] = useState(0)

  useEffect(() => {
    persistLanguage(lang)
  }, [lang])

  useEffect(() => {
    const sync = () => setPath(getCurrentPath())
    const syncAuth = () => setAuthVersion((version) => version + 1)
    window.addEventListener('hashchange', sync)
    window.addEventListener('sybnb-session-changed', syncAuth)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('sybnb-session-changed', syncAuth)
    }
  }, [])

  const division = findDivisionByRoute(path)
  // SYB-008: STR-only closed beta. A direct hash URL into a gated (Soon) division must not render that
  // division's page — the client shows a governed closed-beta notice. The API gate is the authoritative
  // enforcement; this is the navigation/route layer.
  const gatedDivision = gatedDivisionForPath(path)
  const bookingMatch = path.match(/^\/booking\/([^/]+)$/)
  const bookingReviewMatch = path.match(/^\/booking\/review\/([^/]+)$/)
  const listingMatch = path.match(/^\/listing\/([^/]+)$/)
  const paymentReceiptMatch = path.match(/^\/payment\/receipt\/([^/]+)$/)
  const bookingPaymentMatch = path.match(/^\/payment\/local-wallet\/([^/]+)\/(\d+)\/([^/]+)$/)
  const guestAccountMatch = path.match(/^\/account\/open(?:\/([^/]+))?$/)
  const staffRequiredRole = getStaffRequiredRole(path)
  const hasStaffSession = typeof window !== 'undefined' && hasRequiredStaffSession(staffRequiredRole)

  return (
    <AppShell lang={lang} onLanguageChange={setLang} path={path}>
      <Suspense fallback={<RouteLoading lang={lang} />}>
        {staffRequiredRole && !hasStaffSession ? (
          <StaffAccessPage lang={lang} role={staffRequiredRole} returnPath={path} />
        ) : gatedDivision ? (
          <ClosedBetaDivisionNotice lang={lang} title={lang === 'ar' ? gatedDivision.title.ar : gatedDivision.title.en} />
        ) : isGiftFlowRoute(path) ? (
          <GiftFlowRoutes lang={lang} path={path} />
        ) : isTrustProtectionRoute(path) ? (
          <TrustProtectionRoutes lang={lang} path={path} />
        ) : guestAccountMatch ? (
          guestAccountMatch[1] ? <ListingDetailPage listingId={guestAccountMatch[1]} lang={lang} /> : <SearchPreviewPage lang={lang} initialDivision="stays" entry="stays" />
        ) : path === '/dashboard' || path === '/account' ? (
          <LandingPage lang={lang} />
        ) : path === '/host' ||
          path === '/host/seller' ||
          path === '/host/stays' ||
          path === '/host/cars' ||
          path === '/host/new-construction' ||
          path === '/host/marketplace' ? (
          <HostDashboardPage
            lang={lang}
            mode={path === '/host/stays' || path === '/host' ? 'host' : 'seller'}
            focus={hostFocusFromPath(path)}
          />
        ) : path === '/host/earnings' ? (
          <HostEarningsPage lang={lang} />
        ) : path === '/host/insights' ? (
          <HostInsightsPanel lang={lang} />
        ) : path === '/host/inquiries' ? (
          <HostInquiriesPage lang={lang} />
        ) : path === '/driver/vehicles' ? (
          <DriverVehiclesPage lang={lang} />
        ) : path === '/driver/tax-profile' ? (
          <DriverTaxProfilePage lang={lang} />
        ) : path === '/host/tax-profile' ? (
          <HostTaxProfilePage lang={lang} />
        ) : path === '/driver' ? (
          <DriverDashboardPage lang={lang} />
        ) : path === '/immocontact' ? (
          <ImmocontactPage lang={lang} />
        ) : path === '/capsule-preview' ? (
          <CapsulePreviewPage lang={lang} />
        ) : path === '/admin/disputes' ? (
          <AdminDisputesPage lang={lang} />
        ) : path === '/admin/reports' ? (
          <AdminReportsPage lang={lang} />
        ) : path === '/disputes' ? (
          <DisputesPage lang={lang} />
        ) : path === '/settings' ? (
          <SettingsPage lang={lang} />
        ) : path === '/admin/review' ? (
          <AdminReviewPage lang={lang} />
        ) : path === '/ai-brain' ? (
          <AiBrainPage lang={lang} />
        ) : path === '/competitors' ? (
          <CompetitorsPage lang={lang} />
        ) : path === '/operations' ? (
          <OperationsCalendarPage lang={lang} />
        ) : path === '/finance' ? (
          <FinanceReconciliationPage lang={lang} />
        ) : path === '/status' ? (
          <PlatformStatusPage lang={lang} />
        ) : path === '/terms' ? (
          <LegalPlaceholderPage lang={lang} page="terms" />
        ) : path === '/privacy' ? (
          <LegalPlaceholderPage lang={lang} page="privacy" />
        ) : path === '/track' ? (
          <TripLookupPage lang={lang} />
        ) : bookingReviewMatch ? (
          <BookingReviewPage listingId={bookingReviewMatch[1]} lang={lang} />
        ) : bookingMatch ? (
          <BookingDetailPage bookingId={bookingMatch[1]} lang={lang} />
        ) : listingMatch ? (
          <ListingDetailPage listingId={listingMatch[1]} lang={lang} />
        ) : path === '/ride' || path === '/ride-preview' ? (
          <SrRidePage lang={lang} />
        ) : isSellerRoute(path) ? (
          <SellerDivisionRoutes lang={lang} path={path} />
        ) : path === '/search-preview' || path === '/stays' ? (
          <SearchPreviewPage lang={lang} initialDivision="stays" entry={path === '/stays' ? 'stays' : 'general'} />
        ) : path === '/rentals' ? (
          <RentalsPage lang={lang} mode="rentals" />
        ) : path === '/buy' ? (
          <RentalsPage lang={lang} mode="buy" />
        ) : path === '/cars' ? (
          <SearchPreviewPage lang={lang} initialDivision="cars" entry="general" />
        ) : path === '/marketplace/sell' ? (
          <MarketplaceSellPage lang={lang} />
        ) : path === '/marketplace' ? (
          <MarketplaceBrowsePage lang={lang} />
        ) : path === '/new-construction' ? (
          <SearchPreviewPage lang={lang} initialDivision="newConstruction" entry="general" />
        ) : paymentReceiptMatch ? (
          <PaymentReceiptPage lang={lang} proofId={paymentReceiptMatch[1]} />
        ) : bookingPaymentMatch ? (
          <SyrianLocalWalletPaymentPage
            lang={lang}
            bookingId={bookingPaymentMatch[1]}
            amountMinor={Number(bookingPaymentMatch[2])}
            currency={decodeURIComponent(bookingPaymentMatch[3])}
          />
        ) : path === '/wallet' ? (
          <WalletPage lang={lang} />
        ) : division ? (
          <DivisionLivePage division={division} lang={lang} />
        ) : (
          <LandingPage lang={lang} />
        )}
      </Suspense>
    </AppShell>
  )
}

function hostFocusFromPath(path: string): 'stays' | 'cars' | 'newConstruction' | 'marketplace' | undefined {
  if (path === '/host/stays') return 'stays'
  if (path === '/host/cars') return 'cars'
  if (path === '/host/new-construction') return 'newConstruction'
  if (path === '/host/marketplace') return 'marketplace'
  return undefined
}

function getStaffRequiredRole(path: string): 'ADMIN' | 'HOST' | 'DRIVER' | null {
  if (path.startsWith('/host')) return 'HOST'
  if (path.startsWith('/driver')) return 'DRIVER'
  if (
    path.startsWith('/admin') ||
    path.startsWith('/finance') ||
    path.startsWith('/operations') ||
    path.startsWith('/ai-brain') ||
    path.startsWith('/competitors') ||
    path.startsWith('/status')
  ) {
    return 'ADMIN'
  }
  return null
}

function hasRequiredStaffSession(requiredRole: 'ADMIN' | 'HOST' | 'DRIVER' | null) {
  if (!requiredRole) return true
  try {
    // Persistent login: the staff session is stored in localStorage (see platformApi authStorage) so it
    // survives an app restart — read it from the same place, not sessionStorage.
    const raw = localStorage.getItem('sybnb.v6.staffSession')
    if (!raw) return false
    const session = JSON.parse(raw) as { token?: string; user?: { roles?: string[] } }
    const roles = session.user?.roles || []
    if (!session.token) return false
    if (requiredRole === 'HOST') return roles.includes('HOST') || roles.includes('SELLER')
    return roles.includes(requiredRole)
  } catch {
    return false
  }
}

function RouteLoading({ lang }: { lang: Lang }) {
  return (
    <main className="page-shell">
      <section className="panel">
        <p>{text({ ar: 'جاري التحميل...', en: 'Loading...' }, lang)}</p>
      </section>
    </main>
  )
}
