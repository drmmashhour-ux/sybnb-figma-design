import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createStaffAccountSession,
  resetPasswordWithEmailCode,
  resetPasswordWithPhoneCode,
  sendEmailVerificationCode,
  sendPhoneVerificationCode,
  verifyEmailVerificationCode,
  verifyPhoneVerificationCode,
} from '../../shared/api/platformApi'

type StaffRole = 'ADMIN' | 'HOST' | 'DRIVER'
type PartnerType = 'HOST' | 'SELLER' | 'RENTER' | 'BUILDER' | 'DEALER'

type Props = {
  lang: Lang
  role: StaffRole
  returnPath: string
}

const partnerOptions: Array<{ id: PartnerType; ar: string; en: string; detailAr: string; detailEn: string }> = [
  { id: 'HOST', ar: 'مضيف إقامة', en: 'Stay host', detailAr: 'إيجار يومي وفندقي', detailEn: 'Short stays and hospitality' },
  { id: 'SELLER', ar: 'بائع عقار', en: 'Property seller', detailAr: 'بيع عقار أو أرض', detailEn: 'Homes, land, and resale' },
  { id: 'RENTER', ar: 'مؤجر طويل', en: 'Long-term renter', detailAr: 'إيجار شهري أو سنوي', detailEn: 'Monthly and yearly rentals' },
  { id: 'BUILDER', ar: 'مطور بناء', en: 'New construction', detailAr: 'مشاريع ومبان جديدة', detailEn: 'New projects and builders' },
  { id: 'DEALER', ar: 'تاجر مركبات', en: 'Vehicle partner', detailAr: 'سيارات جديدة أو مستعملة', detailEn: 'New and used cars' },
]

