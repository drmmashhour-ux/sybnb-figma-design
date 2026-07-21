import { useEffect, useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchDriverTaxProfile,
  updateDriverTaxProfile,
  type PlatformTaxIdentifierType,
  type PlatformTaxProfile,
  type TaxProfileInput,
} from '../../shared/api/platformApi'

// Tax-compliance foundation (029) — driver tax profile onboarding. SIN/TIN and the payout account
// identifier are encrypted server-side (server/lib/tax-encryption.mjs) and NEVER sent back in full:
// once saved, this form only ever shows a masked value, and re-entering the field starts blank
// (submitting the form again always re-encrypts whatever is currently typed, never "keeps the old
// value" silently -- so a driver can't accidentally leave a stale identifier stored under new info).
const copy = {
  ar: {
    back: 'العودة للوحة السائق',
    title: 'الملف الضريبي',
    subtitle: 'مطلوب لإصدار كشوف الأرباح الضريبية والامتثال التنظيمي. رقم الضمان الاجتماعي وبيانات الدفع مشفّرة ولا تُعرض كاملة بعد الإرسال الأول.',
    savedMasked: (label: string, masked: string) => `${label} المحفوظ حاليًا: ${masked}. أدخل قيمة جديدة فقط إذا رغبت بتغييره.`,
    legalName: 'الاسم القانوني',
    firstName: 'الاسم الأول',
    lastName: 'اسم العائلة',
    dob: 'تاريخ الميلاد',
    address: 'العنوان',
    addressLine1: 'العنوان - السطر الأول',
    addressLine2: 'العنوان - السطر الثاني (اختياري)',
    city: 'المدينة',
    region: 'المقاطعة/المحافظة',
    postalCode: 'الرمز البريدي',
    country: 'بلد الإقامة',
    taxResidence: 'الإقامة الضريبية',
    taxResidenceCountry: 'بلد الإقامة الضريبية',
    identity: 'الهوية الضريبية',
    taxIdType: 'نوع المعرّف',
    taxId: 'رقم الضمان الاجتماعي (SIN) أو المعرّف الضريبي',
    business: 'النشاط التجاري (اختياري)',
    businessName: 'الاسم التجاري القانوني',
    neq: 'رقم NEQ',
    gstRegistered: 'مسجّل في ضريبة السلع والخدمات (GST)',
    gstNumber: 'رقم تسجيل GST',
    qstRegistered: 'مسجّل في ضريبة كيبك (QST)',
    qstNumber: 'رقم تسجيل QST',
    quebecNotice: 'يجب على سائقي كيبك التسجيل في GST/QST والحصول على موافقة SYBNB قبل أول رحلة مدفوعة.',
    payout: 'الدفع',
    payoutAccount: 'معرّف حساب الدفع',
    consent: 'أوافق على الإبلاغ التنظيمي المطلوب (بما في ذلك تقارير Part XX الفدرالية عند الاقتضاء).',
    certify: 'أشهد بأن المعلومات المُقدَّمة دقيقة وكاملة على حد علمي.',
    save: 'حفظ الملف الضريبي',
    saving: 'جارٍ الحفظ...',
    saved: 'تم حفظ الملف الضريبي. الحالة: بانتظار المراجعة.',
    genericError: 'تعذر حفظ الملف الضريبي، حاول مجددًا.',
    loading: 'جار التحميل...',
    statusLabel: 'حالة التحقق',
    statusPending: 'بانتظار المراجعة',
    statusApproved: 'موثّق',
    statusRejected: 'مرفوض',
    individual: 'فرد',
    businessType: 'نوع البائع',
    businessTypeBusiness: 'شركة/نشاط تجاري',
    sin: 'رقم الضمان الاجتماعي (SIN)',
    tin: 'معرّف ضريبي (TIN)',
    other: 'آخر',
  },
  en: {
    back: 'Back to driver dashboard',
    title: 'Tax profile',
    subtitle: 'Required to issue your earnings and tax statement and for regulatory reporting. SIN/TIN and payout details are encrypted and never shown in full again after the first submission.',
    savedMasked: (label: string, masked: string) => `Currently saved ${label}: ${masked}. Only enter a new value if you want to change it.`,
    legalName: 'Legal name',
    firstName: 'Legal first name',
    lastName: 'Legal last name',
    dob: 'Date of birth',
    address: 'Address',
    addressLine1: 'Address line 1',
    addressLine2: 'Address line 2 (optional)',
    city: 'City',
    region: 'Province/region',
    postalCode: 'Postal code',
    country: 'Country of residence',
    taxResidence: 'Tax residence',
    taxResidenceCountry: 'Country of tax residence',
    identity: 'Tax identity',
    taxIdType: 'Identifier type',
    taxId: 'SIN or applicable tax identification number',
    business: 'Business (optional)',
    businessName: 'Legal business name',
    neq: 'NEQ / business number',
    gstRegistered: 'GST registered',
    gstNumber: 'GST registration number',
    qstRegistered: 'QST registered',
    qstNumber: 'QST registration number',
    quebecNotice: 'Quebec drivers must be GST/QST registered and SYBNB-approved before their first paid ride.',
    payout: 'Payout',
    payoutAccount: 'Payout account identifier',
    consent: 'I consent to required regulatory reporting (including federal Part XX reporting where applicable).',
    certify: 'I certify that the information provided is accurate and complete to the best of my knowledge.',
    save: 'Save tax profile',
    saving: 'Saving…',
    saved: 'Tax profile saved. Status: pending review.',
    genericError: 'Could not save the tax profile. Please try again.',
    loading: 'Loading…',
    statusLabel: 'Verification status',
    statusPending: 'Pending review',
    statusApproved: 'Verified',
    statusRejected: 'Rejected',
    individual: 'Individual',
    businessType: 'Filer type',
    businessTypeBusiness: 'Business',
    sin: 'SIN',
    tin: 'TIN',
    other: 'Other',
  },
}

