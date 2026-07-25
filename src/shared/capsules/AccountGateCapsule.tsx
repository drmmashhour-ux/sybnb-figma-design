import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createGuestAccountSession,
  createSellerAccountSession,
  createStaffAccountSession,
  sendEmailVerificationCode,
  sendPhoneVerificationCode,
  verifyEmailVerificationCode,
  verifyPhoneVerificationCode,
  type PlatformAuthSession,
} from '../api/platformApi'
import type { CapsuleActor } from './index'

// Account Gate Capsule (capsules/SYBNB_REUSABLE_CAPSULES.md): "sign up / sign in, phone number,
// verification code, return path." This wraps the same real auth calls GuestAccountPage.tsx already
// uses (no parallel auth system) behind one reusable component parameterized by actor, so a new flow
// doesn't need to hand-roll its own sign-in form. Existing pages are untouched -- this is new
// infrastructure, not a replacement for GuestAccountPage/SellerAccountPage/driver sign-in today.
export type AccountGateCapsuleProps = {
  lang: Lang
  actor: CapsuleActor
  returnPath: string
  onSuccess?: (session: PlatformAuthSession) => void
  // Only read when actor === 'seller' (createSellerAccountSession requires them); reasonable
  // defaults are used if the caller doesn't supply them.
  sellerRole?: string
  planCode?: string
}

const copy = {
  ar: {
    signup: 'إنشاء حساب',
    signin: 'تسجيل الدخول',
    firstName: 'الاسم الأول',
    lastName: 'اسم العائلة',
    email: 'البريد الإلكتروني',
    phone: 'رقم الهاتف',
    password: 'كلمة المرور',
    repeatPassword: 'تأكيد كلمة المرور',
    verifyByEmail: 'التحقق بالبريد',
    verifyByPhone: 'التحقق بالهاتف',
    sendCode: 'إرسال رمز إلى البريد',
    sendCodePhone: 'إرسال رمز SMS',
    resendCode: 'إعادة الإرسال',
    sendingCode: 'جارٍ الإرسال...',
    code: 'رمز التحقق',
    confirmCode: 'تأكيد الرمز',
    confirmingCode: 'جارٍ التأكيد...',
    codeSentReal: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني.',
    codeSentDev: 'بيئة التطوير: الرمز معروض هنا مباشرة للاختبار فقط.',
    codeConfirmed: 'تم تأكيد البريد الإلكتروني.',
    phoneCodeSent: 'تم إرسال رمز التحقق إلى هاتفك عبر SMS.',
    phoneConfirmed: 'تم تأكيد رقم الهاتف.',
    codeInvalid: 'الرمز غير صحيح أو منتهي الصلاحية. اطلب رمزاً جديداً.',
    openAccount: 'فتح الحساب والمتابعة',
    signInAccount: 'تسجيل الدخول والمتابعة',
    error: 'أكمل البيانات المطلوبة، تأكد من كلمة المرور، ثم أرسل رمز البريد الإلكتروني وأكده قبل فتح الحساب.',
    signInNoCodeNote: 'تسجيل الدخول لا يحتاج رمز تحقق -- فقط البريد أو الهاتف وكلمة المرور.',
  },
  en: {
    signup: 'Create account',
    signin: 'Sign in',
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email address',
    phone: 'Phone number',
    password: 'Password',
    repeatPassword: 'Repeat password',
    verifyByEmail: 'Verify by email',
    verifyByPhone: 'Verify by phone',
    sendCode: 'Send code to email',
    sendCodePhone: 'Send SMS code',
    resendCode: 'Resend',
    sendingCode: 'Sending...',
    code: 'Verification code',
    confirmCode: 'Confirm code',
    confirmingCode: 'Confirming...',
    codeSentReal: 'Verification code sent to your email.',
    codeSentDev: 'Dev environment: the code is shown here directly for testing only.',
    codeConfirmed: 'Email confirmed.',
    phoneCodeSent: 'Verification code sent to your phone via SMS.',
    phoneConfirmed: 'Phone number confirmed.',
    codeInvalid: 'That code is wrong or expired. Request a new one.',
    openAccount: 'Open account and continue',
    signInAccount: 'Sign in and continue',
    error: 'Complete the required details, confirm the password, then send and confirm the code before opening the account.',
    signInNoCodeNote: 'Sign-in needs no verification code -- just email/phone and password.',
  },
}