const labels = {
  ar: {
    adminTitle: 'دخول الإدارة',
    partnerTitle: 'بوابة شركاء SYBNB',
    driverTitle: 'دخول السائق',
    adminSubtitle: 'حسابات الإدارة ينشئها المالك فقط. سجّل الدخول بكلمة المرور ورمز البريد.',
    partnerSubtitle: 'افتح حسابك كشريك، اختر نوع نشاطك، ثم تابع إلى لوحة العمل المناسبة.',
    driverSubtitle: 'سجّل الدخول أو أنشئ حساب سائق بعد تأكيد البريد الإلكتروني.',
    signIn: 'تسجيل الدخول',
    signUp: 'إنشاء حساب',
    forgotPassword: 'نسيت كلمة المرور',
    resetPasswordCta: 'تحديث كلمة المرور',
    backToSignIn: 'العودة لتسجيل الدخول',
    email: 'البريد الإلكتروني',
    emailHelp: 'اكتب البريد كاملاً. سنرسل رمز التأكيد إلى هذا البريد.',
    emailRepeat: 'أعد كتابة البريد الإلكتروني',
    confirmEmail: 'تأكيد البريد',
    emailMismatch: 'البريد الإلكتروني وتأكيد البريد غير متطابقين.',
    password: 'كلمة المرور',
    repeatPassword: 'تأكيد كلمة المرور',
    newPassword: 'كلمة المرور الجديدة',
    phone: 'رقم الهاتف',
    partnerType: 'نوع الحساب',
    code: 'رمز البريد',
    sendCode: 'إرسال الرمز',
    resendCode: 'إعادة الإرسال',
    confirmCode: 'تأكيد الرمز',
    confirmedShort: 'تم التأكيد ✓',
    tryAgain: 'حاول مجدداً',
    confirmingCode: 'جار التأكيد...',
    sendingCode: 'جار الإرسال...',
    codeSentReal: 'تم إرسال الرمز إلى بريدك الإلكتروني.',
    codeSentDev: 'تم إنشاء الرمز في بيئة الاختبار. إذا كان Resend مفعلاً سيصل البريد أيضاً.',
    codeConfirmed: 'تم تأكيد البريد.',
    codeInvalid: 'الرمز غير صحيح أو منتهي الصلاحية.',
    verifyByEmail: 'التحقق بالبريد',
    verifyByPhone: 'التحقق بالهاتف',
    sendCodePhone: 'إرسال رمز SMS',
    phoneCodeSent: 'تم إرسال رمز التحقق إلى هاتفك عبر SMS.',
    phoneConfirmed: 'تم تأكيد رقم الهاتف.',
    demoCode: 'رمز الاختبار',
    openAdmin: 'دخول الإدارة',
    openPartner: 'فتح لوحة الشريك',
    openDriver: 'فتح لوحة السائق',
    opening: 'جار فتح الجلسة...',
    resetting: 'جار تحديث كلمة المرور...',
    note: 'العميل لا يرى هذه البوابة أثناء الحجز. هذه البوابة للمضيفين والإدارة فقط.',
    error: 'تعذر فتح الجلسة.',
    signInRequired: 'أدخل البريد وكلمة المرور، ثم أكّد رمز البريد قبل الدخول.',
    signUpRequired: 'أدخل البريد والهاتف وكلمة المرور، واختر نوع الحساب، ثم أكّد رمز البريد.',
    passwordMismatch: 'تأكيد كلمة المرور غير مطابق.',
    resetRequired: 'أدخل البريد وكلمة المرور الجديدة، ثم أكّد رمز البريد.',
    resetSuccess: 'تم تحديث كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.',
    adminNoSignup: 'إنشاء حساب الإدارة مغلق. المالك فقط يضيف الإدارة.',
  },
  en: {
    adminTitle: 'Admin sign in',
    partnerTitle: 'SYBNB Partner Gate',
    driverTitle: 'Driver sign in',
    adminSubtitle: 'Admin accounts are owner-created only. Sign in with password plus email code.',
    partnerSubtitle: 'Create your partner account, choose your business type, then continue to the right dashboard.',
    driverSubtitle: 'Sign in or create a driver account after confirming your email.',
    signIn: 'Sign in',
    signUp: 'Create account',
    forgotPassword: 'Forgot password',
    resetPasswordCta: 'Update password',
    backToSignIn: 'Back to sign in',
    email: 'Email address',
    emailHelp: 'Use the full email address. We send the confirmation code here.',
    emailRepeat: 'Repeat email address',
    confirmEmail: 'Confirm email',
    emailMismatch: 'Email and repeated email do not match.',
    password: 'Password',
    repeatPassword: 'Repeat password',
    newPassword: 'New password',
    phone: 'Phone number',
    partnerType: 'Account type',
    code: 'Email code',
    sendCode: 'Send code',
    resendCode: 'Resend code',
    confirmCode: 'Confirm code',
    confirmedShort: 'Confirmed ✓',
    tryAgain: 'Try again',
    confirmingCode: 'Confirming...',
    sendingCode: 'Sending...',
    codeSentReal: 'A verification code was sent to your email.',
    codeSentDev: 'A test code was generated. If Resend is configured, the email is also sent.',
    codeConfirmed: 'Email confirmed.',
    codeInvalid: 'Incorrect or expired verification code.',
    verifyByEmail: 'Verify by email',
    verifyByPhone: 'Verify by phone',
    sendCodePhone: 'Send SMS code',
    phoneCodeSent: 'Verification code sent to your phone via SMS.',
    phoneConfirmed: 'Phone number confirmed.',
    demoCode: 'Test code',
    openAdmin: 'Open admin',
    openPartner: 'Open partner dashboard',
    openDriver: 'Open driver dashboard',
    opening: 'Opening session...',
    resetting: 'Updating password...',
    note: 'Guests do not see this gate during booking. This gate is for partners and admin only.',
    error: 'Could not open session.',
    signInRequired: 'Enter email and password, then confirm the email code before signing in.',
    signUpRequired: 'Enter email, phone, password, account type, then confirm the email code.',
    passwordMismatch: 'Repeated password does not match.',
    resetRequired: 'Enter your email and a new password, then confirm the email code.',
    resetSuccess: 'Password updated. Sign in with the new password.',
    adminNoSignup: 'Admin signup is closed. Only the owner can add admin accounts.',
  },
}

