import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createGuestAccountSession,
  resetPasswordWithEmailCode,
  sendEmailVerificationCode,
  signIn,
  verifyEmailVerificationCode,
} from '../../shared/api/platformApi'

// Unified Sign in / Sign up panel surfaced from the top nav. Sign-up always creates a GUEST account
// (hosting is a later "Become a host" upgrade); sign-in routes by role via the parent's onAuthed.
type Props = {
  lang: Lang
  onClose: () => void
  onAuthed: (roles: string[]) => void
}

const T = {
  ar: {
    welcome: 'مرحباً بك في SYBNB',
    subtitle: 'سجّل الدخول أو أنشئ حساباً لمتابعة رحلاتك ولوحتك.',
    signIn: 'تسجيل الدخول',
    signUp: 'إنشاء حساب',
    firstName: 'الاسم الأول',
    lastName: 'الكنية',
    email: 'البريد الإلكتروني',
    repeatEmail: 'أعد إدخال البريد الإلكتروني',
    password: 'كلمة المرور',
    confirmPassword: 'تأكيد كلمة المرور',
    code: 'رمز التحقق',
    sendCode: 'إرسال رمز التحقق',
    resend: 'إعادة إرسال الرمز',
    create: 'إنشاء الحساب',
    doSignIn: 'دخول',
    haveAccount: 'لديك حساب؟ سجّل الدخول',
    noAccount: 'ليس لديك حساب؟ أنشئ حساباً',
    close: 'إغلاق',
    codeSent: 'أرسلنا رمزاً إلى بريدك. تحقق من صندوق الوارد (وربما البريد المزعج).',
    emailMismatch: 'البريد الإلكتروني غير متطابق.',
    passwordMismatch: 'كلمتا المرور غير متطابقتين.',
    fillAll: 'يرجى تعبئة جميع الحقول.',
    enterCode: 'أدخل رمز التحقق المرسل إلى بريدك.',
    forgot: 'نسيت كلمة المرور؟',
    resetTitle: 'إعادة تعيين كلمة المرور',
    newPassword: 'كلمة المرور الجديدة',
    resetCta: 'تحديث كلمة المرور',
    resetDone: 'تم تحديث كلمة المرور. سجّل الدخول الآن.',
    backToSignIn: 'العودة لتسجيل الدخول',
  },
  en: {
    welcome: 'Welcome to SYBNB',
    subtitle: 'Sign in or create an account to follow your trips and dashboard.',
    signIn: 'Sign in',
    signUp: 'Create account',
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email',
    repeatEmail: 'Repeat email',
    password: 'Password',
    confirmPassword: 'Confirm password',
    code: 'Verification code',
    sendCode: 'Send code',
    resend: 'Resend code',
    create: 'Create account',
    doSignIn: 'Sign in',
    haveAccount: 'Have an account? Sign in',
    noAccount: 'No account? Create one',
    close: 'Close',
    codeSent: 'We sent a code to your email. Check your inbox (and spam).',
    emailMismatch: 'The emails do not match.',
    passwordMismatch: 'The passwords do not match.',
    fillAll: 'Please fill in all fields.',
    enterCode: 'Enter the code we sent to your email.',
    forgot: 'Forgot password?',
    resetTitle: 'Reset your password',
    newPassword: 'New password',
    resetCta: 'Update password',
    resetDone: 'Password updated. Sign in now.',
    backToSignIn: 'Back to sign in',
  },
}