export function AccountGateCapsule({ lang, actor, returnPath, onSuccess, sellerRole, planCode }: AccountGateCapsuleProps) {
  const isAr = lang === 'ar'
  const t = copy[isAr ? 'ar' : 'en']
  // Admin accounts are owner-created (createStaffAccountSession itself refuses an admin sign-up) --
  // lock this actor to sign-in only rather than showing a mode toggle that would just error.
  const canSignUp = actor !== 'admin'
  const [mode, setMode] = useState<'signup' | 'signin'>(canSignUp ? 'signup' : 'signin')
  // `actor` can change after mount (e.g. a caller reusing one capsule instance across a tab switch) --
  // the useState initializer above only runs once, so reset to this actor's default mode whenever
  // actor itself changes, rather than carrying over a stale mode from whichever actor was active before.
  useEffect(() => {
    setMode(canSignUp ? 'signup' : 'signin')
  }, [actor, canSignUp])
  const [verifyMethod, setVerifyMethod] = useState<'email' | 'phone'>('email')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [codeConfirmed, setCodeConfirmed] = useState(false)
  const [codeBusy, setCodeBusy] = useState<'idle' | 'sending' | 'confirming'>('idle')
  const [devCode, setDevCode] = useState('')
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [saving, setSaving] = useState(false)

  // Finding 2 — sign-in verification matches the server: a GUEST signs in with just identifier +
  // password, but STAFF roles (SELLER/HOST/ADMIN/DRIVER/SUPPORT — every non-guest actor here) must
  // pass a real 'staff-login' email/phone OTP on EVERY sign-in (server/routes/auth.mjs), so the code
  // step is shown for them on sign-in too. The "no verification code" note below is therefore only
  // ever shown to a guest, where it is true. Keeps the OTP; the copy now matches the behavior.
  const signInNeedsCode = actor !== 'guest'
  const needsVerification = mode === 'signup' || (mode === 'signin' && signInNeedsCode)

  async function sendCode() {
    setCodeBusy('sending')
    setCodeConfirmed(false)
    setCode('')
    setDevCode('')
    try {
      const result = verifyMethod === 'phone' ? await sendPhoneVerificationCode(phone.trim()) : await sendEmailVerificationCode(email.trim())
      setCodeSent(true)
      if (result.devCode) {
        setDevCode(result.devCode)
        setMessage(t.codeSentDev)
        setIsError(false)
      } else {
        setMessage(verifyMethod === 'phone' ? t.phoneCodeSent : t.codeSentReal)
        setIsError(false)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
      setIsError(true)
    } finally {
      setCodeBusy('idle')
    }
  }

  async function confirmCode() {
    setCodeBusy('confirming')
    try {
      if (verifyMethod === 'phone') await verifyPhoneVerificationCode(phone.trim(), code.trim())
      else await verifyEmailVerificationCode(email.trim(), code.trim())
      setCodeConfirmed(true)
      setMessage(verifyMethod === 'phone' ? t.phoneConfirmed : t.codeConfirmed)
      setIsError(false)
    } catch {
      setCodeConfirmed(false)
      setMessage(t.codeInvalid)
      setIsError(true)
    } finally {
      setCodeBusy('idle')
    }
  }

  async function submit() {
    const identifierOk = verifyMethod === 'phone' ? phone.trim().length >= 8 : email.includes('@')
    const signupMissing = mode === 'signup' && (password !== repeatPassword || password.length < 8)
    if (signupMissing || !identifierOk || password.length < 8 || (needsVerification && !codeConfirmed)) {
      setMessage(t.error)
      setIsError(true)
      return
    }

    setSaving(true)
    try {
      let session: PlatformAuthSession
      if (actor === 'host') {
        session = await createStaffAccountSession('HOST', { email: email.trim(), phone: phone.trim(), password, mode: mode === 'signup' ? 'signUp' : 'signIn' })
      } else if (actor === 'admin') {
        session = await createStaffAccountSession('ADMIN', { email: email.trim(), phone: phone.trim(), password, mode: 'signIn' })
      } else if (actor === 'seller') {
        session = await createSellerAccountSession({
          displayName: displayName.trim() || [firstName, lastName].filter(Boolean).join(' ').trim() || 'SYBNB Seller',
          email: email.trim(),
          password,
          phone: phone.trim() || undefined,
          sellerRole: sellerRole || 'individual',
          planCode: planCode || 'basic',
        })
      } else {
        // guest | renter | buyer | advertiser all share the one GUEST backend role.
        session = await createGuestAccountSession({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          password,
        })
      }
      onSuccess?.(session)
      window.location.hash = returnPath
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
      setIsError(true)
    } finally {
      setSaving(false)
    }
  }

  const showNameFields = mode === 'signup' && actor !== 'seller'

  return (
    <section dir={isAr ? 'rtl' : 'ltr'} style={styles.panel}>
      {canSignUp && (
        <div style={styles.modeSwitch} role="tablist" aria-label={isAr ? 'نوع الحساب' : 'Account mode'}>
          <button style={mode === 'signup' ? styles.modeButtonActive : styles.modeButton} onClick={() => setMode('signup')} type="button">
            {t.signup}
          </button>
          <button style={mode === 'signin' ? styles.modeButtonActive : styles.modeButton} onClick={() => setMode('signin')} type="button">
            {t.signin}
          </button>
        </div>
      )}

      <div style={styles.formGrid}>
        {showNameFields && (
          <>
            <input style={styles.input} value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder={t.firstName} />
            <input style={styles.input} value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder={t.lastName} />
          </>
        )}
        {mode === 'signup' && actor === 'seller' && (
          <input style={{ ...styles.input, gridColumn: '1 / -1' }} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t.firstName} />
        )}
        <input
          dir="ltr"
          style={styles.input}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            setCodeSent(false)
            setCodeConfirmed(false)
          }}
          placeholder={t.email}
        />
        <input dir="ltr" inputMode="tel" style={styles.input} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t.phone} />
        <input style={styles.input} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t.password} />
        {mode === 'signup' && (
          <input style={styles.input} type="password" value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} placeholder={t.repeatPassword} />
        )}
      </div>

      {needsVerification ? (
        <>
          <div style={styles.modeSwitch} role="tablist" aria-label={isAr ? 'طريقة التحقق' : 'Verification method'}>
            <button
              style={verifyMethod === 'email' ? styles.modeButtonActive : styles.modeButton}
              type="button"
              onClick={() => { setVerifyMethod('email'); setCodeSent(false); setCodeConfirmed(false); setCode('') }}
            >
              {t.verifyByEmail}
            </button>
            <button
              style={verifyMethod === 'phone' ? styles.modeButtonActive : styles.modeButton}
              type="button"
              onClick={() => { setVerifyMethod('phone'); setCodeSent(false); setCodeConfirmed(false); setCode('') }}
            >
              {t.verifyByPhone}
            </button>
          </div>
          <div style={styles.codeRow}>
            <button
              style={styles.secondaryButton}
              type="button"
              onClick={() => void sendCode()}
              disabled={(verifyMethod === 'phone' ? phone.trim().length < 8 : !email.includes('@')) || codeBusy !== 'idle'}
            >
              {codeBusy === 'sending' ? t.sendingCode : codeSent ? t.resendCode : verifyMethod === 'phone' ? t.sendCodePhone : t.sendCode}
            </button>
            <input
              dir="ltr"
              inputMode="numeric"
              style={styles.input}
              value={code}
              onChange={(event) => {
                setCode(event.target.value)
                setCodeConfirmed(false)
              }}
              placeholder={t.code}
            />
            <button
              style={styles.secondaryButton}
              type="button"
              disabled={!codeSent || code.trim().length < 4 || codeBusy !== 'idle'}
              onClick={() => void confirmCode()}
            >
              {codeConfirmed ? '✓' : codeBusy === 'confirming' ? t.confirmingCode : t.confirmCode}
            </button>
          </div>
          {import.meta.env.DEV && devCode && (
            <p style={styles.notice} dir="ltr">
              DEV CODE: <strong>{devCode}</strong>
            </p>
          )}
        </>
      ) : (
        <p style={styles.notice}>{t.signInNoCodeNote}</p>
      )}

      {message && (
        <strong role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} style={isError ? styles.error : styles.success}>
          {message}
        </strong>
      )}

      <button style={styles.primaryButton} type="button" onClick={() => void submit()} disabled={saving}>
        {saving ? '...' : mode === 'signup' ? t.openAccount : t.signInAccount}
      </button>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: { display: 'grid', gap: 16, textAlign: 'start' },
  formGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  modeSwitch: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4, border: '1px solid #202334', borderRadius: 14, padding: 5, background: '#111118' },
  modeButton: { minHeight: 46, border: '1px solid transparent', borderRadius: 12, background: 'transparent', color: '#6f7485', fontWeight: 950, padding: '0 12px' },
  modeButtonActive: { minHeight: 46, border: '1px solid rgba(82,104,255,.12)', borderRadius: 12, background: '#20212b', color: '#fff', fontWeight: 950, padding: '0 12px' },
  codeRow: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' },
  input: { minHeight: 50, border: '1px solid #232638', borderRadius: 13, background: '#111118', color: '#fff', padding: '0 14px', fontWeight: 800 },
  primaryButton: { minHeight: 54, border: 0, borderRadius: 12, background: '#4760ff', color: '#fff', fontWeight: 950, padding: '0 16px', fontSize: 16 },
  secondaryButton: { minHeight: 50, border: '1px solid #30384d', borderRadius: 12, background: '#111118', color: '#fff', fontWeight: 900, padding: '0 14px' },
  notice: { border: '1px solid rgba(82,104,255,.45)', borderRadius: 8, background: 'rgba(82,104,255,.1)', color: '#dce3ff', padding: 12, margin: 0, lineHeight: 1.6, fontWeight: 850 },
  success: { color: '#20d29b' },
  error: { color: '#ff8f9f' },
}
