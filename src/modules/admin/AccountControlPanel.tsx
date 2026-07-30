import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  adminSearchAccounts,
  adminGetAccount,
  adminSetAccountStatus,
  adminUpdateAccount,
  type AdminAccountStatus,
  type PlatformAdminAccount,
  type PlatformAdminAccountDetail,
} from '../../shared/api/platformApi'

// Universal account control: open ANY account across every section, fix its details, and suspend
// (revoke) / reinstate (release) / soft-delete it. Backed by the /api/admin/accounts endpoints, which
// enforce the guards (no self-action, reason required, last-admin protection) and audit every change.

type Props = { lang: Lang; section?: SectionId }
type SectionId = 'guest' | 'host' | 'accounting' | 'hr' | 'all'

const SECTIONS: { id: SectionId; ar: string; en: string }[] = [
  { id: 'guest', ar: 'العملاء', en: 'Guests' },
  { id: 'host', ar: 'المضيفون', en: 'Hosts' },
  { id: 'accounting', ar: 'البائعون', en: 'Sellers' },
  { id: 'hr', ar: 'الموظفون', en: 'Staff' },
  { id: 'all', ar: 'كل الحسابات', en: 'All accounts' },
]

const STATUS_META: Record<AdminAccountStatus, { ar: string; en: string; color: string }> = {
  ACTIVE: { ar: 'نشط', en: 'Active', color: '#20d29b' },
  SUSPENDED: { ar: 'معلّق', en: 'Suspended', color: '#e6b80d' },
  DELETED: { ar: 'محذوف', en: 'Deleted', color: '#ff5c78' },
}

