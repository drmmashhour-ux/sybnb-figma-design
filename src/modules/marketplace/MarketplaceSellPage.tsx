import { useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { createAndSubmitMarketplaceListing, getStoredSellerSession, getStoredStaffSession } from '../../shared/api/platformApi'
import { MARKETPLACE_CATEGORIES, MARKETPLACE_CONDITIONS } from '../../shared/marketplace/categories'

// Facebook-style quick-list "Sell something" flow — free MARKETPLACE (goods) listing.
const copy = {
  ar: {
    back: 'العودة للسوق',
    title: 'بيع شيء ما',
    subtitle: 'أدرج سلعتك مجانًا. تُراجع الإعلانات قبل نشرها.',
    titleField: 'العنوان',
    price: 'السعر',
    currency: 'العملة',
    category: 'الفئة',
    condition: 'الحالة',
    city: 'المدينة',
    description: 'الوصف (اختياري)',
    photo: 'صورة السلعة',
    photoHint: 'صورة واحدة على الأقل مطلوبة.',
    submit: 'نشر الإعلان',
    submitting: 'جار النشر...',
    success: 'تم إرسال إعلانك للمراجعة! سيظهر في السوق بعد الموافقة.',
    missing: 'يرجى إكمال العنوان والسعر والفئة والحالة والمدينة وإضافة صورة.',
    signInNeeded: 'سجّل الدخول كبائع أولاً لنشر إعلان.',
    signInCta: 'الدخول كبائع',
    genericError: 'تعذر نشر الإعلان، حاول مجددًا.',
  },
  en: {
    back: 'Back to marketplace',
    title: 'Sell something',
    subtitle: 'List your item for free. Listings are reviewed before going live.',
    titleField: 'Title',
    price: 'Price',
    currency: 'Currency',
    category: 'Category',
    condition: 'Condition',
    city: 'City',
    description: 'Description (optional)',
    photo: 'Item photo',
    photoHint: 'At least one photo is required.',
    submit: 'Publish listing',
    submitting: 'Publishing…',
    success: 'Your listing was submitted for review! It appears in the marketplace once approved.',
    missing: 'Please complete title, price, category, condition, city, and add a photo.',
    signInNeeded: 'Sign in as a seller first to publish a listing.',
    signInCta: 'Sign in as seller',
    genericError: 'Could not publish the listing. Please try again.',
  },
}

function fileToBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve({ base64, mime: file.type || 'image/jpeg' })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function MarketplaceSellPage({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const t = isAr ? copy.ar : copy.en
  const [form, setForm] = useState({
    titleAr: '', priceMinor: '', currency: 'SYP',
    category: MARKETPLACE_CATEGORIES[0].id, condition: MARKETPLACE_CONDITIONS[0].id,
    city: '', description: '',
  })
  const [photo, setPhoto] = useState<{ base64: string; mime: string } | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle')
  const [error, setError] = useState('')
  const staffSession = getStoredStaffSession()
  const sellerSession = getStoredSellerSession() || (staffSession?.user.roles.some((role) => role === 'SELLER' || role === 'HOST') ? staffSession : null)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }))

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setPhoto(await fileToBase64(file))
  }

  async function submit() {
    const price = Number(form.priceMinor)
    if (!form.titleAr.trim() || !Number.isFinite(price) || price <= 0 || !form.city.trim() || !photo) {
      setError(t.missing)
      return
    }
    setState('saving')
    setError('')
    try {
      await createAndSubmitMarketplaceListing({
        titleAr: form.titleAr.trim(),
        priceMinor: Math.round(price),
        currency: form.currency,
        category: form.category,
        condition: form.condition,
        city: form.city.trim(),
        description: form.description.trim() || undefined,
        photoBase64: photo.base64,
        photoMimeType: photo.mime,
      })
      setState('done')
    } catch (err) {
      setState('idle')
      const msg = err instanceof Error && err.message ? err.message : t.genericError
      setError(/seller|session|sign in/i.test(msg) ? t.signInNeeded : msg)
    }
  }

  if (!sellerSession) {
    return (
      <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
        <button style={styles.back} onClick={() => (window.location.hash = '/marketplace')}>{t.back}</button>
        <div style={styles.card} role="status">
          <h1 style={styles.title}>{t.title}</h1>
          <p style={styles.subtitle}>{t.signInNeeded}</p>
          <button style={styles.primary} onClick={() => (window.location.hash = '/sell/account')}>{t.signInCta}</button>
        </div>
      </main>
    )
  }

  if (state === 'done') {
    return (
      <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
        <p style={styles.success}>{t.success}</p>
        <button style={styles.primary} onClick={() => (window.location.hash = '/marketplace')}>{t.back}</button>
      </main>
    )
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/marketplace')}>{t.back}</button>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      <div style={styles.card}>
        <Field label={t.titleField}><input style={styles.input} value={form.titleAr} onChange={set('titleAr')} /></Field>
        <div style={styles.row}>
          <Field label={t.price}><input style={styles.input} type="number" inputMode="numeric" value={form.priceMinor} onChange={set('priceMinor')} /></Field>
          <Field label={t.currency}>
            <select style={styles.input} value={form.currency} onChange={set('currency')}>
              <option value="SYP">SYP</option><option value="USD">USD</option>
            </select>
          </Field>
        </div>
        <Field label={t.category}>
          <select style={styles.input} value={form.category} onChange={set('category')}>
            {MARKETPLACE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.icon} {isAr ? c.ar : c.en}</option>)}
          </select>
        </Field>
        <div style={styles.row}>
          <Field label={t.condition}>
            <select style={styles.input} value={form.condition} onChange={set('condition')}>
              {MARKETPLACE_CONDITIONS.map((c) => <option key={c.id} value={c.id}>{isAr ? c.ar : c.en}</option>)}
            </select>
          </Field>
          <Field label={t.city}><input style={styles.input} value={form.city} onChange={set('city')} /></Field>
        </div>
        <Field label={t.description}><textarea style={{ ...styles.input, minHeight: 80 }} value={form.description} onChange={set('description')} /></Field>
        <Field label={t.photo}>
          <input style={styles.input} type="file" accept="image/*" onChange={onPhoto} />
          <span style={styles.hint}>{photo ? '✓' : t.photoHint}</span>
        </Field>
        {error && (
          <div>
            <p style={styles.error} role="alert">{error}</p>
            {error === t.signInNeeded && <button style={styles.linkButton} onClick={() => (window.location.hash = '/sell/account')}>{t.signInCta}</button>}
          </div>
        )}
        <button style={styles.primary} disabled={state === 'saving'} onClick={() => void submit()}>
          {state === 'saving' ? t.submitting : t.submit}
        </button>
      </div>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={styles.field}><span style={styles.fieldLabel}>{label}</span>{children}</label>
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 560, margin: '0 auto', padding: '20px 16px 64px', display: 'flex', flexDirection: 'column', gap: 14 },
  back: { alignSelf: 'flex-start', background: 'transparent', border: 'none', color: '#2f6fed', cursor: 'pointer', padding: 0, fontSize: 14 },
  title: { fontSize: 24, margin: 0 },
  subtitle: { margin: 0, color: '#555', fontSize: 14 },
  card: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 14, border: '1px solid #e4e4ee', background: '#fff' },
  row: { display: 'flex', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 },
  fieldLabel: { fontSize: 13, color: '#444' },
  input: { padding: '10px 12px', borderRadius: 10, border: '1px solid #ccd', fontSize: 15, background: '#fafaff' },
  hint: { fontSize: 12, color: '#888' },
  primary: { padding: '12px 16px', borderRadius: 12, border: 'none', background: '#2f6fed', color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer' },
  linkButton: { background: 'transparent', border: 'none', color: '#2f6fed', cursor: 'pointer', padding: 0, fontSize: 14 },
  error: { color: '#b3261e', fontSize: 14, margin: 0 },
  success: { color: '#0a7d33', fontSize: 16 },
}
