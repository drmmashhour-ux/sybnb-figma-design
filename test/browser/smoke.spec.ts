import { expect, test } from '@playwright/test'

// Repository-owned browser smoke coverage, run via `npm run test:browser`. Runs against the
// isolated .env.test database (playwright.config.ts spawns both servers with it) — never the
// development database, and never makes a real external API call (no live payment/SMS/email
// provider is configured in .env.test; any such call would fail loudly, not silently succeed).

test.describe('landing page', () => {
  test('loads and renders the platform heading', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /منصة سوريا الكاملة/ })).toBeVisible()
  })

  test('is served with lang="ar" dir="rtl", and RTL is actually applied', async ({ page }) => {
    await page.goto('/')
    const html = page.locator('html')
    await expect(html).toHaveAttribute('lang', 'ar')
    await expect(html).toHaveAttribute('dir', 'rtl')
    const direction = await page.evaluate(() => getComputedStyle(document.body).direction)
    expect(direction).toBe('rtl')
  })
})

test.describe('content security policy — evidence of which response carries which CSP', () => {
  test('the frontend HTML carries its own <meta> CSP, scoped for a static asset origin', async ({ page }) => {
    await page.goto('/')
    const cspMeta = page.locator('meta[http-equiv="Content-Security-Policy"]')
    await expect(cspMeta).toHaveCount(1)
    const content = await cspMeta.getAttribute('content')
    expect(content).toContain("default-src 'self'")
    expect(content).toContain("script-src 'self'")
    expect(content).not.toContain('unsafe-eval')
    expect(content).not.toContain('*')
  })

  test('the frontend does not rely on the API\'s CSP header — no CSP header is present on the HTML response itself', async ({ request, baseURL }) => {
    // Confirms the two are genuinely separate: the frontend origin's own response has no CSP
    // header of its own (its protection is the <meta> tag above), while the API origin (checked
    // in the next test) sets a real header — this pins down which mechanism protects which layer,
    // per the independent-review finding that these were previously conflated in documentation.
    const res = await request.get(baseURL || 'http://127.0.0.1:5190')
    expect(res.headers()['content-security-policy']).toBeUndefined()
  })

  test('the API origin sets its own strict header-based CSP, unrelated to the frontend\'s policy', async () => {
    const apiBase = process.env.PLAYWRIGHT_API_BASE_URL || 'http://127.0.0.1:3061'
    const res = await fetch(`${apiBase}/api/health`)
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'")
  })
})

test.describe('search', () => {
  test('the stays search page loads', async ({ page }) => {
    await page.goto('/#/stays')
    await expect(page.locator('main')).toBeVisible()
  })
})

// Guest authentication is CONTEXTUAL — it happens inside the listing/booking flow, not from a
// standalone landing-page button (the old account-dashboard entry was retired). The only STANDALONE
// login UI is the partner/staff portal (StaffAccessPage), shown when a logged-out visitor hits a
// staff route (e.g. /host). These specs verify that portal renders and validates. Full
// credential-based auth is covered by test/api/auth.test.mjs against the real endpoint.
test.describe('partner/staff sign-in portal', () => {
  test('renders the sign-in form on a staff route when logged out', async ({ page }) => {
    await page.goto('/#/host')
    // A logged-out visitor to /host sees the partner sign-in portal, not the host dashboard.
    await expect(page.getByRole('button', { name: 'تسجيل الدخول' }).first()).toBeVisible()
    await expect(page.getByRole('textbox', { name: /البريد الإلكتروني/ }).first()).toBeVisible()
    await expect(page.getByLabel('كلمة المرور', { exact: true })).toBeVisible()
  })

  test('incomplete sign-in shows a validation message, not a silent failure', async ({ page }) => {
    await page.goto('/#/host')
    await page.getByRole('textbox', { name: /البريد الإلكتروني/ }).first().fill('nobody@sybnb.test')
    await page.getByLabel('كلمة المرور', { exact: true }).fill('definitely-wrong-password')
    // Submit without confirming the emailed code: the portal must surface a visible status message
    // rather than failing silently.
    await page.getByRole('button', { name: 'فتح لوحة الشريك' }).click()
    await expect(page.getByText('أدخل البريد وكلمة المرور، ثم أكّد رمز البريد قبل الدخول.')).toBeVisible({
      timeout: 10_000,
    })
  })
})