type FormState = {
  legalFirstName: string
  legalLastName: string
  legalBusinessName: string
  businessType: 'INDIVIDUAL' | 'BUSINESS'
  dateOfBirth: string
  addressLine1: string
  addressLine2: string
  city: string
  region: string
  postalCode: string
  country: string
  taxResidenceCountry: string
  taxIdentifierType: PlatformTaxIdentifierType
  taxIdentifier: string
  gstRegistered: boolean
  gstNumber: string
  qstRegistered: boolean
  qstNumber: string
  neqNumber: string
  payoutAccountIdentifier: string
  consentRegulatoryReporting: boolean
  certifiedAccurate: boolean
}

const EMPTY_FORM: FormState = {
  legalFirstName: '', legalLastName: '', legalBusinessName: '', businessType: 'INDIVIDUAL', dateOfBirth: '',
  addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '', country: 'CA',
  taxResidenceCountry: 'CA', taxIdentifierType: 'SIN', taxIdentifier: '',
  gstRegistered: false, gstNumber: '', qstRegistered: false, qstNumber: '', neqNumber: '',
  payoutAccountIdentifier: '', consentRegulatoryReporting: false, certifiedAccurate: false,
}

function statusText(status: PlatformTaxProfile['verificationStatus'], t: typeof copy.en) {
  if (status === 'APPROVED') return t.statusApproved
  if (status === 'REJECTED') return t.statusRejected
  return t.statusPending
}

function statusColor(status: PlatformTaxProfile['verificationStatus']) {
  if (status === 'APPROVED') return '#0a7d33'
  if (status === 'REJECTED') return '#b3261e'
  return '#8a6d0b'
}

