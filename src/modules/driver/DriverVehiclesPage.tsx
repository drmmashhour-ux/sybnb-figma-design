import { useEffect, useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createDriverVehicle,
  fetchDriverVehicles,
  type PlatformDriverVehicle,
} from '../../shared/api/platformApi'

// SR fleet (020) — driver vehicle registration. Adds a vehicle (make/model/year/plate/color/category)
// against POST /api/driver/vehicles and lists the driver's vehicles with their approval status. The
// server age-gates each tier and returns a clear rejection message, which is surfaced here as-is.
const copy = {
  ar: {
    back: 'العودة للوحة السائق',
    title: 'مركباتي',
    subtitle: 'سجّل مركبتك لقبول رحلات SYBNB Ride. تخضع كل مركبة لمراجعة SYBNB وحد أقصى للعمر حسب الفئة.',
    make: 'الصانع',
    model: 'الطراز',
    year: 'سنة الصنع',
    plate: 'رقم اللوحة',
    color: 'اللون (اختياري)',
    category: 'الفئة',
    add: 'تسجيل المركبة',
    adding: 'جار التسجيل...',
    myVehicles: 'المركبات المسجّلة',
    loading: 'جار التحميل...',
    empty: 'لا توجد مركبات مسجّلة بعد.',
    added: 'تم تسجيل المركبة، بانتظار مراجعة SYBNB.',
    statusPending: 'قيد المراجعة',
    statusApproved: 'معتمدة',
    statusRejected: 'مرفوضة',
    genericError: 'تعذر تسجيل المركبة، حاول مجددًا.',
    loadError: 'تعذر تحميل المركبات.',
    ageHint: 'الحد الأقصى للعمر: اقتصادية 10 سنوات، مريحة/دفع رباعي/XXL 7 سنوات.',
    ageHintQuebec: 'كيبيك (SAAQ): الحد الأقصى ١٠ سنوات لكل الفئات. يشترط أيضاً قاعدة عجلات ٢٦١سم فأكثر ووزن أقل من ٣٥٠٠كغ — يُتحقق منها يدوياً حالياً.',
    country: 'السوق',
    countrySyria: 'سوريا',
    countryQuebec: 'كيبيك، كندا',
  },
  en: {
    back: 'Back to driver dashboard',
    title: 'My vehicles',
    subtitle: 'Register your vehicle to accept SYBNB Ride trips. Each vehicle is reviewed by SYBNB and has a max age per tier.',
    make: 'Make',
    model: 'Model',
    year: 'Model year',
    plate: 'Plate number',
    color: 'Color (optional)',
    category: 'Tier',
    add: 'Register vehicle',
    adding: 'Registering…',
    myVehicles: 'Registered vehicles',
    loading: 'Loading…',
    empty: 'No vehicles registered yet.',
    added: 'Vehicle registered — pending SYBNB review.',
    statusPending: 'Pending review',
    statusApproved: 'Approved',
    statusRejected: 'Rejected',
    genericError: 'Could not register the vehicle. Please try again.',
    loadError: 'Could not load your vehicles.',
    ageHint: 'Max age: Economy 10 years, Comfort/SUV/XXL 7 years.',
    ageHintQuebec: "Quebec (SAAQ): max age 10 years for every tier. Also requires wheelbase >=261cm and net weight <3,500kg -- checked manually today.",
    country: 'Market',
    countrySyria: 'Syria',
    countryQuebec: 'Quebec, Canada',
  },
}

const CATEGORIES = ['SR Economy', 'SR Comfort', 'SR SUV', 'SR XXL'] as const

// Display-only rebrand (SR/SIR is the internal code; customer-facing label is "SYBNB Ride" per the
// Québec compliance review): the stored category value posted to the server and saved on
// DriverVehicle must stay exactly as CATEGORIES above -- only the label shown to the driver changes.
const CATEGORY_LABELS: Record<string, string> = {
  'SR Economy': 'SYBNB Ride Economy',
  'SR Comfort': 'SYBNB Ride Comfort',
  'SR SUV': 'SYBNB Ride SUV',
  'SR XXL': 'SYBNB Ride XXL',
}

function statusText(status: PlatformDriverVehicle['status'], t: typeof copy.en) {
  if (status === 'APPROVED') return t.statusApproved
  if (status === 'REJECTED') return t.statusRejected
  return t.statusPending
}

function statusColor(status: PlatformDriverVehicle['status']) {
  if (status === 'APPROVED') return '#0a7d33'
  if (status === 'REJECTED') return '#b3261e'
  return '#8a6d0b'
}

