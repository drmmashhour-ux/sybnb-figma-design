import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { moneyText } from '../../shared/i18n/display'
import { colors, withAlpha } from '../../shared/theme/tokens'

// Synitres module — Mortgage calculator. A self-contained monthly-payment estimator on the property
// detail (buy flow): standard amortization M = P·r(1+r)^n / ((1+r)^n − 1). Pure client math, no network,
// no advice — an estimate only. Prefilled from the listing price; the buyer tunes down payment, rate,
// and term. Works with r = 0 (interest-free) too.

type Props = { priceMinor: number; currency: string; lang: Lang }

const copy = {
  ar: {
    title: 'حاسبة التمويل العقاري',
    price: 'سعر العقار',
    downPct: 'الدفعة الأولى (%)',
    rate: 'الفائدة السنوية (%)',
    term: 'المدة (سنوات)',
    monthly: 'القسط الشهري التقديري',
    loan: 'مبلغ التمويل',
    disclaimer: 'تقدير تقريبي فقط — ليس عرض تمويل.',
  },
  en: {
    title: 'Mortgage calculator',
    price: 'Property price',
    downPct: 'Down payment (%)',
    rate: 'Annual interest (%)',
    term: 'Term (years)',
    monthly: 'Estimated monthly payment',
    loan: 'Loan amount',
    disclaimer: 'A rough estimate only — not a financing offer.',
  },
}

export function MortgageCalculator({ priceMinor, currency, lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [downPct, setDownPct] = useState(20)
  const [ratePct, setRatePct] = useState(6)
  const [years, setYears] = useState(20)

  const { loanMinor, monthlyMinor } = useMemo(() => {
    const price = Math.max(0, priceMinor)
    const down = Math.min(100, Math.max(0, downPct))
    const principal = Math.round(price * (1 - down / 100))
    const n = Math.max(1, Math.round(years)) * 12
    const r = Math.max(0, ratePct) / 100 / 12
    // r = 0 → straight-line; otherwise the amortization formula.
    const monthly = r === 0 ? principal / n : (principal * r * (1 + r) ** n) / ((1 + r) ** n - 1)
    return { loanMinor: principal, monthlyMinor: Math.round(monthly) }
  }, [priceMinor, downPct, ratePct, years])

  return (
    <section style={styles.box} dir={isAr ? 'rtl' : 'ltr'}>
      <strong style={styles.title}>💰 {t.title}</strong>
      <div style={styles.row}>
        <span style={styles.label}>{t.price}</span>
        <strong dir="ltr">{moneyText(priceMinor, currency, lang)}</strong>
      </div>
      <Field label={`${t.downPct}`} value={downPct} min={0} max={90} step={5} onChange={setDownPct} suffix="%" />
      <Field label={`${t.rate}`} value={ratePct} min={0} max={30} step={0.5} onChange={setRatePct} suffix="%" />
      <Field label={`${t.term}`} value={years} min={1} max={30} step={1} onChange={setYears} suffix={isAr ? 'سنة' : 'yr'} />
      <div style={styles.row}>
        <span style={styles.label}>{t.loan}</span>
        <strong dir="ltr">{moneyText(loanMinor, currency, lang)}</strong>
      </div>
      <div style={styles.resultRow}>
        <span>{t.monthly}</span>
        <strong dir="ltr" style={styles.result}>{moneyText(monthlyMinor, currency, lang)}</strong>
      </div>
      <small style={styles.disclaimer}>{t.disclaimer}</small>
    </section>
  )
}

function Field({ label, value, min, max, step, onChange, suffix }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldTop}>
        <span style={styles.label}>{label}</span>
        <strong dir="ltr">{value}{suffix}</strong>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={styles.range} />
    </label>
  )
}

const styles: Record<string, CSSProperties> = {
  box: { border: `1px solid ${withAlpha(colors.green, 0.4)}`, borderRadius: 16, background: withAlpha(colors.green, 0.06), padding: 16, display: 'grid', gap: 12 },
  title: { fontSize: 16, color: colors.ink },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, color: colors.muted, fontSize: 14 },
  label: { color: colors.muted, fontSize: 13 },
  field: { display: 'grid', gap: 6 },
  fieldTop: { display: 'flex', justifyContent: 'space-between', gap: 12, color: colors.ink, fontSize: 14 },
  range: { width: '100%', accentColor: colors.green },
  resultRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTop: `1px solid ${colors.line}`, paddingTop: 12, color: colors.ink },
  result: { fontSize: 22, color: colors.green, fontVariantNumeric: 'tabular-nums' },
  disclaimer: { color: colors.muted, fontSize: 12 },
}

export default MortgageCalculator
