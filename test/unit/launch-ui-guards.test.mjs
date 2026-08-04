import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('launch UI safety guards', () => {
  it('does not store a staff session for the wrong portal role', () => {
    const api = read('src/shared/api/platformApi.ts')
    expect(api).toContain('if (!session.user.roles.includes(role))')
    expect(api.indexOf('if (!session.user.roles.includes(role))')).toBeLessThan(
      api.indexOf('authStorage.setItem(STAFF_SESSION_KEY'),
    )
  })

  it('opens buyer and renter authentication without routing into daily stays', () => {
    const rentals = read('src/modules/rentals/RentalsPage.tsx')
    const shell = read('src/shared/layout/AppShell.tsx')
    expect(rentals).toContain("window.dispatchEvent(new Event('sybnb-open-auth'))")
    expect(rentals).not.toContain("window.location.hash = '/account/open'")
    expect(shell).toContain("window.addEventListener('sybnb-open-auth', onOpenAuth)")
    expect(shell).toContain("if (path === '/buy')")
    expect(shell).toContain("if (path === '/rentals')")
  })

  it('labels new construction and marketplace controls accurately', () => {
    const search = read('src/modules/search/SearchPreviewPage.tsx')
    const marketplace = read('src/modules/marketplace/MarketplaceBrowsePage.tsx')
    expect(search).toContain("'مشاريع جديدة في سوريا'")
    expect(search).toContain("'New construction in Syria'")
    expect(marketplace).toContain('aria-label={t.minPrice}')
    expect(marketplace).toContain('aria-label={t.condition}')
    expect(marketplace).toContain('tabIndex={0}')
  })

  it('does not present buyer/renter property prices as a platform payment', () => {
    const rentals = read('src/modules/rentals/RentalsPage.tsx')
    const cars = read('src/modules/cars/CarFilterFields.tsx')
    expect(rentals).not.toContain('<PaymentCapsule')
    expect(rentals).not.toContain("destinationCode={isBuyMode ? 'BUYER-CAPSULE' : 'RENTAL-CAPSULE'}")
    expect(cars).toContain('aria-label={`${t.year} — ${t.from}`}')
    expect(cars).toContain('aria-label={`${t.mileage} — ${t.to}`}')
  })

  it('does not ship sample wallet recipient, amount, or gift message values', () => {
    const source = read('src/modules/wallet-live/WalletPage.tsx')
    expect(source).toContain("useState('')")
    expect(source).not.toContain("useState('+963900000001')")
    expect(source).not.toContain("useState('50000')")
    expect(source).not.toContain("useState(isAr ? 'هدية من محفظة SYBNB' : 'Gift from SYBNB Wallet')")
    expect(source).toMatch(/disabled=\{status === 'saving' \|\| recipientPhone\.trim\(\)\.length < 8 \|\| Number\(amountMinor\) <= 0\}/)
  })

  it('keeps staff registration OTP-gated while letting the API authorize sign-in', () => {
    const source = read('src/modules/account/StaffAccessPage.tsx')
    expect(source).toContain("(mode === 'signUp' && !confirmed)")
    expect(source).toContain("disabled={status === 'loading'}")
    expect(source).toContain('autoComplete="one-time-code"')
    expect(source).toContain('autoComplete="new-password"')
    expect(source).toContain("if (!codeConfirmed && code.trim()) activeGrant = (await confirmCode()) || ''")
    expect(source).toContain('name="sybnb-new-password-confirmation"')
    expect(source).toContain('if (newPassword !== passwordRepeat)')
    expect(source).toContain("type={showResetPasswords ? 'text' : 'password'}")
    expect(source).toContain('aria-pressed={showResetPasswords}')
    expect(source).toContain("setMode('signIn')")
    expect(source.indexOf("setMode('signIn')")).toBeLessThan(source.indexOf('setMessage(t.resetSuccess)'))
  })

  it('routes the advertising root into the advertising account flow', () => {
    const source = read('src/modules/seller/SellerDivisionRoutes.tsx')
    const routeGuard = read('src/modules/seller/sellerRoutes.ts')
    expect(source).toContain("path === '/advertising' || path === '/advertising/account'")
    expect(source).toContain('<SellerAccountPage flow="advertising"')
    expect(routeGuard).toContain("path === '/advertising'")
  })

  it('uses server email/phone OTP for seller signup and never compares a browser-generated code', () => {
    const source = read('src/modules/seller/SellerAccountPage.tsx')
    expect(source).toContain("sendEmailVerificationCode(email.trim(), 'staff-login')")
    expect(source).toContain("verifyEmailVerificationCode(email.trim(), mobileCode.trim(), 'staff-login')")
    expect(source).toContain("sendPhoneVerificationCode(phone.trim(), 'staff-login')")
    expect(source).toContain("verifyPhoneVerificationCode(phone.trim(), mobileCode.trim(), 'staff-login')")
    expect(source).not.toContain('createMobileVerificationCode')
    expect(source).not.toContain('mobileCode.trim() !== sentMobileCode')
    expect(source).toContain("email: verificationMethod === 'email' ? email.trim() : ''")
    expect(source).toContain("phone: verificationMethod === 'phone' ? phone.trim() : ''")
  })

  it('stops Trips and Booking on explicit loading/error screens instead of rendering empty business state', () => {
    const trips = read('src/modules/dashboard/DashboardPage.tsx')
    const booking = read('src/modules/bookings/BookingDetailPage.tsx')
    expect(trips).toContain("if (status !== 'ready')")
    expect(trips).toContain("role={status === 'error' ? 'alert' : 'status'}")
    expect(booking).toContain("if (status !== 'ready')")
    expect(booking).toContain("role={status === 'error' ? 'alert' : 'status'}")
  })

  it('keeps builds read-only and public inventory fail-closed', () => {
    const packageJson = JSON.parse(read('package.json'))
    const api = read('src/shared/api/platformApi.ts')
    expect(packageJson.scripts.postbuild).toBeUndefined()
    expect(api).not.toMatch(/catch\s*\{\s*return \{ listings: fallbackApprovedListings\(division\)/)
  })

  it('does not turn payout or operations load failures into empty business state', () => {
    const payout = read('src/modules/host/HostPayoutPage.tsx')
    const operations = read('src/modules/operations/OperationsCalendarPage.tsx')
    expect(payout).toContain("setStatus('error')")
    expect(payout).toContain("disabled={status !== 'ready'}")
    expect(operations).toContain('role="alert"')
    expect(operations).not.toContain('July 2026')
    expect(operations).not.toContain('Guesty-style')
    expect(operations).not.toContain('Guesty gap #1')
    expect(operations).not.toContain("id: 'maintenance-cleaning'")
    expect(operations).toContain('if (rideCount > 0)')
  })

  it('keeps cross-platform navigation and authentication accessible', () => {
    const app = read('src/app/App.tsx')
    const shell = read('src/shared/layout/AppShell.tsx')
    const auth = read('src/modules/auth/AuthPanel.tsx')
    const inbox = read('src/modules/immocontact/ImmocontactPage.tsx')
    expect(app).toContain('<NotFoundPage lang={lang} />')
    expect(app).toContain("path === '/' ?")
    expect(shell).toContain("backPath: '/synitres'")
    expect(shell).not.toContain("nextPath: '/rentals'")
    expect(shell).toContain("backPath: reviewId ? `/listing/${reviewId}` : '/trips'")
    expect(auth).toContain('role="dialog"')
    expect(auth).toContain('aria-modal="true"')
    expect(auth).toContain('autoComplete="one-time-code"')
    expect(inbox).toContain('fetchPrototypeDriverOverview()')
  })

  it('gates marketplace publishing and gives standalone platforms shared support navigation', () => {
    const marketplace = read('src/modules/marketplace/MarketplaceSellPage.tsx')
    const standalone = read('src/shared/layout/StandalonePlatformShell.tsx')
    const listing = read('src/modules/listings/ListingDetailPage.tsx')
    expect(marketplace).toContain('if (!sellerSession)')
    expect(standalone).toContain('href="#standalone-main"')
    expect(standalone).toContain("window.location.hash = '/terms'")
    expect(listing).toContain('onClick={() => void loadListing()}')
  })
})