export function DriverVehiclesPage({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const t = isAr ? copy.ar : copy.en

  const [vehicles, setVehicles] = useState<PlatformDriverVehicle[]>([])
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [form, setForm] = useState({ make: '', model: '', year: '', plate: '', color: '', category: CATEGORIES[0] as string, country: 'SY' })
  const [submitState, setSubmitState] = useState<'idle' | 'saving'>('idle')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadVehicles() {
    setListState('loading')
    try {
      setVehicles(await fetchDriverVehicles())
      setListState('ready')
    } catch {
      setListState('error')
    }
  }

  useEffect(() => {
    void loadVehicles()
  }, [])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setSubmitState('saving')
    try {
      await createDriverVehicle({
        make: form.make.trim(),
        model: form.model.trim(),
        year: Number(form.year),
        plate: form.plate.trim(),
        color: form.color.trim() || undefined,
        category: form.category,
        country: form.country,
      })
      setSuccess(t.added)
      setForm({ make: '', model: '', year: '', plate: '', color: '', category: form.category, country: form.country })
      await loadVehicles()
    } catch (err) {
      // Surface the server message verbatim (incl. the age-limit rejection).
      setError(err instanceof Error && err.message ? err.message : t.genericError)
    } finally {
      setSubmitState('idle')
    }
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/driver')}>{t.back}</button>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      <form style={styles.card} onSubmit={onSubmit}>
        <Field label={t.country}>
          <select style={styles.input} value={form.country} onChange={set('country')}>
            <option value="SY">{t.countrySyria}</option>
            <option value="CA">{t.countryQuebec}</option>
          </select>
        </Field>
        <Field label={t.make}><input style={styles.input} value={form.make} onChange={set('make')} required /></Field>
        <Field label={t.model}><input style={styles.input} value={form.model} onChange={set('model')} required /></Field>
        <Field label={t.year}><input style={styles.input} type="number" inputMode="numeric" value={form.year} onChange={set('year')} required /></Field>
        <Field label={t.plate}><input style={styles.input} value={form.plate} onChange={set('plate')} required /></Field>
        <Field label={t.color}><input style={styles.input} value={form.color} onChange={set('color')} /></Field>
        <Field label={t.category}>
          <select style={styles.input} value={form.category} onChange={set('category')}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
          </select>
        </Field>
        <p style={styles.hint}>{form.country === 'CA' ? t.ageHintQuebec : t.ageHint}</p>
        {error && <p style={styles.error} role="alert">{error}</p>}
        {success && <p style={styles.success}>{success}</p>}
        <button style={styles.primary} type="submit" disabled={submitState === 'saving'}>
          {submitState === 'saving' ? t.adding : t.add}
        </button>
      </form>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>{t.myVehicles}</h2>
        {listState === 'loading' && <p style={styles.muted}>{t.loading}</p>}
        {listState === 'error' && <p style={styles.error}>{t.loadError}</p>}
        {listState === 'ready' && vehicles.length === 0 && <p style={styles.muted}>{t.empty}</p>}
        {listState === 'ready' &&
          vehicles.map((v) => (
            <article key={v.id} style={styles.vehicle}>
              <div>
                <strong>{v.make} {v.model} · {v.year}</strong>
                <div style={styles.vehicleMeta}>
                  {CATEGORY_LABELS[v.category] || v.category} · {v.plate}{v.color ? ` · ${v.color}` : ''} · {v.country === 'CA' ? t.countryQuebec : t.countrySyria}
                </div>
                {v.status === 'REJECTED' && v.reviewNote && <div style={styles.reviewNote}>{v.reviewNote}</div>}
              </div>
              <span style={{ ...styles.badge, color: statusColor(v.status), borderColor: statusColor(v.status) }}>
                {statusText(v.status, t)}
              </span>
            </article>
          ))}
      </section>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 640, margin: '0 auto', padding: '20px 16px 64px', display: 'flex', flexDirection: 'column', gap: 16 },
  back: { alignSelf: 'flex-start', background: 'transparent', border: 'none', color: '#2f6fed', cursor: 'pointer', padding: 0, fontSize: 14 },
  title: { fontSize: 24, margin: 0 },
  subtitle: { margin: 0, color: '#555', fontSize: 14, lineHeight: 1.5 },
  card: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 14, border: '1px solid #e4e4ee', background: '#fff' },
  sectionTitle: { fontSize: 16, margin: '0 0 4px', color: '#111' },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: { fontSize: 13, color: '#444' },
  input: { padding: '10px 12px', borderRadius: 10, border: '1px solid #ccd', fontSize: 15, background: '#fafaff' },
  hint: { fontSize: 12, color: '#777', margin: 0 },
  primary: { padding: '12px 16px', borderRadius: 12, border: 'none', background: '#2f6fed', color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer' },
  error: { color: '#b3261e', fontSize: 14, margin: 0 },
  success: { color: '#0a7d33', fontSize: 14, margin: 0 },
  muted: { color: '#888', fontSize: 14, margin: 0 },
  vehicle: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderTop: '1px solid #eef' },
  vehicleMeta: { fontSize: 13, color: '#666', marginTop: 2 },
  reviewNote: { fontSize: 12, color: '#b3261e', marginTop: 4 },
  badge: { fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, border: '1px solid', whiteSpace: 'nowrap' },
}