export function DriverTaxProfilePage({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const t = isAr ? copy.ar : copy.en

  const [profile, setProfile] = useState<PlatformTaxProfile | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [submitState, setSubmitState] = useState<'idle' | 'saving'>('idle')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const existing = await fetchDriverTaxProfile()
        setProfile(existing)
        if (existing) {
          setForm((prev) => ({
            ...prev,
            legalFirstName: existing.legalFirstName,
            legalLastName: existing.legalLastName,
            legalBusinessName: existing.legalBusinessName || '',
            businessType: existing.businessType,
            dateOfBirth: existing.dateOfBirth ? existing.dateOfBirth.slice(0, 10) : '',
            addressLine1: existing.addressLine1,
            addressLine2: existing.addressLine2 || '',
            city: existing.city,
            region: existing.region,
            postalCode: existing.postalCode,
            country: existing.country,
            taxResidenceCountry: existing.taxResidenceCountry,
            taxIdentifierType: existing.taxIdentifierType,
            gstRegistered: existing.gstRegistered,
            gstNumber: existing.gstNumber || '',
            qstRegistered: existing.qstRegistered,
            qstNumber: existing.qstNumber || '',
            neqNumber: existing.neqNumber || '',
          }))
        }
        setLoadState('ready')
      } catch {
        setLoadState('error')
      }
    })()
  }, [])

  const set = <K extends keyof FormState>(key: K) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.target.type === 'checkbox' ? (event.target as HTMLInputElement).checked : event.target.value
    setForm((prev) => ({ ...prev, [key]: value }) as FormState)
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setSubmitState('saving')
    try {
      const input: TaxProfileInput = {
        legalFirstName: form.legalFirstName.trim(),
        legalLastName: form.legalLastName.trim(),
        legalBusinessName: form.legalBusinessName.trim() || undefined,
        businessType: form.businessType,
        dateOfBirth: form.dateOfBirth || undefined,
        addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2.trim() || undefined,
        city: form.city.trim(),
        region: form.region.trim(),
        postalCode: form.postalCode.trim(),
        country: form.country.trim(),
        taxResidenceCountry: form.taxResidenceCountry.trim(),
        taxIdentifierType: form.taxIdentifierType,
        taxIdentifier: form.taxIdentifier.trim(),
        gstRegistered: form.gstRegistered,
        gstNumber: form.gstNumber.trim() || undefined,
        qstRegistered: form.qstRegistered,
        qstNumber: form.qstNumber.trim() || undefined,
        neqNumber: form.neqNumber.trim() || undefined,
        payoutAccountIdentifier: form.payoutAccountIdentifier.trim(),
        consentRegulatoryReporting: form.consentRegulatoryReporting,
        certifiedAccurate: form.certifiedAccurate,
      }
      const updated = await updateDriverTaxProfile(input)
      setProfile(updated)
      setForm((prev) => ({ ...prev, taxIdentifier: '', payoutAccountIdentifier: '' }))
      setSuccess(t.saved)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t.genericError)
    } finally {
      setSubmitState('idle')
    }
  }

  const isQuebec = form.country === 'CA'

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/driver')}>{t.back}</button>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      {profile && (
        <span style={{ ...styles.badge, color: statusColor(profile.verificationStatus), borderColor: statusColor(profile.verificationStatus), alignSelf: 'flex-start' }}>
          {t.statusLabel}: {statusText(profile.verificationStatus, t)}
        </span>
      )}

      {loadState === 'loading' && <p style={styles.muted}>{t.loading}</p>}

      {loadState !== 'loading' && (
        <form style={styles.card} onSubmit={onSubmit}>
          <h2 style={styles.sectionTitle}>{t.legalName}</h2>
          <Field label={t.firstName}><input style={styles.input} value={form.legalFirstName} onChange={set('legalFirstName')} required /></Field>
          <Field label={t.lastName}><input style={styles.input} value={form.legalLastName} onChange={set('legalLastName')} required /></Field>
          <Field label={t.businessType}>
            <select style={styles.input} value={form.businessType} onChange={set('businessType')}>
              <option value="INDIVIDUAL">{t.individual}</option>
              <option value="BUSINESS">{t.businessTypeBusiness}</option>
            </select>
          </Field>
          {form.businessType === 'INDIVIDUAL' && (
            <Field label={t.dob}><input style={styles.input} type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} required /></Field>
          )}

          <h2 style={styles.sectionTitle}>{t.address}</h2>
          <Field label={t.addressLine1}><input style={styles.input} value={form.addressLine1} onChange={set('addressLine1')} required /></Field>
          <Field label={t.addressLine2}><input style={styles.input} value={form.addressLine2} onChange={set('addressLine2')} /></Field>
          <Field label={t.city}><input style={styles.input} value={form.city} onChange={set('city')} required /></Field>
          <Field label={t.region}><input style={styles.input} value={form.region} onChange={set('region')} required /></Field>
          <Field label={t.postalCode}><input style={styles.input} value={form.postalCode} onChange={set('postalCode')} required /></Field>
          <Field label={t.country}><input style={styles.input} value={form.country} onChange={set('country')} required /></Field>
          <Field label={t.taxResidenceCountry}><input style={styles.input} value={form.taxResidenceCountry} onChange={set('taxResidenceCountry')} required /></Field>

          <h2 style={styles.sectionTitle}>{t.identity}</h2>
          <Field label={t.taxIdType}>
            <select style={styles.input} value={form.taxIdentifierType} onChange={set('taxIdentifierType')}>
              <option value="SIN">{t.sin}</option>
              <option value="TIN">{t.tin}</option>
              <option value="OTHER">{t.other}</option>
            </select>
          </Field>
          <Field label={t.taxId}>
            <input style={styles.input} value={form.taxIdentifier} onChange={set('taxIdentifier')} required={!profile} placeholder={profile ? '••••••••' : ''} />
          </Field>
          {profile?.taxIdentifierMasked && <p style={styles.hint}>{t.savedMasked(t.taxId, profile.taxIdentifierMasked)}</p>}

          <h2 style={styles.sectionTitle}>{t.business}</h2>
          <Field label={t.businessName}><input style={styles.input} value={form.legalBusinessName} onChange={set('legalBusinessName')} /></Field>
          <Field label={t.neq}><input style={styles.input} value={form.neqNumber} onChange={set('neqNumber')} /></Field>
          <label style={styles.checkboxRow}>
            <input type="checkbox" checked={form.gstRegistered} onChange={set('gstRegistered')} />
            <span>{t.gstRegistered}</span>
          </label>
          {form.gstRegistered && <Field label={t.gstNumber}><input style={styles.input} value={form.gstNumber} onChange={set('gstNumber')} /></Field>}
          <label style={styles.checkboxRow}>
            <input type="checkbox" checked={form.qstRegistered} onChange={set('qstRegistered')} />
            <span>{t.qstRegistered}</span>
          </label>
          {form.qstRegistered && <Field label={t.qstNumber}><input style={styles.input} value={form.qstNumber} onChange={set('qstNumber')} /></Field>}
          {isQuebec && <p style={styles.hint}>{t.quebecNotice}</p>}

          <h2 style={styles.sectionTitle}>{t.payout}</h2>
          <Field label={t.payoutAccount}>
            <input style={styles.input} value={form.payoutAccountIdentifier} onChange={set('payoutAccountIdentifier')} required={!profile} placeholder={profile ? '••••••••' : ''} />
          </Field>
          {profile?.payoutAccountMasked && <p style={styles.hint}>{t.savedMasked(t.payoutAccount, profile.payoutAccountMasked)}</p>}

          <label style={styles.checkboxRow}>
            <input type="checkbox" checked={form.consentRegulatoryReporting} onChange={set('consentRegulatoryReporting')} required />
            <span>{t.consent}</span>
          </label>
          <label style={styles.checkboxRow}>
            <input type="checkbox" checked={form.certifiedAccurate} onChange={set('certifiedAccurate')} required />
            <span>{t.certify}</span>
          </label>

          {error && <p style={styles.error} role="alert">{error}</p>}
          {success && <p style={styles.success}>{success}</p>}
          <button style={styles.primary} type="submit" disabled={submitState === 'saving'}>
            {submitState === 'saving' ? t.saving : t.save}
          </button>
        </form>
      )}
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
  sectionTitle: { fontSize: 16, margin: '12px 0 0', color: '#111' },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: { fontSize: 13, color: '#444' },
  input: { padding: '10px 12px', borderRadius: 10, border: '1px solid #ccd', fontSize: 15, background: '#fafaff' },
  hint: { fontSize: 12, color: '#777', margin: 0 },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#333' },
  primary: { padding: '12px 16px', borderRadius: 12, border: 'none', background: '#2f6fed', color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer' },
  error: { color: '#b3261e', fontSize: 14, margin: 0 },
  success: { color: '#0a7d33', fontSize: 14, margin: 0 },
  muted: { color: '#888', fontSize: 14, margin: 0 },
  badge: { fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, border: '1px solid', whiteSpace: 'nowrap' },
}
