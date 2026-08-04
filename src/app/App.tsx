import { Suspense, lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { findDivisionByRoute } from '../engines/navigation/divisions'
import type { Lang } from '../engines/language/languageEngine'
import { getInitialLanguage, persistLanguage, text } from '../engines/language/languageEngine'
import { AppShell } from '../shared/layout/AppShell'
import { isSellerRoute } from '../modules/seller/sellerRoutes'
import { isTrustProtectionRoute } from '../modules/trust/trustRoutes'
import { isGiftFlowRoute } from '../modules/wallet/giftRoutes'
import { getCurrentPath } from './routes'
import { AdminShell } from '../modules/admin/AdminShell'
import { getStoredSellerSession } from '../shared/api/platformApi'

const AdminReviewPage = lazyNamed(() => import('../modules/admin/AdminReviewPage'), 'AdminReviewPage')
const AdminControlCenterPage = lazyNamed(() => import('../modules/admin/AdminControlCenterPage'), 'AdminControlCenterPage')
const AdminOfficeDashboardPage = lazyNamed(() => import('../modules/admin/AdminOfficeDashboardPage'), 'AdminOfficeDashboardPage')
const AdminSrDispatchPage = lazyNamed(() => import('../modules/admin/AdminSrDispatchPage'), 'AdminSrDispatchPage')
const AdminSectionOverviewPage = lazyNamed(() => import('../modules/admin/AdminSectionOverviewPage'), 'AdminSectionOverviewPage')
const AiBrainPage = lazyNamed(() => import('../modules/ai/AiBrainPage'), 'AiBrainPage')
const BookingDetailPage = lazyNamed(() => import('../modules/bookings/BookingDetailPage'), 'BookingDetailPage')
const BookingReviewPage = lazyNamed(() => import('../modules/bookings/BookingReviewPage'), 'BookingReviewPage')
const CompetitorsPage = lazyNamed(() => import('../modules/competitors/CompetitorsPage'), 'CompetitorsPage')
const DashboardPage = lazyNamed(() => import('../modules/dashboard/DashboardPage'), 'DashboardPage')
const DivisionLivePage = lazyNamed(() => import('../modules/divisions/DivisionLivePage'), 'DivisionLivePage')
const DriverDashboardPage = lazyNamed(() => import('../modules/driver/DriverDashboardPage'), 'DriverDashboardPage')
const DriverVehiclesPage = lazyNamed(() => import('../modules/driver/DriverVehiclesPage'), 'DriverVehiclesPage')
const DisputesPage = lazyNamed(() => import('../modules/disputes/DisputesPage'), 'DisputesPage')
const AdminDisputesPage = lazyNamed(() => import('../modules/disputes/AdminDisputesPage'), 'AdminDisputesPage')
const SettingsPage = lazyNamed(() => import('../modules/account/SettingsPage'), 'SettingsPage')
const AdminReportsPage = lazyNamed(() => import('../modules/safety/AdminReportsPage'), 'AdminReportsPage')
const MarketplaceBrowsePage = lazyNamed(() => import('../modules/marketplace/MarketplaceBrowsePage'), 'MarketplaceBrowsePage')
const MarketplaceSellPage = lazyNamed(() => import('../modules/marketplace/MarketplaceSellPage'), 'MarketplaceSellPage')
const FinanceReconciliationPage = lazyNamed(() => import('../modules/finance/FinanceReconciliationPage'), 'FinanceReconciliationPage')
const GiftFlowRoutes = lazyNamed(() => import('../modules/wallet/GiftFlowRoutes'), 'GiftFlowRoutes')
const HostDashboardPage = lazyNamed(() => import('../modules/host/HostDashboardPage'), 'HostDashboardPage')
const HostHomePage = lazyNamed(() => import('../modules/host/HostHomePage'), 'HostHomePage')
const HostBookingsPage = lazyNamed(() => import('../modules/host/HostBookingsPage'), 'HostBookingsPage')
const HostPayoutPage = lazyNamed(() => import('../modules/host/HostPayoutPage'), 'HostPayoutPage')
const HostEarningsPage = lazyNamed(() => import('../modules/host/HostEarningsPage'), 'HostEarningsPage')
const HostInsightsPanel = lazyNamed(() => import('../modules/host/HostInsightsPanel'), 'HostInsightsPanel')
const HostInquiriesPage = lazyNamed(() => import('../modules/host/HostInquiriesPage'), 'HostInquiriesPage')
const ImmocontactPage = lazyNamed(() => import('../modules/immocontact/ImmocontactPage'), 'ImmocontactPage')
const LandingPage = lazyNamed(() => import('../modules/landing/LandingPage'), 'LandingPage')
const SrLandingPage = lazyNamed(() => import('../modules/sr/SrLandingPage'), 'SrLandingPage')
const RealEstateLandingPage = lazyNamed(() => import('../modules/realestate/RealEstateLandingPage'), 'RealEstateLandingPage')
const PropertyDetailPage = lazyNamed(() => import('../modules/realestate/PropertyDetailPage'), 'PropertyDetailPage')
const MyPropertiesPage = lazyNamed(() => import('../modules/realestate/MyPropertiesPage'), 'MyPropertiesPage')
const LegalPlaceholderPage = lazyNamed(() => import('../modules/legal/LegalPlaceholderPage'), 'LegalPlaceholderPage')
const ListingDetailPage = lazyNamed(() => import('../modules/listings/ListingDetailPage'), 'ListingDetailPage')
const CarBrowsePage = lazyNamed(() => import('../modules/cars/CarBrowsePage'), 'CarBrowsePage')
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
const TrustProtectionRoutes = lazyNamed(() => import('../modules/trust/TrustProtectionRoutes'), 'TrustProtectionRoutes')
const WalletPage = lazyNamed(() => import('../modules/wallet-live/WalletPage'), 'WalletPage')

function lazyNamed<T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
) {
  return lazy(async () => ({ default: (await loader())[exportName] as ComponentType<any> }))
}

