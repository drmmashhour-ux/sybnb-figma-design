import { useEffect, useState, type ReactNode } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../brand'
import { Footer } from './Footer'
import { AuthPanel } from '../../modules/auth/AuthPanel'
import { AssistantWidget } from '../ai/AssistantWidget'
import { clearGuestSession, clearStoredStaffSession, getStoredGuestSession, getStoredStaffSession } from '../../shared/api/platformApi'

type Props = {
  lang: Lang
  onLanguageChange: (lang: Lang) => void
  path: string
  children: ReactNode
}

export function AppShell({ lang, onLanguageChange, path, children }: Props) {
  const isAr = lang === 'ar'
  const isLanding = path === '/'
  const isAdvertisingTunnel = path.startsWith('/sell') || path.startsWith('/advertising')
  const isAdminControlRoom = path.startsWith('/admin')
  // Host area (become-a-host marketing + host dashboards): the top-nav's GUEST actions
  // (My Trips / Wallet / Settings / Book now) are for clients and don't belong here, so they're
  // hidden on host pages. The brand logo + language toggle stay.
  const isHostArea = path.startsWith('/host') || path === '/become-host'
  // Synitres (synitres.com) browse routes: the same shared shell, but wearing the Synitres brand instead
  // of SYBNB so the sale/buy/rent + marketplace platform reads as its own product (the /sell tunnel and
  // the /synitres landing already carry Synitres branding of their own).
  const isSynitresBrowse = path === '/buy' || path === '/rentals' || path === '/marketplace'
  // A direct/shared link into /listing/:id has no return-path in sessionStorage yet -- the listing
  // page writes the correct one once its fetch resolves and fires this event so the breadcrumb
  // (otherwise computed once at mount, before that write lands) picks it up without a full reload.
  const [, forceReturnPathRecompute] = useState(0)
  useEffect(() => {
    const onUpdate = () => forceReturnPathRecompute((tick) => tick + 1)
    window.addEventListener('sybnb:listing-return-path-updated', onUpdate)
    // Re-render the nav (account name vs "Sign in") whenever the session changes.
    window.addEventListener('sybnb-session-changed', onUpdate)
    return () => {
      window.removeEventListener('sybnb:listing-return-path-updated', onUpdate)
      window.removeEventListener('sybnb-session-changed', onUpdate)
    }
  }, [])
  const session = getStoredGuestSession() || getStoredStaffSession()
  const logout = () => {
    clearGuestSession()
    clearStoredStaffSession()
    navigate('/')
  }
  const [authOpen, setAuthOpen] = useState(false)
  // After sign in / sign up, land the user where they belong: guests on My Trips, hosts on the host
  // dashboard, admins in admin, drivers on their dashboard.
  const routeAfterAuth = (roles: string[]) => {
    setAuthOpen(false)
    if (roles.includes('ADMIN')) navigate('/admin')
    else if (roles.includes('HOST') || roles.includes('SELLER')) navigate('/host')
    else if (roles.includes('DRIVER')) navigate('/driver')
    else navigate('/trips')
  }
  // The header account button. A user with MULTIPLE staff roles (e.g. an owner who is BOTH host and
  // admin) must NOT be yanked out of the workspace they're in: clicking it while hosting used to jump to
  // the admin dashboard (routeAfterAuth prioritizes ADMIN), which made the host and admin areas bleed
  // together. Respect the current context first; only fall back to role-priority on a neutral page.
  const goToMyWorkspace = () => {
    const roles = session?.user.roles || []
    if ((path.startsWith('/host') || path.startsWith('/sell')) && (roles.includes('HOST') || roles.includes('SELLER'))) return navigate('/host')
    if (path.startsWith('/admin') && roles.includes('ADMIN')) return navigate('/admin')
    if (path.startsWith('/driver') && roles.includes('DRIVER')) return navigate('/driver')
    if (path.startsWith('/trips') || path.startsWith('/booking')) return navigate('/trips')
    routeAfterAuth(roles)
  }
  const routeContext = getRouteContext(path, isAr)
  const showFlowNav = !isLanding && !isAdminControlRoom
  function goBack() {
    // Go back ONE page — the actual previous page the user came from (page by page), not always
    // the landing. Uses real browser history; only falls back to the route's backPath when the user
    // opened this page directly (e.g. a shared link) and there is no in-app history to step back to.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    } else {
      navigate(routeContext.backPath)
    }
  }

  function goNext() {
    if (!routeContext.nextPath) return
    navigate(routeContext.nextPath)
  }


  return (
    <div className="app-shell" dir={isAr ? 'rtl' : 'ltr'}>
      <a className="skip-link" href="#main-content">
        {isAr ? 'تخطي إلى المحتوى الرئيسي' : 'Skip to main content'}
      </a>
      {!isAdvertisingTunnel && !isAdminControlRoom && (
        <header className="top-nav">
          <button
            className="brand-lockup"
            onClick={() => navigate(isSynitresBrowse ? '/synitres' : '/')}
            aria-label={isSynitresBrowse ? 'Synitres home' : 'SYBNB home'}
          >
            {isSynitresBrowse ? (
              <span style={{ fontWeight: 900, fontSize: 20, letterSpacing: '.02em', color: '#2DD4BF' }}>
                Syn<span style={{ color: '#D4AF6A' }}>itres</span>
              </span>
            ) : (
              <BrandLogo logo="platform" size="nav" className="top-nav-logo" />
            )}
          </button>

          <nav className="nav-actions" aria-label={isAr ? 'إجراءات الحساب' : 'Account actions'}>
            {!isLanding && (
              <div className="route-context" aria-label={isAr ? 'مكانك داخل المنصة' : 'Current platform location'}>
                <span className="route-main">{routeContext.section}</span>
                <span className="route-separator">/</span>
                <strong className="route-page">{routeContext.page}</strong>
              </div>
            )}
            <div className="language-switch" role="group" aria-label={isAr ? 'اختيار اللغة' : 'Choose language'}>
              <button className={isAr ? 'active' : ''} onClick={() => onLanguageChange('ar')}>
                AR
              </button>
              <button className={!isAr ? 'active' : ''} onClick={() => onLanguageChange('en')}>
                EN
              </button>
            </div>
            {session ? (
              <>
                <button className="menu-action" onClick={goToMyWorkspace}>
                  {session.user.displayName || (isAr ? 'حسابي' : 'My account')}
                </button>
                <button className="menu-action" onClick={logout}>
                  {isAr ? 'تسجيل الخروج' : 'Log out'}
                </button>
              </>
            ) : (
              <button className="primary-action nav-signin" onClick={() => setAuthOpen(true)}>
                {isAr ? 'دخول / حساب' : 'Sign in'}
              </button>
            )}
          </nav>
        </header>
      )}
      {showFlowNav && (
        <div className="flow-step-nav" aria-label={isAr ? 'التنقل داخل المسار' : 'Flow navigation'}>
          <button className="flow-nav-button" onClick={goBack}>
            {isAr ? 'السابق' : 'Back'}
          </button>
          <span>{routeContext.section} · {routeContext.page}</span>
          {routeContext.nextPath ? (
            <button className="flow-nav-button" onClick={goNext}>
              {isAr ? 'التالي' : 'Next'}
            </button>
          ) : (
            <span className="flow-nav-placeholder" aria-hidden="true" />
          )}
        </div>
      )}
      <div id="main-content" tabIndex={-1}>
        {children}
      </div>
      {!isAdvertisingTunnel && !isAdminControlRoom && <Footer lang={lang} />}
      {authOpen && <AuthPanel lang={lang} onClose={() => setAuthOpen(false)} onAuthed={routeAfterAuth} />}
      {!isAdminControlRoom && <AssistantWidget lang={isAr ? 'ar' : 'en'} />}
    </div>
  )
}

