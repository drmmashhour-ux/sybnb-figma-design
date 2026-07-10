import React, { useMemo, useState } from 'react'

type Lang = 'ar' | 'en'
type Mode = 'signup' | 'signin'

type GiftRecipientLandingProps = {
  lang?: Lang
  amount?: string
  senderName?: string
  codeLast4?: string
  onContinue?: (payload: { mode: Mode; phone: string }) => void
}

const T = {
  ar: {
    brand: 'SYBNB Wallet',
    title: 'استلام هدية رصيد',
    subtitle: 'هذه الهدية مقفلة على رقم الهاتف الذي استلم الرابط.',
    locked: 'مقفلة للمستلم',
    amount: 'قيمة الهدية',
    from: 'من',
    last4: 'آخر 4 رموز',
    signup: 'إنشاء حساب',
    signin: 'تسجيل الدخول',
    phone: 'رقم الهاتف',
    phonePlaceholder: '+963 9XX XXX XXX',
    password: 'كلمة المرور',
    repeatPassword: 'تأكيد كلمة المرور',
    sendCode: 'إرسال رمز التحقق',
    resendCode: 'إعادة إرسال الرمز',
    code: 'رمز التحقق',
    securityError: 'أدخل كلمة المرور وتأكيدها ورمز التحقق قبل المتابعة.',
    phoneNote: 'يجب استخدام نفس رقم الهاتف الذي استلم الهدية',
    noSell: 'لا يمكن بيع أو تحويل الهدية إلى رقم آخر',
    walletNote: 'إذا لم يكن لديك محفظة، سيتم إنشاؤها تلقائياً بعد التحقق.',
    securityTitle: 'حماية الهدية',
    securityOne: 'الرصيد يدخل إلى محفظة الرقم المطابق فقط.',
    securityTwo: 'لن تطلب SYBNB هذا الرمز منك أبداً.',
    cta: 'التالي — إدخال رمز التحقق',
  },
  en: {
    brand: 'SYBNB Wallet',
    title: 'Claim Gift Credit',
    subtitle: 'This gift is locked to the phone number that received the link.',
    locked: 'Locked to recipient',
    amount: 'Gift amount',
    from: 'From',
    last4: 'Last 4',
    signup: 'Create account',
    signin: 'Sign in',
    phone: 'Phone number',
    phonePlaceholder: '+963 9XX XXX XXX',
    password: 'Password',
    repeatPassword: 'Repeat password',
    sendCode: 'Send verification code',
    resendCode: 'Resend code',
    code: 'Verification code',
    securityError: 'Enter password, repeated password, and verification code before continuing.',
    phoneNote: 'Use the same phone number that received this gift',
    noSell: 'This gift cannot be sold or moved to another number',
    walletNote: 'If you do not have a wallet, one will be created after verification.',
    securityTitle: 'Gift protection',
    securityOne: 'Credit lands only in the wallet for the matching phone.',
    securityTwo: 'SYBNB will never ask you for this code.',
    cta: 'Next — enter verification code',
  },
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0a0a0f',
    color: '#f7f7fb',
    padding: 20,
    fontFamily: '"Cairo", "Tajawal", Inter, sans-serif',
  },
  wrap: { maxWidth: 480, margin: '0 auto', paddingBottom: 40 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  brand: { color: '#4f6cff', fontWeight: 900, letterSpacing: 0 },
  chip: {
    minHeight: 44,
    borderRadius: 999,
    border: '1px solid rgba(213,169,21,.38)',
    background: 'rgba(213,169,21,.12)',
    color: '#d5a915',
    padding: '7px 12px',
    fontSize: 13,
    fontWeight: 800,
  },
  card: {
    borderRadius: 22,
    border: '1px solid #1e1e2a',
    background: 'linear-gradient(145deg,#171b29,#101522)',
    padding: 20,
    boxShadow: '0 22px 80px rgba(0,0,0,.28)',
  },
  giftCard: {
    margin: '18px 0',
    borderRadius: 20,
    padding: 18,
    background: 'linear-gradient(135deg,#2a1e00,#111118 55%,#0a0a0f)',
    border: '1px solid rgba(213,169,21,.42)',
  },
  modeGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 },
  modeButton: {
    minHeight: 52,
    borderRadius: 14,
    border: '1px solid #2c3448',
    background: '#111827',
    color: '#aeb8ca',
    fontWeight: 900,
    fontSize: 15,
  },
  modeActive: { borderColor: '#4f6cff', background: '#1c2a55', color: '#fff' },
  label: { display: 'block', marginBottom: 8, color: '#9aa6ba', fontSize: 13, fontWeight: 800 },
  input: {
    width: '100%',
    minHeight: 52,
    borderRadius: 14,
    border: '1px solid #2c3448',
    background: '#0d1320',
    color: '#fff',
    padding: '0 14px',
    fontSize: 16,
    boxSizing: 'border-box' as const,
  },
  securityGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 },
  secondaryCta: {
    minHeight: 52,
    borderRadius: 14,
    border: '1px solid #2c3448',
    background: '#111827',
    color: '#fff',
    fontWeight: 900,
  },
  error: { color: '#ffabab', display: 'block', fontSize: 13, marginTop: 10 },
  note: {
    borderRadius: 14,
    border: '1px solid rgba(79,108,255,.3)',
    background: 'rgba(79,108,255,.10)',
    color: '#bfcaee',
    padding: 12,
    fontSize: 13,
    lineHeight: 1.7,
    marginTop: 12,
  },
  cta: {
    width: '100%',
    minHeight: 56,
    borderRadius: 16,
    border: 0,
    background: 'linear-gradient(135deg,#4f6cff,#19d7ff)',
    color: '#fff',
    fontWeight: 900,
    fontSize: 16,
    marginTop: 16,
  },
}