function AdminCapsule({ lang, active, title, subtitle, onLanguageChange, children }: { lang: Lang; active: string; title: string; subtitle: string; onLanguageChange: (lang: Lang) => void; children: ReactNode }) {
  return <AdminShell lang={lang} active={active} title={title} subtitle={subtitle} onLanguageChange={onLanguageChange}>{children}</AdminShell>
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => getInitialLanguage())
  const [path, setPath] = useState(() => getCurrentPath())
  const [, setAuthVersion] = useState(0)

  useEffect(() => {
    persistLanguage(lang)
  }, [lang])

  useEffect(() => {
    document.title = routeTitle(path, lang)
  }, [path, lang])

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
  const bookingMatch = path.match(/^\/booking\/([^/]+)$/)
  const bookingReviewMatch = path.match(/^\/booking\/review\/([^/]+)$/)
  const listingMatch = path.match(/^\/listing\/([^/]+)$/)
  const propertyMatch = path.match(/^\/property\/([^/]+)$/)
  const paymentReceiptMatch = path.match(/^\/payment\/receipt\/([^/]+)$/)
  const bookingPaymentMatch = path.match(/^\/payment\/local-wallet\/([^/]+)\/(\d+)\/([^/]+)$/)
  const guestAccountMatch = path.match(/^\/account\/open(?:\/([^/]+))?$/)
  const staffRequiredRole = getStaffRequiredRole(path)
  const hasStaffSession = typeof window !== 'undefined' && hasRequiredStaffSession(staffRequiredRole)
  const providerMode = typeof window !== 'undefined' && getStoredSellerSession() ? 'seller' : 'host'

  const routed = (
      <Suspense fallback={<RouteLoading lang={lang} />}>
        {staffRequiredRole && !hasStaffSession ? (
          <StaffAccessPage lang={lang} role={staffRequiredRole} returnPath={path} />
        ) : isGiftFlowRoute(path) ? (
          <GiftFlowRoutes lang={lang} path={path} />
        ) : isTrustProtectionRoute(path) ? (
          <TrustProtectionRoutes lang={lang} path={path} />
        ) : guestAccountMatch ? (
          guestAccountMatch[1] ? <ListingDetailPage listingId={guestAccountMatch[1]} lang={lang} /> : <SearchPreviewPage lang={lang} initialDivision="stays" entry="stays" />
        ) : path === '/' ? (
          <LandingPage lang={lang} />
        ) : path === '/become-host' ? (
          <HostHomePage lang={lang} />
        ) : path === '/trips' || path === '/my-trips' ? (
          <DashboardPage lang={lang} />
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
        ) : path === '/host/bookings' ? (
          <HostBookingsPage lang={lang} mode={providerMode} />
        ) : path === '/host/payout' ? (
          <HostPayoutPage lang={lang} mode={providerMode} />
        ) : path === '/host/earnings' ? (
          <HostEarningsPage lang={lang} mode={providerMode} />
        ) : path === '/host/insights' ? (
          <HostInsightsPanel lang={lang} />
        ) : path === '/host/inquiries' ? (
          <HostInquiriesPage lang={lang} mode={providerMode} />
        ) : path === '/driver/vehicles' ? (
          <DriverVehiclesPage lang={lang} />
        ) : path === '/driver' ? (
          <DriverDashboardPage lang={lang} />
        ) : path === '/immocontact' ? (
          <ImmocontactPage lang={lang} />
        ) : path === '/admin/disputes' ? (
          <AdminDisputesPage lang={lang} onLanguageChange={setLang} />
        ) : path === '/admin/reports' ? (
          <AdminReportsPage lang={lang} onLanguageChange={setLang} />
        ) : path === '/disputes' ? (
          <DisputesPage lang={lang} />
        ) : path === '/settings' ? (
          <SettingsPage lang={lang} />
        ) : path === '/admin' || path === '/admin/guests' ? (
          <AdminControlCenterPage lang={lang} group="guest" onLanguageChange={setLang} />
        ) : path === '/admin/hosts' ? (
          <AdminControlCenterPage lang={lang} group="host" onLanguageChange={setLang} />
        ) : path === '/admin/accounting' ? (
          <AdminControlCenterPage lang={lang} group="accounting" onLanguageChange={setLang} />
        ) : path === '/admin/management' ? (
          <AdminControlCenterPage lang={lang} group="management" onLanguageChange={setLang} />
        ) : path === '/admin/hr' ? (
          <AdminControlCenterPage lang={lang} group="hr" onLanguageChange={setLang} />
        ) : path === '/admin/review' ? (
          <AdminReviewPage lang={lang} onLanguageChange={setLang} />
        ) : path === '/admin/office' ? (
          <AdminCapsule lang={lang} active="office" title={lang === 'ar' ? 'لوحة المكتب' : 'Office dashboard'} subtitle={lang === 'ar' ? 'ملخص تشغيلي مباشر.' : 'Live operational summary.'} onLanguageChange={setLang}><AdminOfficeDashboardPage lang={lang} /></AdminCapsule>
        ) : path === '/admin/str' ? (
          <AdminSectionOverviewPage lang={lang} section="str" onLanguageChange={setLang} />
        ) : path === '/admin/real-estate' ? (
          <AdminSectionOverviewPage lang={lang} section="realestate" onLanguageChange={setLang} />
        ) : path === '/admin/marketplace' ? (
          <AdminSectionOverviewPage lang={lang} section="marketplace" onLanguageChange={setLang} />
        ) : path === '/admin/cars' ? (
          <AdminSectionOverviewPage lang={lang} section="cars" onLanguageChange={setLang} />
        ) : path === '/admin/advertising' ? (
          <AdminSectionOverviewPage lang={lang} section="advertising" onLanguageChange={setLang} />
        ) : path === '/admin/trust' ? (
          <AdminSectionOverviewPage lang={lang} section="trust" onLanguageChange={setLang} />
        ) : path === '/admin/sr-dispatch' ? (
          <AdminCapsule lang={lang} active="srDispatch" title={lang === 'ar' ? 'توجيه SR' : 'SR dispatch'} subtitle={lang === 'ar' ? 'الرحلات والسائقون من قاعدة البيانات.' : 'Database-backed rides and drivers.'} onLanguageChange={setLang}><AdminSrDispatchPage lang={lang} /></AdminCapsule>
        ) : path === '/ai-brain' ? (
          <AdminCapsule lang={lang} active="aiBrain" title={lang === 'ar' ? 'إدارة الذكاء الاصطناعي' : 'AI management'} subtitle={lang === 'ar' ? 'المراقبة والتوصيات والتقرير اليومي.' : 'Monitoring, recommendations, and the daily report.'} onLanguageChange={setLang}><AiBrainPage lang={lang} /></AdminCapsule>
        ) : path === '/competitors' ? (
          <AdminCapsule lang={lang} active="competitors" title={lang === 'ar' ? 'تحليل المنافسين' : 'Competitor analysis'} subtitle={lang === 'ar' ? 'مرجع استراتيجي، وليس بيانات تشغيلية مباشرة.' : 'Strategic reference, not live operational data.'} onLanguageChange={setLang}><CompetitorsPage lang={lang} /></AdminCapsule>
        ) : path === '/operations' ? (
          <OperationsCalendarPage lang={lang} />
        ) : path === '/finance' ? (
          <AdminCapsule lang={lang} active="financeCenter" title={lang === 'ar' ? 'التسوية المالية' : 'Finance reconciliation'} subtitle={lang === 'ar' ? 'الإيرادات والاستردادات والتحويلات.' : 'Revenue, refunds, and payout reconciliation.'} onLanguageChange={setLang}><FinanceReconciliationPage lang={lang} /></AdminCapsule>
        ) : path === '/status' ? (
          <AdminCapsule lang={lang} active="status" title={lang === 'ar' ? 'حالة المنصة' : 'Platform status'} subtitle={lang === 'ar' ? 'فحص الخدمة وقاعدة البيانات.' : 'Service and database health checks.'} onLanguageChange={setLang}><PlatformStatusPage lang={lang} /></AdminCapsule>
        ) : path === '/terms' ? (
          <LegalPlaceholderPage lang={lang} page="terms" />
        ) : path === '/privacy' ? (
          <LegalPlaceholderPage lang={lang} page="privacy" />
        ) : bookingReviewMatch ? (
          <BookingReviewPage listingId={bookingReviewMatch[1]} lang={lang} />
        ) : bookingMatch ? (
          <BookingDetailPage bookingId={bookingMatch[1]} lang={lang} />
        ) : path === '/my-properties' ? (
          <MyPropertiesPage lang={lang} />
        ) : propertyMatch ? (
          <PropertyDetailPage listingId={propertyMatch[1]} lang={lang} />
        ) : listingMatch ? (
          <ListingDetailPage listingId={listingMatch[1]} lang={lang} />
        ) : path === '/sr' || path === '/rides-home' ? (
          <SrLandingPage lang={lang} onLanguageChange={setLang} />
        ) : path === '/synitres' || path === '/homes' || path === '/realestate' ? (
          <RealEstateLandingPage lang={lang} onLanguageChange={setLang} />
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
          <CarBrowsePage lang={lang} />
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
          <NotFoundPage lang={lang} />
        )}
      </Suspense>
  )

  // SR (Syria Rides) is its OWN platform surface — render its standalone entry full-bleed, WITHOUT the
  // STR app chrome (AppShell), so it reads as an independent product per the isolation directive.
  const chromeless = path === '/sr' || path === '/rides-home' || path === '/synitres' || path === '/homes' || path === '/realestate'
  if (chromeless) return routed

  return (
    <AppShell lang={lang} onLanguageChange={setLang} path={path}>
      {routed}
    </AppShell>
  )
}