function getRouteContext(path: string, isAr: boolean) {
  const home = '/'
  if (path === '/stays') {
    return {
      section: isAr ? 'الإيجار اليومي' : 'Short-term rental',
      page: isAr ? 'بحث الإيجار اليومي' : 'Stay search',
      backPath: home,
      nextPath: '',
    }
  }
  if (path === '/search-preview') {
    return {
      section: isAr ? 'البحث' : 'Search',
      page: isAr ? 'محرك البحث العام' : 'Search engine',
      backPath: home,
      nextPath: '/stays',
    }
  }
  if (path.startsWith('/rentals')) {
    return {
      section: isAr ? 'الإيجار الشهري' : 'Monthly rental',
      page: isAr ? 'بحث العقارات' : 'Property search',
      backPath: home,
      nextPath: '/rentals',
    }
  }
  if (path.startsWith('/cars')) {
    return {
      section: isAr ? 'المركبات' : 'Cars',
      page: isAr ? 'بحث المركبات' : 'Vehicle search',
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/new-construction')) {
    return {
      section: isAr ? 'مشاريع جديدة' : 'New construction',
      page: isAr ? 'المشاريع' : 'Projects',
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/marketplace')) {
    return {
      section: isAr ? 'السوق' : 'Marketplace',
      page: isAr ? 'العروض' : 'Offers',
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/sell') || path.startsWith('/advertising')) {
    const isPaymentTunnel = path.includes('/payment')
    return {
      section: isAr ? 'الإعلان معنا' : 'Advertise with us',
      page: isPaymentTunnel ? (isAr ? 'الدفع' : 'Payment') : (isAr ? 'طلب الإعلان' : 'Advertising request'),
      backPath: isPaymentTunnel ? '/advertising/account' : home,
      nextPath: '',
    }
  }
  if (path.startsWith('/listing/')) {
    const id = path.split('/')[2] || ''
    const listingContext = routeContextFromReturnPath(readListingReturnPath(), isAr)
    return {
      section: listingContext.section,
      page: listingContext.detailsPage,
      backPath: listingContext.backPath,
      nextPath: '',
    }
  }
  if (path.startsWith('/account/open')) {
    const id = path.split('/')[3] || ''
    return {
      section: isAr ? 'الإيجار اليومي' : 'Short-term rental',
      page: isAr ? 'تفاصيل الإقامة' : 'Stay details',
      backPath: id ? `/listing/${id}` : '/stays',
      nextPath: id ? `/booking/review/${id}` : '/stays',
    }
  }
  if (path.startsWith('/booking/')) {
    // Booking is reached from a stay's details (/booking/review/:id), so Back should return to that
    // listing — not dump the guest on the public landing and lose what they were booking.
    const id = path.split('/')[3] || ''
    return {
      section: isAr ? 'الإيجار اليومي' : 'Short-term rental',
      page: isAr ? 'الحجز' : 'Booking',
      backPath: id ? `/listing/${id}` : '/',
      nextPath: '',
    }
  }
  if (path.startsWith('/payment/')) {
    return {
      section: isAr ? 'الإيجار اليومي' : 'Short-term rental',
      page: isAr ? 'الدفع الآمن' : 'Secure payment',
      backPath: '/',
      nextPath: '',
    }
  }
  if (path === '/wallet') {
    return {
      section: isAr ? 'حساب العميل' : 'Guest account',
      page: isAr ? 'المحفظة' : 'Wallet',
      backPath: '/',
      nextPath: '/',
    }
  }
  if (path === '/trips' || path === '/my-trips') {
    return {
      section: isAr ? 'حساب العميل' : 'Guest account',
      page: isAr ? 'رحلاتي' : 'My Trips',
      backPath: '/',
      nextPath: '/',
    }
  }
  if (path.startsWith('/host')) {
    if (path.startsWith('/host/cars')) {
      return {
        section: isAr ? 'المركبات' : 'Cars',
        page: isAr ? 'لوحة بائع المركبات' : 'Vehicle seller dashboard',
        backPath: '/cars',
        nextPath: '',
      }
    }
    if (path.startsWith('/host/new-construction')) {
      return {
        section: isAr ? 'مشاريع جديدة' : 'New construction',
        page: isAr ? 'لوحة المطور العقاري' : 'Developer dashboard',
        backPath: '/new-construction',
        nextPath: '',
      }
    }
    if (path.startsWith('/host/marketplace')) {
      return {
        section: isAr ? 'السوق' : 'Marketplace',
        page: isAr ? 'لوحة بائع السوق' : 'Marketplace seller dashboard',
        backPath: '/marketplace',
        nextPath: '',
      }
    }
    if (path.startsWith('/host/stays')) {
      return {
        section: isAr ? 'الإيجار اليومي' : 'Short-term rental',
        page: isAr ? 'لوحة الاستضافة' : 'Hosting dashboard',
        // Back from the host dashboard goes to the site home, not the GUEST stay-search (a host on
        // their dashboard shouldn't be dropped into guest search).
        backPath: '/',
        nextPath: '',
      }
    }
    // Host sub-pages (insights, earnings, inquiries, bookings, availability, payments, payout…) are
    // opened from inside the hosting dashboard, so "Back" must return there — not dump a signed-in
    // host on the public landing (which has no Back of its own).
    return {
      section: isAr ? 'المضيف' : 'Host',
      page: isAr ? 'لوحة الاستضافة' : 'Hosting dashboard',
      backPath: '/host/stays',
      nextPath: '',
    }
  }
  if (path.startsWith('/driver')) {
    return {
      section: isAr ? 'السائق' : 'Driver',
      page: isAr ? 'لوحة SR' : 'SR dashboard',
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/admin')) {
    return {
      section: isAr ? 'الإدارة' : 'Admin',
      page: isAr ? 'المراجعة' : 'Review',
      backPath: home,
      nextPath: '/operations',
    }
  }
  if (path.startsWith('/finance')) {
    return {
      section: isAr ? 'المالية' : 'Finance',
      page: isAr ? 'المطابقة' : 'Reconciliation',
      backPath: '/admin/review',
      nextPath: '/operations',
    }
  }
  if (path.startsWith('/operations')) {
    return {
      section: isAr ? 'العمليات' : 'Operations',
      page: isAr ? 'المتابعة' : 'Tracking',
      backPath: '/finance',
      nextPath: '/ai-brain',
    }
  }
  if (path.startsWith('/ai-brain')) {
    return {
      section: isAr ? 'AI Brain' : 'AI Brain',
      page: isAr ? 'ذكاء السوق' : 'Market intelligence',
      backPath: '/operations',
      nextPath: '/competitors',
    }
  }
  if (path.startsWith('/competitors')) {
    return {
      section: isAr ? 'المنافسين' : 'Competitors',
      page: isAr ? 'المقارنة' : 'Comparison',
      backPath: '/ai-brain',
      nextPath: '/status',
    }
  }
  if (path.startsWith('/immocontact')) {
    return {
      section: isAr ? 'تواصل' : 'Contact',
      page: isAr ? 'صندوق الرسائل' : 'Inbox',
      // Back returns to the account page (My Trips), not the public landing — the inbox is opened
      // from inside a signed-in account.
      backPath: '/trips',
      nextPath: '',
    }
  }
  return {
    section: isAr ? 'المنصة' : 'Platform',
    page: isAr ? 'الصفحة الحالية' : 'Current page',
    backPath: home,
    nextPath: '',
  }
}

function readGuestReturnPath() {
  if (typeof window === 'undefined') return ''
  try {
    return sessionStorage.getItem('sybnb.v6.guestReturnPath') || ''
  } catch {
    return ''
  }
}

function readListingReturnPath() {
  if (typeof window === 'undefined') return '/stays'
  try {
    return sessionStorage.getItem('sybnb-v6-listing-return-path') || '/stays'
  } catch {
    return '/stays'
  }
}

function routeContextFromReturnPath(returnPath: string, isAr: boolean) {
  if (returnPath.startsWith('/rentals')) {
    return {
      section: isAr ? 'الإيجار الشهري' : 'Monthly rental',
      detailsPage: isAr ? 'تفاصيل الإيجار' : 'Rental details',
      backPath: '/rentals',
    }
  }
  if (returnPath.startsWith('/cars')) {
    return {
      section: isAr ? 'المركبات' : 'Cars',
      detailsPage: isAr ? 'تفاصيل المركبة' : 'Vehicle details',
      backPath: '/cars',
    }
  }
  if (returnPath.startsWith('/marketplace')) {
    return {
      section: isAr ? 'السوق' : 'Marketplace',
      detailsPage: isAr ? 'تفاصيل المنتج' : 'Product details',
      backPath: '/marketplace',
    }
  }
  if (returnPath.startsWith('/buy')) {
    return {
      section: isAr ? 'شراء عقار' : 'Buy property',
      detailsPage: isAr ? 'تفاصيل العقار' : 'Property details',
      backPath: '/buy',
    }
  }
  if (returnPath.startsWith('/new-construction')) {
    return {
      section: isAr ? 'مشاريع جديدة' : 'New construction',
      detailsPage: isAr ? 'تفاصيل المشروع' : 'Project details',
      backPath: '/new-construction',
    }
  }
  return {
    section: isAr ? 'الإيجار اليومي' : 'Short-term rental',
    detailsPage: isAr ? 'تفاصيل الإقامة' : 'Stay details',
    backPath: '/stays',
  }
}