export function GiftRecipientLanding({
  lang = 'ar',
  amount,
  senderName = 'Mohamed Mashhour',
  codeLast4 = '9A4F',
  onContinue,
}: GiftRecipientLandingProps) {
  const [mode, setMode] = useState<Mode>('signup')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const isAr = lang === 'ar'
  const t = T[lang]
  const amountText = amount || (isAr ? '٥٠٬٠٠٠ ل.س' : '50,000 SYP')

  const canContinue = useMemo(() => {
    if (phone.trim().length < 8 || !codeSent || code.trim().length < 4) return false
    if (mode === 'signin') return true
    return password.length >= 8 && password === repeatPassword
  }, [code, codeSent, mode, password, phone, repeatPassword])

  const continueSecurely = () => {
    if (!canContinue) {
      setError(t.securityError)
      return
    }

    setError('')
    onContinue?.({ mode, phone })
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.wrap}>
        <header style={styles.header}>
          <div style={styles.brand}>{t.brand}</div>
          <div style={styles.chip}>{t.locked}</div>
        </header>

        <div style={styles.card}>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.2 }}>{t.title}</h1>
          <p style={{ color: '#9aa6ba', lineHeight: 1.7 }}>{t.subtitle}</p>

          <div style={styles.giftCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#9aa6ba', fontSize: 13 }}>{t.amount}</span>
              <strong dir={isAr ? 'rtl' : 'ltr'} style={{ color: '#d5a915', fontSize: 24 }}>{amountText}</strong>
            </div>
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ color: '#9aa6ba', fontSize: 12 }}>{t.from}</div>
                <strong>{senderName}</strong>
              </div>
              <div>
                <div style={{ color: '#9aa6ba', fontSize: 12 }}>{t.last4}</div>
                <strong dir="ltr">••••{codeLast4}</strong>
              </div>
            </div>
          </div>

          <div style={styles.modeGrid}>
            <button
              type="button"
              onClick={() => setMode('signup')}
              style={{ ...styles.modeButton, ...(mode === 'signup' ? styles.modeActive : {}) }}
            >
              {t.signup}
            </button>
            <button
              type="button"
              onClick={() => setMode('signin')}
              style={{ ...styles.modeButton, ...(mode === 'signin' ? styles.modeActive : {}) }}
            >
              {t.signin}
            </button>
          </div>

          <label style={styles.label}>{t.phone}</label>
          <input
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value)
              setCodeSent(false)
              setCode('')
            }}
            placeholder={t.phonePlaceholder}
            inputMode="tel"
            style={styles.input}
          />

          {mode === 'signup' && (
            <div style={styles.securityGrid}>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t.password}
                type="password"
                style={styles.input}
              />
              <input
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
                placeholder={t.repeatPassword}
                type="password"
                style={styles.input}
              />
            </div>
          )}

          <div style={styles.securityGrid}>
            <button
              type="button"
              disabled={phone.trim().length < 8}
              onClick={() => {
                setCodeSent(true)
                setCode('')
              }}
              style={{ ...styles.secondaryCta, opacity: phone.trim().length >= 8 ? 1 : 0.45 }}
            >
              {codeSent ? t.resendCode : t.sendCode}
            </button>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={t.code}
              inputMode="numeric"
              style={styles.input}
            />
          </div>
          {error ? <strong style={styles.error}>{error}</strong> : null}

          <div style={styles.note}>
            <strong>{t.phoneNote}</strong>
            <br />
            {t.noSell}
            <br />
            {t.walletNote}
          </div>

          <div style={{ ...styles.note, borderColor: 'rgba(213,169,21,.35)', background: 'rgba(213,169,21,.10)' }}>
            <strong>{t.securityTitle}</strong>
            <br />
            {t.securityOne}
            <br />
            {t.securityTwo}
          </div>

          <button
            type="button"
            disabled={!canContinue}
            onClick={continueSecurely}
            style={{ ...styles.cta, opacity: canContinue ? 1 : 0.45 }}
          >
            {t.cta}
          </button>
        </div>
      </section>
    </main>
  )
}

export default GiftRecipientLanding
