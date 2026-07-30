import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  adminScanStanding,
  adminListStandingSuggestions,
  adminDecideStandingSuggestion,
  type PlatformStandingSuggestion,
  type StandingKind,
} from '../../shared/api/platformApi'

// Loyalty / fidelity: the AI (or the rule fallback) proposes standing tiers; the admin approves or
// rejects each one here. A user's live tier never changes without an approval on this queue.

type Props = { lang: Lang }

const TIER_COLOR: Record<string, string> = {
  NEW: '#93a0b5', VERIFIED: '#4aa3ff', RELIABLE: '#4aa3ff', TRUSTED: '#20d29b', VIP: '#c8a24a', ELITE: '#c8a24a',
}

export function LoyaltyPanel({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = (ar: string, en: string) => (isAr ? ar : en)

  const [suggestions, setSuggestions] = useState<PlatformStandingSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState<StandingKind | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function loadQueue() {
    setLoading(true)
    setError('')
    try {
      setSuggestions(await adminListStandingSuggestions('PENDING'))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذر تحميل الاقتراحات.', 'Could not load suggestions.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadQueue() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function scan(kind: StandingKind) {
    setScanning(kind)
    setError('')
    setNotice('')
    try {
      const r = await adminScanStanding(kind, 25)
      setNotice(
        t(
          `تم فحص ${r.scanned} حساب — ${r.suggestionsCreated} اقتراح جديد.`,
          `Scanned ${r.scanned} accounts — ${r.suggestionsCreated} new suggestion(s).`,
        ),
      )
      await loadQueue()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذر الفحص.', 'Could not scan.'))
    } finally {
      setScanning(null)
    }
  }

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    setBusyId(id)
    setError('')
    try {
      await adminDecideStandingSuggestion(id, decision)
      setNotice(decision === 'APPROVE' ? t('تم اعتماد المستوى.', 'Tier approved.') : t('تم الرفض.', 'Suggestion rejected.'))
      setSuggestions((cur) => cur.filter((s) => s.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذر تنفيذ القرار.', 'Could not apply the decision.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={S.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <div style={S.controls}>
        <button style={S.btn} disabled={scanning !== null} onClick={() => void scan('HOST')}>
          {scanning === 'HOST' ? t('جارٍ الفحص…', 'Scanning…') : t('فحص المضيفين', 'Scan hosts')}
        </button>
        <button style={S.btn} disabled={scanning !== null} onClick={() => void scan('GUEST')}>
          {scanning === 'GUEST' ? t('جارٍ الفحص…', 'Scanning…') : t('فحص العملاء', 'Scan guests')}
        </button>
        <button style={S.btn} disabled={loading} onClick={() => void loadQueue()}>{t('تحديث', 'Refresh')}</button>
      </div>

      {notice && <div style={S.notice}>{notice}</div>}
      {error && <div style={S.error}>{error}</div>}

      <div style={S.list}>
        {!suggestions.length && !loading && (
          <div style={S.empty}>{t('لا اقتراحات معلّقة. شغّل فحصاً لاقتراح مستويات.', 'No pending suggestions. Run a scan to propose tiers.')}</div>
        )}
        {suggestions.map((s) => (
          <div key={s.id} style={S.card}>
            <div style={S.top}>
              <div>
                <strong style={S.name}>{s.user?.displayName || s.userId}</strong>
                <span style={S.email}>{s.user?.email || ''} · {s.kind === 'GUEST' ? t('عميل', 'Guest') : t('مضيف', 'Host')}</span>
              </div>
              <div style={S.tiers}>
                <span style={{ ...S.tier, color: TIER_COLOR[s.currentTier] || '#93a0b5' }}>{s.currentTier}</span>
                <span style={S.arrow}>→</span>
                <span style={{ ...S.tier, color: TIER_COLOR[s.suggestedTier] || '#93a0b5', fontWeight: 800 }}>{s.suggestedTier}</span>
              </div>
            </div>
            <p style={S.reason}>{s.reason}</p>
            <div style={S.foot}>
              <span style={S.src}>{s.aiModel ? t('اقتراح ذكاء اصطناعي', 'AI suggestion') : t('اقتراح بالقواعد', 'Rule-based')}</span>
              <div style={S.actions}>
                <button style={{ ...S.btn, ...S.ok }} disabled={busyId === s.id} onClick={() => void decide(s.id, 'APPROVE')}>{t('اعتماد', 'Approve')}</button>
                <button style={{ ...S.btn, ...S.no }} disabled={busyId === s.id} onClick={() => void decide(s.id, 'REJECT')}>{t('رفض', 'Reject')}</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 12 },
  controls: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  btn: { background: '#1b2130', color: '#e8ecf3', border: '1px solid rgba(255,255,255,.16)', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  ok: { background: 'rgba(32,210,155,.16)', borderColor: '#20d29b', color: '#6ff0c8' },
  no: { background: 'rgba(255,92,120,.16)', borderColor: '#ff5c78', color: '#ff9fb1' },
  notice: { color: '#6ff0c8', background: 'rgba(32,210,155,.1)', border: '1px solid rgba(32,210,155,.3)', borderRadius: 8, padding: '8px 11px', fontSize: 12.5 },
  error: { color: '#ff9fb1', background: 'rgba(255,92,120,.1)', border: '1px solid rgba(255,92,120,.35)', borderRadius: 8, padding: '9px 12px', fontSize: 13 },
  list: { display: 'grid', gap: 10 },
  empty: { color: '#7d8aa0', fontSize: 13, padding: '8px 2px' },
  card: { background: '#12141d', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 14, display: 'grid', gap: 8 },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' },
  name: { fontSize: 14, fontWeight: 700, display: 'block' },
  email: { fontSize: 12, color: '#93a0b5' },
  tiers: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 },
  tier: { fontWeight: 700, letterSpacing: '.04em' },
  arrow: { color: '#7d8aa0' },
  reason: { margin: 0, fontSize: 13, color: '#c4ccd9', lineHeight: 1.5 },
  foot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  src: { fontSize: 11, color: '#7d8aa0', textTransform: 'uppercase', letterSpacing: '.06em' },
  actions: { display: 'flex', gap: 8 },
}

export default LoyaltyPanel