export function AccountControlPanel({ lang, section: fixedSection }: Props) {
  const isAr = lang === 'ar'
  const t = (ar: string, en: string) => (isAr ? ar : en)

  const [section, setSection] = useState<SectionId>(fixedSection || 'all')
  const [statusFilter, setStatusFilter] = useState<AdminAccountStatus | ''>('')
  const [query, setQuery] = useState('')
  const [accounts, setAccounts] = useState<PlatformAdminAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PlatformAdminAccountDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  async function loadList() {
    setLoading(true)
    setError('')
    try {
      setAccounts(await adminSearchAccounts(section, statusFilter, query.trim() || undefined))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذر تحميل الحسابات.', 'Could not load accounts.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, statusFilter])

  async function openAccount(id: string) {
    setOpenId(id)
    setDetail(null)
    setNotice('')
    try {
      setDetail(await adminGetAccount(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذر فتح الحساب.', 'Could not open the account.'))
    }
  }

  // Suspend/delete require a typed reason; reinstate does not. Confirm before a destructive action.
  async function changeStatus(next: AdminAccountStatus) {
    if (!detail) return
    let reason: string | undefined
    if (next !== 'ACTIVE') {
      const label = next === 'DELETED' ? t('حذف الحساب', 'delete this account') : t('تعليق الحساب', 'suspend this account')
      const input = window.prompt(t(`اكتب سبب ${label}:`, `Enter a reason to ${label}:`))
      if (!input || !input.trim()) return
      reason = input.trim()
      if (!window.confirm(t('تأكيد الإجراء؟', 'Confirm this action?'))) return
    }
    setBusy(true)
    setError('')
    try {
      await adminSetAccountStatus(detail.id, next, reason)
      setNotice(
        next === 'ACTIVE'
          ? t('تمت إعادة التفعيل.', 'Account reinstated.')
          : next === 'SUSPENDED'
            ? t('تم تعليق الحساب — سيُسجَّل خروجه فوراً.', 'Account suspended — logged out immediately.')
            : t('تم حذف الحساب (قابل للاسترجاع).', 'Account soft-deleted (reversible).'),
      )
      await openAccount(detail.id)
      await loadList()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذر تغيير الحالة.', 'Could not change the status.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveName() {
    if (!detail) return
    const next = window.prompt(t('الاسم الجديد:', 'New display name:'), detail.displayName)
    if (next == null || !next.trim() || next.trim() === detail.displayName) return
    setBusy(true)
    setError('')
    try {
      await adminUpdateAccount(detail.id, { displayName: next.trim() })
      setNotice(t('تم تحديث الحساب.', 'Account updated.'))
      await openAccount(detail.id)
      await loadList()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذر التحديث.', 'Could not update.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={S.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <div style={S.controls}>
        {!fixedSection && (
          <select style={S.input} value={section} onChange={(e) => setSection(e.target.value as SectionId)}>
            {SECTIONS.map((s) => (
              <option key={s.id} value={s.id}>{isAr ? s.ar : s.en}</option>
            ))}
          </select>
        )}
        <select style={S.input} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AdminAccountStatus | '')}>
          <option value="">{t('كل الحالات', 'All statuses')}</option>
          <option value="ACTIVE">{STATUS_META.ACTIVE[isAr ? 'ar' : 'en']}</option>
          <option value="SUSPENDED">{STATUS_META.SUSPENDED[isAr ? 'ar' : 'en']}</option>
          <option value="DELETED">{STATUS_META.DELETED[isAr ? 'ar' : 'en']}</option>
        </select>
        <input
          style={{ ...S.input, flex: 1, minWidth: 160 }}
          placeholder={t('ابحث بالاسم أو البريد', 'Search name or email')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void loadList() }}
        />
        <button style={S.btn} onClick={() => void loadList()} disabled={loading}>
          {loading ? t('جارٍ…', 'Loading…') : t('بحث', 'Search')}
        </button>
      </div>

      {error && <div style={S.error}>{error}</div>}

      <div style={S.body}>
        <div style={S.list}>
          {!accounts.length && !loading && <div style={S.empty}>{t('لا حسابات مطابقة.', 'No matching accounts.')}</div>}
          {accounts.map((a) => (
            <button
              key={a.id}
              style={{ ...S.row, ...(a.id === openId ? S.rowActive : {}) }}
              onClick={() => void openAccount(a.id)}
            >
              <div style={S.rowMain}>
                <strong style={S.name}>{a.displayName}{a.isDemo ? ' · demo' : ''}</strong>
                <span style={S.email}>{a.email || t('بدون بريد', 'no email')}</span>
              </div>
              <span style={{ ...S.badge, color: STATUS_META[a.status].color, borderColor: STATUS_META[a.status].color }}>
                {STATUS_META[a.status][isAr ? 'ar' : 'en']}
              </span>
            </button>
          ))}
        </div>

        <div style={S.detail}>
          {!detail && <div style={S.empty}>{t('اختر حساباً لعرضه والتحكم به.', 'Select an account to open and control it.')}</div>}
          {detail && (
            <>
              <div style={S.dHead}>
                <div>
                  <strong style={S.dName}>{detail.displayName}</strong>
                  <div style={S.email}>{detail.email || t('بدون بريد', 'no email')}</div>
                  <div style={S.roles}>{detail.roles.join(' · ')}</div>
                </div>
                <span style={{ ...S.badge, color: STATUS_META[detail.status].color, borderColor: STATUS_META[detail.status].color }}>
                  {STATUS_META[detail.status][isAr ? 'ar' : 'en']}
                </span>
              </div>

              {notice && <div style={S.notice}>{notice}</div>}

              <div style={S.stats}>
                <span>{t('الإعلانات', 'Listings')}: <b>{detail.counts.listings}</b></span>
                <span>{t('الحجوزات', 'Bookings')}: <b>{detail.counts.bookings}</b></span>
                <span>{t('الدفعات', 'Payments')}: <b>{detail.counts.paymentProofs}</b></span>
                <span>{t('الهوية', 'ID')}: <b>{detail.idDocumentStatus || '—'}</b></span>
              </div>

              <div style={S.actions}>
                {detail.status !== 'ACTIVE' && (
                  <button style={{ ...S.btn, ...S.ok }} disabled={busy} onClick={() => void changeStatus('ACTIVE')}>
                    {t('إعادة تفعيل', 'Reinstate')}
                  </button>
                )}
                {detail.status !== 'SUSPENDED' && detail.status !== 'DELETED' && (
                  <button style={{ ...S.btn, ...S.warn }} disabled={busy} onClick={() => void changeStatus('SUSPENDED')}>
                    {t('تعليق (إيقاف)', 'Suspend')}
                  </button>
                )}
                {detail.status !== 'DELETED' && (
                  <button style={{ ...S.btn, ...S.danger }} disabled={busy} onClick={() => void changeStatus('DELETED')}>
                    {t('حذف', 'Delete')}
                  </button>
                )}
                <button style={S.btn} disabled={busy} onClick={() => void saveName()}>{t('تعديل الاسم', 'Edit name')}</button>
              </div>

              <div style={S.histTitle}>{t('آخر الإجراءات', 'Recent actions')}</div>
              <div style={S.hist}>
                {!detail.recentActivity.length && <span style={S.empty}>{t('لا سجل.', 'No history.')}</span>}
                {detail.recentActivity.map((h, i) => (
                  <div key={i} style={S.histRow}>
                    <span>{h.action}</span>
                    <span style={S.histTime}>{new Date(h.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 14 },
  controls: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  input: { background: '#0f1118', color: '#e8ecf3', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, padding: '9px 11px', fontSize: 13 },
  btn: { background: '#1b2130', color: '#e8ecf3', border: '1px solid rgba(255,255,255,.16)', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  ok: { background: 'rgba(32,210,155,.16)', borderColor: '#20d29b', color: '#6ff0c8' },
  warn: { background: 'rgba(230,184,13,.16)', borderColor: '#e6b80d', color: '#f2d879' },
  danger: { background: 'rgba(255,92,120,.16)', borderColor: '#ff5c78', color: '#ff9fb1' },
  error: { color: '#ff9fb1', background: 'rgba(255,92,120,.1)', border: '1px solid rgba(255,92,120,.35)', borderRadius: 8, padding: '9px 12px', fontSize: 13 },
  notice: { color: '#6ff0c8', background: 'rgba(32,210,155,.1)', border: '1px solid rgba(32,210,155,.3)', borderRadius: 8, padding: '8px 11px', fontSize: 12.5 },
  body: { display: 'grid', gridTemplateColumns: 'minmax(220px,340px) 1fr', gap: 14, alignItems: 'start' },
  list: { display: 'grid', gap: 8, maxHeight: 460, overflowY: 'auto' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, textAlign: 'start', background: '#12141d', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', color: '#e8ecf3' },
  rowActive: { borderColor: 'rgba(120,170,255,.6)', background: '#161a26' },
  rowMain: { display: 'grid', gap: 2, minWidth: 0 },
  name: { fontSize: 13.5, fontWeight: 700 },
  email: { fontSize: 12, color: '#93a0b5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  roles: { fontSize: 11.5, color: '#7d8aa0', marginTop: 3, letterSpacing: '.03em', textTransform: 'uppercase' },
  badge: { fontSize: 11, fontWeight: 800, border: '1px solid', borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' },
  detail: { background: '#12141d', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 16, display: 'grid', gap: 12, minHeight: 200 },
  dHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  dName: { fontSize: 17, fontWeight: 800 },
  stats: { display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12.5, color: '#aab4c6' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  histTitle: { fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: '#7d8aa0', marginTop: 4 },
  hist: { display: 'grid', gap: 6 },
  histRow: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: '#c4ccd9', borderBottom: '1px solid rgba(255,255,255,.05)', paddingBottom: 5 },
  histTime: { color: '#7d8aa0', fontVariantNumeric: 'tabular-nums' },
  empty: { color: '#7d8aa0', fontSize: 13, padding: '8px 2px' },
}

export default AccountControlPanel