test.describe('unauthorized access to staff routes', () => {
  test('visiting /host while logged out does not reveal host-only data', async ({ page }) => {
    await page.goto('/#/host')
    // No JWT/session in this fresh browser context — the page must not show the authenticated
    // host dashboard content. We assert the absence of a host-only marker rather than a specific
    // redirect implementation, since this SPA doesn't necessarily hard-redirect on the client.
    await expect(page.getByText('جاهز للصرف')).toHaveCount(0)
  })

  test('visiting /admin/review while logged out does not reveal the review queue', async ({ page }) => {
    await page.goto('/#/admin/review')
    await expect(page.getByText('قائمة المراجعة')).toHaveCount(0)
  })
})

test.describe('legal draft badge', () => {
  test('the terms page shows the DRAFT — NOT FINAL badge', async ({ page }) => {
    await page.goto('/#/terms')
    await expect(page.getByText('مسودة — غير نهائية')).toBeVisible()
  })
})

// The ID-verification status label ("لم يتم رفع الهوية بعد") used to be reachable from a landing-page
// "create account" button. That standalone signup entry was retired (guest auth is now contextual),
// and the label now lives inside the booking flow (BookingDetailPage), which needs a booking to reach
// — not a stable browser-smoke target. The underlying behavior (ID-document status gating) is covered
// server-side by test/api/id-verification-gate.test.mjs.

// Known, accepted difference: both tests below fail on the "webkit" project. Playwright's bundled
// WebKit engine mirrors real Safari's default keyboard-navigation behavior — Tab only moves focus
// between text fields and links by default, not buttons, unless "Full Keyboard Access" is enabled
// (macOS System Settings > Keyboard). Chromium (and real-world Chrome/Firefox/Edge) always include
// buttons in the default Tab order. This is a genuine, well-documented browser/platform behavior
// difference, not an application bug — recorded here rather than papered over, consistent with
// this suite's "webkit" label never being represented as real Safari coverage.
test.describe('keyboard navigation and visible focus', () => {
  test('Tab reaches the sign-in control on the partner portal', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit follows Safari default keyboard navigation unless Full Keyboard Access is enabled.')
    // The standalone login lives on the partner/staff portal (a logged-out staff route). Confirm it
    // is keyboard-reachable: tabbing from the top of the page lands on the "تسجيل الدخول" control.
    await page.goto('/#/host')
    await expect(page.getByRole('button', { name: 'تسجيل الدخول' }).first()).toBeVisible()
    let reachedLogin = false
    for (let i = 0; i < 30 && !reachedLogin; i += 1) {
      await page.keyboard.press('Tab')
      reachedLogin = await page.evaluate(() => document.activeElement?.textContent?.trim() === 'تسجيل الدخول')
    }
    expect(reachedLogin).toBe(true)
  })

  test('the focused element receives a real, trusted-input-triggered visible outline', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit follows Safari default keyboard navigation unless Full Keyboard Access is enabled.')
    await page.goto('/')
    await page.keyboard.press('Tab')
    const outlineStyle = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle)
    // This is the check that could not be reliably performed via the non-trusted synthetic
    // .focus() calls used during the manual accessibility pass (see
    // SYBNB_V6_MANUAL_ACCESSIBILITY_CHECKLIST.md) — Playwright's page.keyboard.press dispatches a
    // real, trusted input event, so this assertion is the actual answer to that open question.
    expect(outlineStyle).not.toBe('none')
  })
})

test.describe('responsive overflow', () => {
  for (const width of [320, 360, 390, 412, 768, 1280, 1440]) {
    test(`no horizontal overflow on the landing page at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      const [scrollWidth, clientWidth] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ])
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1) // 1px tolerance for scrollbar rounding
    })
  }
})

test.describe('AI booking assistant staging widget', () => {
  test('opens accessibly, switches French, and preserves Arabic RTL', async ({ page }) => {
    await page.goto('/#/stays')
    await page.getByRole('button', { name: 'اسأل SYBNB AI' }).click()
    const dialog = page.getByRole('dialog', { name: 'مساعد الحجز' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('dir', 'rtl')
    await dialog.getByRole('button', { name: 'FR' }).click()
    await expect(page.getByRole('dialog', { name: 'Assistant de réservation' })).toHaveAttribute('dir', 'ltr')
    await expect(page.getByPlaceholder('Où souhaitez-vous séjourner ?')).toBeVisible()
  })

  test('fits a 320px mobile viewport without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/#/stays')
    await page.getByRole('button', { name: 'اسأل SYBNB AI' }).click()
    const dialog = page.getByRole('dialog')
    const box = await dialog.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(320)
  })
})