function NotFoundPage({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  return (
    <main className="page-shell" role="main">
      <section className="panel" role="alert">
        <h1>{isAr ? 'الصفحة غير موجودة' : 'Page not found'}</h1>
        <p>{isAr ? 'قد يكون الرابط قديماً أو غير صحيح.' : 'This link may be outdated or incorrect.'}</p>
        <button type="button" onClick={() => (window.location.hash = '/')}>{isAr ? 'العودة للرئيسية' : 'Return home'}</button>
      </section>
    </main>
  )
}

function hostFocusFromPath(path: string): 'stays' | 'cars' | 'newConstruction' | 'marketplace' | undefined {
  if (path === '/host/stays') return 'stays'
  if (path === '/host/cars') return 'cars'
  if (path === '/host/new-construction') return 'newConstruction'
  if (path === '/host/marketplace') return 'marketplace'
  return undefined
}

function routeTitle(path: string, lang: Lang) {
  const section = path.startsWith('/admin') ? (lang === 'ar' ? 'الإدارة' : 'Admin')
    : path.startsWith('/host') ? (lang === 'ar' ? 'المضيف' : 'Host')
      : path.startsWith('/driver') || path.startsWith('/ride') || path === '/sr' ? 'SR'
        : path.startsWith('/booking') ? (lang === 'ar' ? 'الحجز' : 'Booking')
          : path.startsWith('/trips') || path.startsWith('/my-trips') ? (lang === 'ar' ? 'رحلاتي' : 'My Trips')
            : path.startsWith('/wallet') ? (lang === 'ar' ? 'المحفظة' : 'Wallet')
              : path.startsWith('/finance') ? (lang === 'ar' ? 'المالية' : 'Finance')
                : path.startsWith('/operations') ? (lang === 'ar' ? 'العمليات' : 'Operations')
                : path.startsWith('/advertising') ? (lang === 'ar' ? 'الإعلانات' : 'Advertising')
                  : path === '/stays' || path === '/search-preview' ? (lang === 'ar' ? 'الإقامات اليومية' : 'Daily Stays')
                    : path === '/rentals' ? (lang === 'ar' ? 'الإيجار الشهري' : 'Monthly Rentals')
                      : path === '/buy' || path === '/homes' || path === '/realestate' ? (lang === 'ar' ? 'العقارات' : 'Real Estate')
                        : path === '/cars' ? (lang === 'ar' ? 'السيارات' : 'Cars')
                          : path === '/marketplace' ? (lang === 'ar' ? 'السوق' : 'Marketplace')
                            : path === '/new-construction' ? (lang === 'ar' ? 'مشاريع جديدة' : 'New Construction')
                  : path === '/privacy' ? (lang === 'ar' ? 'الخصوصية' : 'Privacy')
                    : path === '/terms' ? (lang === 'ar' ? 'الشروط' : 'Terms')
                      : lang === 'ar' ? 'الرئيسية' : 'Home'
  return `${section} | SYBNB`
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