export function StaffAccessPage({ lang, role, returnPath }: Props) {
  const t = labels[lang]
  const isAr = lang === 'ar'
  const canSignUp = role !== 'ADMIN'
  const phoneOtpEnabled = import.meta.env.VITE_PHONE_OTP_ENABLED === '1'
  const [mode, setMode] = useState<'signIn' | 'signUp' | 'forgotPassword'>('signIn')
  // Verify by email (default) or phone/SMS, including password recovery for phone-only accounts.
  const [verifyMethod, setVerifyMethod] = useState<'email' | 'phone'>('email')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [email, setEmail] = useState('')
  const [emailRepeat, setEmailRepeat] = useState('')
  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [partnerType, setPartnerType] = useState<PartnerType>('HOST')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeConfirmed, setCodeConfirmed] = useState(false)
  const [verificationGrant, setVerificationGrant] = useState('')
  const [codeTryAgain, setCodeTryAgain] = useState(false)
  const [codeBusy, setCodeBusy] = useState<'idle' | 'sending' | 'confirming'>('idle')
  const [devCode, setDevCode] = useState('')
  const [message, setMessage] = useState('')
  const [isErrorMessage, setIsErrorMessage] = useState(false)

  const pageTitle = role === 'ADMIN' ? t.adminTitle : role === 'DRIVER' ? t.driverTitle : t.partnerTitle
  const subtitle = role === 'ADMIN' ? t.adminSubtitle : role === 'DRIVER' ? t.driverSubtitle : t.partnerSubtitle
  const actionLabel = role === 'ADMIN' ? t.openAdmin : role === 'DRIVER' ? t.openDriver : t.openPartner
  const otpPurpose = mode === 'forgotPassword' ? 'password-reset' : 'staff-login'
  // Phone verification is available for sign-in / sign-up (not the email-only password reset).
  const usePhone = verifyMethod === 'phone'
  const identifierReady = usePhone ? phone.trim().length >= 8 : email.includes('@')

  function resetCodeState() {
    setCodeSent(false)
    setCodeConfirmed(false)
    setVerificationGrant('')
    setCode('')
    setDevCode('')
    setMessage('')
    setIsErrorMessage(false)
  }

  function updateEmail(nextEmail: string) {
    setEmail(nextEmail)
    resetCodeState()
  }

  function switchMode(next: 'signIn' | 'signUp' | 'forgotPassword') {
    if (next === 'signUp' && !canSignUp) return
    setMode(next)
    resetCodeState()
  }

  async function sendCode() {
    if (usePhone ? phone.trim().length < 8 : !email.trim()) return
    setCodeBusy('sending')
    setCode('')
    setCodeConfirmed(false)
    setCodeTryAgain(false)
    setDevCode('')
    try {
      const result = usePhone
        ? await sendPhoneVerificationCode(phone.trim(), otpPurpose)
        : await sendEmailVerificationCode(email.trim(), otpPurpose)
      setCodeSent(true)
      setIsErrorMessage(false)
      if (result.devCode) {
        setDevCode(result.devCode)
        setMessage(t.codeSentDev)
      } else {
        setMessage(usePhone ? t.phoneCodeSent : t.codeSentReal)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
      setIsErrorMessage(true)
    } finally {
      setCodeBusy('idle')
    }
  }

  async function confirmCode(): Promise<string | null> {
    setCodeBusy('confirming')
    try {
      const result = usePhone
        ? await verifyPhoneVerificationCode(phone.trim(), code.trim(), otpPurpose)
        : await verifyEmailVerificationCode(email.trim(), code.trim(), otpPurpose)
      setVerificationGrant(result.verificationGrant)
      setCodeConfirmed(true)
      setCodeTryAgain(false)
      setMessage(usePhone ? t.phoneConfirmed : t.codeConfirmed)
      setIsErrorMessage(false)
      return result.verificationGrant
    } catch {
      setCodeConfirmed(false)
      setCodeTryAgain(true)
      setMessage(t.codeInvalid)
      setIsErrorMessage(true)
      setVerificationGrant('')
      return null
    } finally {
      setCodeBusy('idle')
    }
  }

  async function openSession() {
    if (mode === 'forgotPassword') return
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedEmailRepeat = emailRepeat.trim().toLowerCase()
    // Email-repeat match only applies when verifying by email.
    if (mode === 'signUp' && !usePhone && normalizedEmail !== normalizedEmailRepeat) {
      setIsErrorMessage(true)
      setMessage(t.emailMismatch)
      return
    }
    const identifierOk = usePhone ? phone.trim().length >= 8 : Boolean(email.trim())
    // Users routinely fill the code box and click "Open" without first pressing "Confirm code" — so
    // auto-confirm the entered code here. If it fails, confirmCode() already showed "code invalid".
    let confirmed = codeConfirmed
    let activeGrant = verificationGrant
    if (!confirmed && code.trim() && identifierOk) {
      activeGrant = (await confirmCode()) || ''
      confirmed = Boolean(activeGrant)
      if (!confirmed) return
    }
    // Sign-in authorization belongs to the API: normal staff accounts still receive
    // STAFF_OTP_REQUIRED without a valid grant, while explicitly enabled Preview demo accounts
    // may use password-only access. Registration always requires confirmed ownership.
    if (!identifierOk || !password.trim() || (mode === 'signUp' && !confirmed)) {
      setIsErrorMessage(true)
      setMessage(mode === 'signUp' ? t.signUpRequired : t.signInRequired)
      return
    }
    if (mode === 'signUp') {
      // A phone is always required in the form for the phone-verification path. The API only receives
      // the identifier whose OTP was actually confirmed; it must never bind the other, unverified field.
      if (usePhone && !phone.trim()) {
        setIsErrorMessage(true)
        setMessage(t.signUpRequired)
        return
      }
      if (password !== passwordRepeat) {
        setIsErrorMessage(true)
        setMessage(t.passwordMismatch)
        return
      }
    }

    setStatus('loading')
    try {
      await createStaffAccountSession(role, {
        // When verifying by phone, sign in/up by phone (email left empty); otherwise by email.
        email: usePhone ? '' : normalizedEmail,
        password,
        phone: usePhone ? phone.trim() : '',
        partnerType: role === 'HOST' ? partnerType : undefined,
        mode,
        verificationGrant: activeGrant,
      })
      if (role === 'HOST') {
        window.sessionStorage.setItem('sybnb-partner-type', partnerType)
      }
      window.dispatchEvent(new Event('sybnb-session-changed'))
      window.location.hash = returnPath
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
      setIsErrorMessage(true)
    }
  }

  async function submitPasswordReset() {
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedEmailRepeat = emailRepeat.trim().toLowerCase()
    if ((!usePhone && (!email.trim() || normalizedEmail !== normalizedEmailRepeat)) || (usePhone && phone.trim().length < 8) || !newPassword.trim() || !codeConfirmed) {
      setIsErrorMessage(true)
      setMessage(email.trim() && normalizedEmail !== normalizedEmailRepeat ? t.emailMismatch : t.resetRequired)
      return
    }

    setStatus('loading')
    try {
      if (usePhone) await resetPasswordWithPhoneCode(phone.trim(), newPassword, verificationGrant)
      else await resetPasswordWithEmailCode(normalizedEmail, newPassword, verificationGrant)
      setStatus('idle')
      setNewPassword('')
      setIsErrorMessage(false)
      setMessage(t.resetSuccess)
      switchMode('signIn')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
      setIsErrorMessage(true)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.card}>
        <div style={styles.headerRow}>
          <span style={styles.badge}>{role === 'HOST' ? 'PARTNER' : role}</span>
          {role === 'ADMIN' && <span style={styles.adminPill}>{t.adminNoSignup}</span>}
        </div>
        <h1 style={styles.title}>{pageTitle}</h1>
        <p style={styles.body}>{subtitle}</p>

        {mode !== 'forgotPassword' && (
          <div style={{ ...styles.segmented, gridTemplateColumns: canSignUp ? '1fr 1fr' : '1fr' }}>
            <button style={mode === 'signIn' ? styles.segmentActive : styles.segment} onClick={() => switchMode('signIn')}>
              {t.signIn}
            </button>
            {canSignUp && (
              <button style={mode === 'signUp' ? styles.segmentActive : styles.segment} onClick={() => switchMode('signUp')}>
                {t.signUp}
              </button>
            )}
          </div>
        )}

        {role === 'HOST' && mode === 'signUp' && (
          <section style={styles.partnerPanel}>
            <strong>{t.partnerType}</strong>
            <div style={styles.partnerGrid}>
              {partnerOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  style={partnerType === option.id ? styles.partnerOptionActive : styles.partnerOption}
                  onClick={() => setPartnerType(option.id)}
                >
                  <span>{isAr ? option.ar : option.en}</span>
                  <small>{isAr ? option.detailAr : option.detailEn}</small>
                </button>
              ))}
            </div>
          </section>
        )}

        <div style={styles.formGrid}>
          <label style={styles.labelWide}>
            {t.email}
            <input
              style={styles.emailInput}
              value={email}
              type="email"
              name="sybnb-staff-email"
              autoComplete="off"
              placeholder="name@example.com"
              onChange={(event) => updateEmail(event.target.value)}
              dir="ltr"
            />
            <small style={styles.helpText}>{t.emailHelp}</small>
          </label>

          {(mode === 'signUp' || mode === 'forgotPassword') && (
            <label style={styles.labelWide}>
              {t.emailRepeat}
              <input
                style={styles.emailInputSecondary}
                value={emailRepeat}
                type="email"
                name="sybnb-staff-email-confirmation"
                autoComplete="off"
                placeholder="name@example.com"
                onChange={(event) => {
                  setEmailRepeat(event.target.value)
                  setCodeConfirmed(false)
                }}
                dir="ltr"
              />
            </label>
          )}

          {
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }} role="tablist" aria-label={isAr ? 'طريقة التحقق' : 'Verification method'}>
              <button
                type="button"
                style={verifyMethod === 'email' ? styles.methodActive : styles.methodInactive}
                onClick={() => { setVerifyMethod('email'); setCodeSent(false); setCodeConfirmed(false); setCode('') }}
              >
                {t.verifyByEmail}
              </button>
              {phoneOtpEnabled && <button
                type="button"
                style={verifyMethod === 'phone' ? styles.methodActive : styles.methodInactive}
                onClick={() => { setVerifyMethod('phone'); setCodeSent(false); setCodeConfirmed(false); setCode(''); if (!phone.trim()) setPhone('+963') }}
              >
                {t.verifyByPhone}
              </button>}
            </div>
          }

          {usePhone && (
            <label style={styles.labelWide}>
              {t.phone}
              <input
                style={styles.input}
                value={phone}
                inputMode="tel"
                name="sybnb-staff-phone"
                autoComplete="off"
                placeholder="+963..."
                onChange={(event) => { setPhone(event.target.value); setCodeConfirmed(false) }}
                dir="ltr"
              />
            </label>
          )}

          <section style={styles.emailConfirmBox}>
            <div style={styles.confirmHeader}>
              <strong>{usePhone ? t.verifyByPhone : t.confirmEmail}</strong>
              {codeConfirmed && <span style={styles.confirmedPill}>{usePhone ? t.phoneConfirmed : t.codeConfirmed}</span>}
            </div>
            <div style={styles.codeRow}>
              <input
                style={styles.input}
                value={code}
                placeholder="000000"
                name="sybnb-staff-verification-code"
                autoComplete="one-time-code"
                onChange={(event) => {
                  setCode(event.target.value)
                  setCodeConfirmed(false)
                  setCodeTryAgain(false)
                }}
                dir="ltr"
              />
              <button style={styles.codeButton} onClick={() => void sendCode()} disabled={(usePhone ? phone.trim().length < 8 : !email.includes('@')) || codeBusy !== 'idle'}>
                {codeBusy === 'sending' ? t.sendingCode : codeSent ? t.resendCode : usePhone ? t.sendCodePhone : t.sendCode}
              </button>
              <button
                style={{
                  ...styles.codeButton,
                  ...(codeConfirmed ? styles.codeButtonConfirmed : {}),
                  ...(codeTryAgain ? styles.codeButtonError : {}),
                }}
                onClick={() => void confirmCode()}
                disabled={!codeSent || code.trim().length < 4 || codeBusy !== 'idle' || codeConfirmed}
              >
                {codeBusy === 'confirming'
                  ? t.confirmingCode
                  : codeConfirmed
                    ? t.confirmedShort
                    : codeTryAgain
                      ? t.tryAgain
                      : t.confirmCode}
              </button>
            </div>
          </section>

          {mode === 'forgotPassword' ? (
            <label style={styles.labelWide}>
              {t.newPassword}
              <input style={styles.input} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" name="sybnb-new-password" autoComplete="new-password" dir="ltr" />
            </label>
          ) : (
            <>
              <label style={styles.label}>
                {t.password}
                <input style={styles.input} value={password} onChange={(event) => setPassword(event.target.value)} type="password" name="sybnb-staff-password" autoComplete="new-password" dir="ltr" />
              </label>
              {mode === 'signUp' && (
                <label style={styles.label}>
                  {t.repeatPassword}
                  <input
                    style={styles.input}
                    value={passwordRepeat}
                    onChange={(event) => setPasswordRepeat(event.target.value)}
                    type="password"
                    name="sybnb-staff-password-confirmation"
                    autoComplete="new-password"
                    dir="ltr"
                  />
                </label>
              )}
              {mode === 'signUp' && (
                <label style={styles.labelWide}>
                  {t.phone}
                  <input style={styles.input} value={phone} onChange={(event) => setPhone(event.target.value)} name="sybnb-partner-phone" autoComplete="off" dir="ltr" />
                </label>
              )}
            </>
          )}
        </div>

        {devCode && (
          <div style={styles.smsBox}>
            <small>
              {t.demoCode}: <b dir="ltr">{devCode}</b>
            </small>
          </div>
        )}
        {message && <p style={isErrorMessage ? styles.error : styles.note}>{message}</p>}
        {mode === 'forgotPassword' ? (
          <button style={styles.primary} onClick={() => void submitPasswordReset()} disabled={status === 'loading'}>
            {status === 'loading' ? t.resetting : t.resetPasswordCta}
          </button>
        ) : (
          <button style={styles.primary} onClick={() => void openSession()} disabled={status === 'loading'}>
            {status === 'loading' ? t.opening : actionLabel}
          </button>
        )}
        <button style={styles.linkButton} onClick={() => switchMode(mode === 'forgotPassword' ? 'signIn' : 'forgotPassword')}>
          {mode === 'forgotPassword' ? t.backToSignIn : t.forgotPassword}
        </button>
        <p style={styles.noteMuted}>{t.note}</p>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '70vh', display: 'grid', placeItems: 'center', padding: 24, background: '#080a10', color: '#fff' },
  card: { width: 'min(860px, 100%)', border: '1px solid #27324d', borderRadius: 18, background: '#101522', padding: 32, boxShadow: '0 24px 80px rgba(0,0,0,.35)' },
  headerRow: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', marginBottom: 18 },
  badge: { display: 'inline-flex', border: '1px solid #e1b60f', borderRadius: 999, color: '#e1b60f', padding: '8px 14px', fontSize: 13, fontWeight: 800 },
  adminPill: { border: '1px solid rgba(255,255,255,.14)', borderRadius: 999, color: '#aab4ca', padding: '7px 12px', fontSize: 12, fontWeight: 800 },
  title: { margin: 0, fontSize: 38, letterSpacing: 0 },
  body: { color: '#aab4ca', lineHeight: 1.8, margin: '14px 0 24px' },
  primary: { width: '100%', minHeight: 62, border: 0, borderRadius: 12, background: '#4760ff', color: '#fff', fontWeight: 900, fontSize: 19, cursor: 'pointer', marginTop: 18 },
  linkButton: { background: 'transparent', border: 0, color: '#8fa2ff', fontWeight: 800, cursor: 'pointer', marginTop: 12, padding: 0 },
  segmented: { display: 'grid', gap: 8, marginBottom: 18 },
  segment: { minHeight: 52, border: '1px solid #27324d', borderRadius: 12, background: '#0c111d', color: '#aab4ca', fontWeight: 900, cursor: 'pointer' },
  segmentActive: { minHeight: 52, border: '1px solid #4760ff', borderRadius: 12, background: '#18224a', color: '#fff', fontWeight: 900, cursor: 'pointer' },
  partnerPanel: { border: '1px solid rgba(34,210,143,.35)', borderRadius: 14, background: '#081b18', display: 'grid', gap: 14, marginBottom: 18, padding: 16 },
  partnerGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' },
  partnerOption: { background: '#0b1220', border: '1px solid #27324d', borderRadius: 12, color: '#d9e1f5', cursor: 'pointer', display: 'grid', gap: 5, minHeight: 86, padding: 12, textAlign: 'start' },
  partnerOptionActive: { background: '#12372e', border: '1px solid #22d28f', borderRadius: 12, color: '#fff', cursor: 'pointer', display: 'grid', gap: 5, minHeight: 86, padding: 12, textAlign: 'start' },
  formGrid: { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  label: { display: 'grid', gap: 8, color: '#d9e1f5', fontWeight: 800 },
  labelWide: { display: 'grid', gap: 8, color: '#d9e1f5', fontWeight: 800, gridColumn: '1 / -1' },
  emailInput: { minHeight: 68, border: '1px solid #4760ff', borderRadius: 14, background: '#0b1220', color: '#fff', padding: '0 18px', fontSize: 22, fontWeight: 850, width: '100%', boxSizing: 'border-box' },
  emailInputSecondary: { minHeight: 62, border: '1px solid #27324d', borderRadius: 14, background: '#0b1220', color: '#fff', padding: '0 18px', fontSize: 20, fontWeight: 800, width: '100%', boxSizing: 'border-box' },
  input: { minHeight: 52, border: '1px solid #27324d', borderRadius: 12, background: '#0b1220', color: '#fff', padding: '0 14px', fontSize: 17, width: '100%', boxSizing: 'border-box' },
  helpText: { color: '#8f9bb3', fontWeight: 700 },
  emailConfirmBox: { border: '1px solid rgba(255,255,255,.1)', borderRadius: 14, background: '#0c111d', display: 'grid', gap: 12, gridColumn: '1 / -1', padding: 14 },
  confirmHeader: { alignItems: 'center', display: 'flex', gap: 10, justifyContent: 'space-between' },
  confirmedPill: { background: '#08251c', border: '1px solid #22d28f', borderRadius: 999, color: '#22d28f', padding: '6px 10px', fontSize: 12, fontWeight: 900 },
  codeRow: { display: 'grid', gridTemplateColumns: 'minmax(130px, 1fr) auto auto', gap: 8 },
  codeButton: { minHeight: 52, border: '1px solid #22d28f', borderRadius: 12, background: '#08251c', color: '#22d28f', fontWeight: 900, padding: '0 16px', cursor: 'pointer', whiteSpace: 'nowrap' },
  codeButtonConfirmed: { background: '#22d28f', color: '#06110e', border: '1px solid #22d28f' },
  codeButtonError: { background: '#3a0f14', color: '#ff9aa2', border: '1px solid #ff5f76' },
  methodActive: { flex: 1, minHeight: 44, border: '1px solid rgba(82,104,255,.2)', borderRadius: 10, background: '#20212b', color: '#fff', fontWeight: 800, cursor: 'pointer' },
  methodInactive: { flex: 1, minHeight: 44, border: '1px solid transparent', borderRadius: 10, background: 'transparent', color: '#8a90a2', fontWeight: 800, cursor: 'pointer' },
  note: { marginTop: 18, color: '#22d28f', fontWeight: 800 },
  noteMuted: { marginTop: 18, color: '#8f9bb3', fontWeight: 700 },
  error: { marginTop: 18, color: '#ff4d73', fontWeight: 800 },
  smsBox: { border: '1px solid rgba(34, 210, 143, .45)', borderRadius: 12, background: '#071e18', color: '#d9fff1', padding: 14, marginTop: 14, lineHeight: 1.7 },
}