export function AuthPanel({ lang, onClose, onAuthed }: Props) {
  const t = T[lang]
  const isAr = lang === 'ar'
  const [mode, setMode] = useState<'signIn' | 'signUp' | 'forgot'>('signIn')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [repeatEmail, setRepeatEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const clearMessages = () => {
    setError('')
    setMessage('')
  }

  function switchMode(next: 'signIn' | 'signUp' | 'forgot') {
    setMode(next)
    setCodeSent(false)
    setCode('')
    clearMessages()
  }

  async function handleSendResetCode() {
    clearMessages()
    if (!email.trim()) {
      setError(t.fillAll)
      return
    }
    setBusy(true)
    try {
      await sendEmailVerificationCode(email.trim(), 'password-reset')
      setCodeSent(true)
      setMessage(t.codeSent)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code')
    } finally {
      setBusy(false)
    }
  }

  async function handleReset(event: FormEvent) {
    event.preventDefault()
    clearMessages()
    if (!code.trim()) {
      setError(t.enterCode)
      return
    }
    if (!password || password !== confirmPassword) {
      setError(t.passwordMismatch)
      return
    }
    setBusy(true)
    try {
      await verifyEmailVerificationCode(email.trim(), code.trim(), 'password-reset')
      await resetPasswordWithEmailCode(email.trim(), password)
      setMode('signIn')
      setCodeSent(false)
      setCode('')
      setPassword('')
      setConfirmPassword('')
      setMessage(t.resetDone)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password')
    } finally {
      setBusy(false)
    }
  }

  async function handleSignIn(event: FormEvent) {
    event.preventDefault()
    clearMessages()
    if (!email.trim() || !password) {
      setError(t.fillAll)
      return
    }
    setBusy(true)
    try {
      const session = await signIn(email, password)
      onAuthed(session.user.roles || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleSendCode() {
    clearMessages()
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      setError(t.fillAll)
      return
    }
    if (email.trim().toLowerCase() !== repeatEmail.trim().toLowerCase()) {
      setError(t.emailMismatch)
      return
    }
    if (password !== confirmPassword) {
      setError(t.passwordMismatch)
      return
    }
    setBusy(true)
    try {
      await sendEmailVerificationCode(email.trim(), 'guest-signup')
      setCodeSent(true)
      setMessage(t.codeSent)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code')
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    clearMessages()
    if (!code.trim()) {
      setError(t.enterCode)
      return
    }
    setBusy(true)
    try {
      await verifyEmailVerificationCode(email.trim(), code.trim(), 'guest-signup')
      const session = await createGuestAccountSession({ firstName, lastName, email, password })
      onAuthed(session.user.roles || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={styles.overlay} dir={isAr ? 'rtl' : 'ltr'} onClick={onClose}>
      <div style={styles.panel} onClick={(event) => event.stopPropagation()}>
        <button style={styles.closeBtn} onClick={onClose} aria-label={t.close}>×</button>
        <h2 style={styles.title}>{t.welcome}</h2>
        <p style={styles.subtitle}>{t.subtitle}</p>

        <div style={styles.tabs}>
          <button type="button" style={mode === 'signIn' ? styles.tabActive : styles.tab} onClick={() => switchMode('signIn')}>{t.signIn}</button>
          <button type="button" style={mode === 'signUp' ? styles.tabActive : styles.tab} onClick={() => switchMode('signUp')}>{t.signUp}</button>
        </div>

        {mode === 'signIn' ? (
          <form style={styles.form} onSubmit={handleSignIn}>
            <input style={styles.inputWide} type="email" dir="ltr" placeholder={t.email} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            <input style={styles.input} type="password" placeholder={t.password} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            {message && <p style={styles.message}>{message}</p>}
            {error && <p style={styles.error}>{error}</p>}
            <button style={styles.primary} disabled={busy} type="submit">{busy ? '…' : t.doSignIn}</button>
            <button type="button" style={styles.link} onClick={() => switchMode('forgot')}>{t.forgot}</button>
            <button type="button" style={styles.link} onClick={() => switchMode('signUp')}>{t.noAccount}</button>
          </form>
        ) : mode === 'forgot' ? (
          <form style={styles.form} onSubmit={handleReset}>
            <p style={{ ...styles.subtitle, margin: '0 0 2px' }}>{t.resetTitle}</p>
            <input style={styles.inputWide} type="email" dir="ltr" placeholder={t.email} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            {codeSent && (
              <>
                <input style={styles.inputWide} inputMode="numeric" dir="ltr" placeholder={t.code} value={code} onChange={(event) => setCode(event.target.value)} />
                <div style={styles.row2}>
                  <input style={styles.input} type="password" placeholder={t.newPassword} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
                  <input style={styles.input} type="password" placeholder={t.confirmPassword} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
                </div>
              </>
            )}
            {message && <p style={styles.message}>{message}</p>}
            {error && <p style={styles.error}>{error}</p>}
            {!codeSent ? (
              <button style={styles.primary} disabled={busy} type="button" onClick={handleSendResetCode}>{busy ? '…' : t.sendCode}</button>
            ) : (
              <>
                <button style={styles.primary} disabled={busy} type="submit">{busy ? '…' : t.resetCta}</button>
                <button type="button" style={styles.link} disabled={busy} onClick={handleSendResetCode}>{t.resend}</button>
              </>
            )}
            <button type="button" style={styles.link} onClick={() => switchMode('signIn')}>{t.backToSignIn}</button>
          </form>
        ) : (
          <form style={styles.form} onSubmit={handleCreate}>
            <div style={styles.row2}>
              <input style={styles.input} placeholder={t.firstName} value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" />
              <input style={styles.input} placeholder={t.lastName} value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" />
            </div>
            <input style={styles.inputWide} type="email" dir="ltr" placeholder={t.email} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            <input style={styles.inputWide} type="email" dir="ltr" placeholder={t.repeatEmail} value={repeatEmail} onChange={(event) => setRepeatEmail(event.target.value)} />
            <div style={styles.row2}>
              <input style={styles.input} type="password" placeholder={t.password} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
              <input style={styles.input} type="password" placeholder={t.confirmPassword} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
            </div>
            {codeSent && (
              <input style={styles.inputWide} inputMode="numeric" dir="ltr" placeholder={t.code} value={code} onChange={(event) => setCode(event.target.value)} />
            )}
            {message && <p style={styles.message}>{message}</p>}
            {error && <p style={styles.error}>{error}</p>}
            {!codeSent ? (
              <button style={styles.primary} disabled={busy} type="button" onClick={handleSendCode}>{busy ? '…' : t.sendCode}</button>
            ) : (
              <>
                <button style={styles.primary} disabled={busy} type="submit">{busy ? '…' : t.create}</button>
                <button type="button" style={styles.link} disabled={busy} onClick={handleSendCode}>{t.resend}</button>
              </>
            )}
            <button type="button" style={styles.link} onClick={() => switchMode('signIn')}>{t.haveAccount}</button>
          </form>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(4,6,12,.72)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: 16, overflowY: 'auto' },
  panel: { position: 'relative', width: '100%', maxWidth: 460, background: '#111522', border: '1px solid #2a3350', borderRadius: 22, padding: '28px 24px', color: '#fff', boxShadow: '0 30px 80px rgba(0,0,0,.5)' },
  closeBtn: { position: 'absolute', top: 14, insetInlineEnd: 14, width: 38, height: 38, borderRadius: 999, border: '1px solid #2a3350', background: '#171b29', color: '#fff', fontSize: 22, cursor: 'pointer', lineHeight: 1 },
  title: { margin: '0 0 4px', fontSize: 24 },
  subtitle: { margin: '0 0 18px', color: '#9aa6ba', fontSize: 14 },
  tabs: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: '#0d1220', border: '1px solid #242b3e', borderRadius: 14, padding: 5, marginBottom: 16 },
  tab: { minHeight: 44, border: 0, borderRadius: 10, background: 'transparent', color: '#9aa6ba', fontWeight: 900, cursor: 'pointer' },
  tabActive: { minHeight: 44, border: 0, borderRadius: 10, background: '#4f6cff', color: '#fff', fontWeight: 900, cursor: 'pointer' },
  form: { display: 'grid', gap: 12 },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  input: { minHeight: 52, border: '1px solid #30384d', borderRadius: 12, background: '#0d1320', color: '#fff', padding: '0 14px', fontSize: 15, fontWeight: 600 },
  inputWide: { minHeight: 56, border: '1px solid #30384d', borderRadius: 12, background: '#0d1320', color: '#fff', padding: '0 16px', fontSize: 16, fontWeight: 700, letterSpacing: '.3px', width: '100%' },
  primary: { minHeight: 54, border: 0, borderRadius: 12, background: '#20d29b', color: '#06110e', fontWeight: 950, fontSize: 17, cursor: 'pointer' },
  link: { border: 0, background: 'transparent', color: '#8ea0ff', fontWeight: 800, cursor: 'pointer', fontSize: 14 },
  error: { margin: 0, color: '#ffabab', fontSize: 14, fontWeight: 700 },
  message: { margin: 0, color: '#9fffe1', fontSize: 14, fontWeight: 700 },
}
