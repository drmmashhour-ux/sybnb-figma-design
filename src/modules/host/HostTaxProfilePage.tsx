import { useEffect, useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchHostTaxProfile,
  recordHostGstQstTreatment,
  updateHostTaxProfile,
  type PlatformGstQstTreatment,
  type PlatformTaxIdentifierType,
  type PlatformTaxProfile,
  type TaxProfileInput,
} from '../../shared/api/platformApi'

// Tax-compliance foundation (029) — host tax profile onboarding. Per-listing Quebec details (the
// CITQ tourist-accommodation registration number, insurance proof, certificate expiry) stay where
// they already correctly live -- on each listing (SellerListingWizard.tsx) -- since a host can run
// several Quebec properties under different CITQ numbers; this profile covers the host's own
// identity/business tax registration, which is one thing regardless of how many listings they run.
const copy = {
  ar: {
    back: 'العودة للوحة المضيف',
    title: 'الملف الضريبي للمضيف',
    subtitle: 'مطلوب لإصدار كشف أرباح المضيف الضريبي والامتثال التنظيمي. رقم الضمان الاجتماعي وبيانات الدفع مشفّرة ولا تُعرض كاملة بعد الإرسال الأول. سجل CITQ الخاص بكل عقار يُدار من صفحة ذلك الإعلان.',
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
    taxResidenceCountry: 'بلد الإقامة الضريبية',
    identity: 'الهوية الضريبية',
    taxIdType: 'نوع المعرّف',
    taxId: 'رقم الضمان الاجتماعي (SIN) أو رقم الشركة الضريبي',
    business: 'النشاط التجاري',
    businessName: 'الاسم التجاري القانوني',
    neq: 'رقم NEQ',
    gstRegistered: 'مسجّل في ضريبة السلع والخدمات (GST)',
    gstNumber: 'رقم تسجيل GST',
    qstRegistered: 'مسجّل في ضريبة كيبك (QST)',
    qstNumber: 'رقم تسجيل QST',
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
    treatmentTitle: 'معاملة GST/QST لعقارات كيبك',
    treatmentHint: 'قرار صريح لا يُستنتج تلقائيًا: من يتحمل مسؤولية GST/QST على عقاراتك في كيبك.',
    treatmentHostRegistered: 'أنا مسجّل، وأتحمّل مسؤولية GST/QST على عرضي الخاضع للضريبة',
    treatmentPlatformCollects: 'غير مسجّل — تحصّل SYBNB وتُحوّل عند الاقتضاء قانونيًا',
    treatmentCurrent: (label: string, date: string) => `القرار الحالي: ${label} (ساري من ${date})`,
    treatmentNone: 'لم يُسجَّل أي قرار بعد.',
    treatmentSave: 'حفظ القرار',
    treatmentSaved: 'تم تسجيل القرار.',
    citqNote: 'يُدار رقم تسجيل الإقامة السياحية (CITQ) وتاريخ انتهاء الشهادة لكل عقار من صفحة ذلك الإعلان.',
  },
  en: {
    back: 'Back to host dashboard',
    title: 'Host tax profile',
    subtitle: "Required to issue your host earnings and tax statement and for regulatory reporting. SIN/TIN and payout details are encrypted and never shown in full again after the first submission. Each property's CITQ registration is managed on that listing's own page.",
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
    taxResidenceCountry: 'Country of tax residence',
    identity: 'Tax identity',
    taxIdType: 'Identifier type',
    taxId: 'SIN or applicable business tax number',
    business: 'Business',
    businessName: 'Legal business name',
    neq: 'NEQ / business-registration number',
    gstRegistered: 'GST registered',
    gstNumber: 'GST registration number',
    qstRegistered: 'QST registered',
    qstNumber: 'QST registration number',
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
    treatmentTitle: 'GST/QST treatment for Quebec properties',
    treatmentHint: 'An explicit decision, never inferred: who is responsible for GST/QST on your Quebec listings.',
    treatmentHostRegistered: "I'm registered — I'm responsible for GST/QST on my own taxable supply",
    treatmentPlatformCollects: 'Not registered — SYBNB collects and remits where legally required',
    treatmentCurrent: (label: string, date: string) => `Current decision: ${label} (effective ${date})`,
    treatmentNone: 'No decision recorded yet.',
    treatmentSave: 'Save decision',
    treatmentSaved: 'Decision recorded.',
    citqNote: "Each property's tourist-accommodation registration number (CITQ) and certificate expiry are managed on that listing's own page.",
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

export function HostTaxProfilePage({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const t = isAr ? copy.ar : copy.en

  const [profile, setProfile] = useState<PlatformTaxProfile | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [submitState, setSubmitState] = useState<'idle' | 'saving'>('idle')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [treatment, setTreatment] = useState<PlatformGstQstTreatment>('HOST_REGISTERED')
  const [treatmentSaving, setTreatmentSaving] = useState(false)
  const [treatmentMessage, setTreatmentMessage] = useState('')

  async function load() {
    try {
      const existing = await fetchHostTaxProfile()
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
        if (existing.gstQstTreatment) setTreatment(existing.gstQstTreatment)
      }
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }

  useEffect(() => {
    void load()
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
      const updated = await updateHostTaxProfile(input)
      setProfile(updated)
      setForm((prev) => ({ ...prev, taxIdentifier: '', payoutAccountIdentifier: '' }))
      setSuccess(t.saved)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t.genericError)
    } finally {
      setSubmitState('idle')
    }
  }

  async function onSaveTreatment() {
    setTreatmentSaving(true)
    setTreatmentMessage('')
    try {
      const updated = await recordHostGstQstTreatment(treatment)
      setProfile(updated)
      setTreatmentMessage(t.treatmentSaved)
    } catch (err) {
      setTreatmentMessage(err instanceof Error && err.message ? err.message : t.genericError)
    } finally {
      setTreatmentSaving(false)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/host')}>{t.back}</button>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      {profile && (
        <span style={{ ...styles.badge, color: statusColor(profile.verificationStatus), borderColor: statusColor(profile.verificationStatus), alignSelf: 'flex-start' }}>
          {t.statusLabel}: {statusText(profile.verificationStatus, t)}
        </span>
      )}

      {loadState === 'loading' && <p style={styles.muted}>{t.loading}</p>}

      {loadState !== 'loading' && (
        <>
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
            <p style={styles.hint}>{t.citqNote}</p>

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

          {profile && (
            <section style={styles.card}>
              <h2 style={styles.sectionTitle}>{t.treatmentTitle}</h2>
              <p style={styles.hint}>{t.treatmentHint}</p>
              {profile.gstQstTreatment ? (
                <p style={styles.muted}>
                  {t.treatmentCurrent(
                    profile.gstQstTreatment === 'HOST_REGISTERED' ? t.treatmentHostRegistered : t.treatmentPlatformCollects,
                    profile.gstQstTreatmentEffectiveAt ? profile.gstQstTreatmentEffectiveAt.slice(0, 10) : '',
                  )}
                </p>
              ) : (
                <p style={styles.muted}>{t.treatmentNone}</p>
              )}
              <label style={styles.checkboxRow}>
                <input type="radio" name="treatment" checked={treatment === 'HOST_REGISTERED'} onChange={() => setTreatment('HOST_REGISTERED')} />
                <span>{t.treatmentHostRegistered}</span>
              </label>
              <label style={styles.checkboxRow}>
                <input type="radio" name="treatment" checked={treatment === 'PLATFORM_COLLECTS'} onChange={() => setTreatment('PLATFORM_COLLECTS')} />
                <span>{t.treatmentPlatformCollects}</span>
              </label>
              {treatmentMessage && <p style={styles.muted}>{treatmentMessage}</p>}
              <button style={styles.primary} type="button" onClick={onSaveTreatment} disabled={treatmentSaving}>
                {treatmentSaving ? t.saving : t.treatmentSave}
              </button>
            </section>
          )}
        </>
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
