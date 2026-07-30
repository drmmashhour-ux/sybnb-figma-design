import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createAdminStaff,
  fetchAdminBookings,
  fetchAdminDisputes,
  fetchAdminNeedsAttention,
  fetchAdminPayouts,
  fetchAdminRevenueSummary,
  fetchAdminStaff,
  fetchAdminUsers,
  fetchPrototypeAdminMetrics,
  fetchPrototypeReviewQueue,
  forceCancelBooking,
  setAdminListingStatus,
  setAdminUserStatus,
  type AdminBookingRow,
  type AdminDirectoryUser,
  type AdminNeedsAttention,
  type AdminPayout,
  type PlatformAdminMetrics,
  type PlatformDispute,
  type PlatformListing,
  type PlatformRevenueSummary,
  type PlatformReviewQueue,
  type PlatformStaffMember,
} from '../../shared/api/platformApi'
import { listingTitleText, moneyText } from '../../shared/i18n/display'
import { AccountControlPanel } from './AccountControlPanel'
import { LoyaltyPanel } from './LoyaltyPanel'

type Props = { lang: Lang }

type TabId = 'guest' | 'hosting' | 'accounting' | 'directory' | 'needs' | 'hr'

const CREATABLE_ROLES = ['ADMIN', 'SUPPORT'] as const

const T = {
  ar: {
    title: 'مركز تحكم SYBNB',
    subtitle: 'لوحة موحّدة — بيانات حقيقية من واجهات الإدارة.',
    loading: 'جار التحميل...',
    error: 'تعذر تحميل بعض البيانات.',
    tabs: { guest: 'العملاء', hosting: 'المضيفون', accounting: 'المحاسبة', directory: 'الإدارة', needs: 'يحتاج انتباه', hr: 'الموارد البشرية' },
    accountControl: 'التحكم بالحسابات',
    accountControlHint: 'افتح أي حساب وأصلح مشاكله، أو علّقه أو أعد تفعيله أو احذفه. كل إجراء يُسجَّل.',
    loyalty: 'الولاء والتقييم',
    loyaltyHint: 'يقترح الذكاء الاصطناعي مستويات الثقة للمضيفين والعملاء — والإدارة تعتمد أو ترفض. لا يتغير أي مستوى دون اعتماد.',
    userSearch: 'ابحث بالاسم أو البريد',
    roleAll: 'كل الأدوار',
    statusCol: 'الحالة',
    suspend: 'تعليق',
    reinstate: 'إعادة تفعيل',
    close: 'إغلاق',
    working: 'جارٍ...',
    usersTitle: 'دليل المستخدمين',
    bookingsTitle: 'دليل الحجوزات',
    bookingStatusAll: 'كل الحالات',
    forceCancel: 'إلغاء + استرداد',
    confirmForceCancel: 'تأكيد إلغاء الحجز واسترداد الضيف؟',
    takedown: 'إخفاء (إيقاف)',
    restore: 'إعادة نشر',
    takedownDone: 'تم تحديث حالة الإعلان.',
    needsTitle: 'مهام تحتاج انتباه',
    needsStuck: 'حجوزات عالقة بانتظار الدفع',
    needsNoPayout: 'مضيفون لديهم رصيد بلا حساب صرف',
    needsImbalance: 'محافظ غير متطابقة مع السجل',
    needsReview: 'مراجعات متأخرة',
    needsDisputes: 'نزاعات متأخرة',
    needsSos: 'بلاغات SOS متأخرة',
    actionDone: 'تم التنفيذ.',
    actionError: 'تعذر تنفيذ الإجراء.',
    passed: 'مقبول',
    pending: 'قيد المراجعة',
    flagged: 'مُعلَّم',
    open: 'فتح الصفحة',
    reviewQueue: 'قائمة المراجعة',
    disputes: 'النزاعات',
    finance: 'المالية',
    guestVerif: 'توثيق الهوية (قيد المراجعة)',
    guestPayments: 'إثباتات الدفع المعلّقة',
    guestBookings: 'حجوزات بانتظار القرار',
    guestApprovedPayments: 'مدفوعات مقبولة',
    guestOpenDisputes: 'نزاعات مفتوحة',
    none: 'لا عناصر.',
    hostingApproved: 'إعلانات منشورة',
    hostingPending: 'إعلانات قيد المراجعة',
    hostingRejected: 'إعلانات مرفوضة',
    hostsCount: 'عدد المضيفين',
    aiFlagsTitle: 'أعلام فحص الذكاء الاصطناعي',
    aiFlags: 'أعلام AI',
    aiNoFlags: 'لا أعلام على الإعلانات المعروضة في قائمة المراجعة.',
    revenue: 'الإيراد (عمولة STR الحقيقية)',
    totalRevenue: 'إجمالي الإيراد',
    proj30: 'توقّع 30 يوم',
    proj90: 'توقّع 90 يوم',
    walletBalance: 'رصيد المحافظ',
    approvedVolume: 'حجم المدفوعات المقبولة',
    approvedCount: 'عدد المدفوعات المقبولة',
    refunds: 'المبالغ المُعادة',
    movements: 'حركات الصرف المعلّقة',
    payoutHost: 'المضيف',
    payoutAmount: 'المبلغ',
    payoutAccount: 'حساب شام كاش',
    payoutEligible: 'جاهز للصرف',
    payoutHold: 'ضمن فترة الحماية',
    holdDaysNote: (d: number) => `فترة الحماية: ${d} يوم بعد المغادرة قبل السماح بالصرف.`,
    noAccount: 'لا حساب مسجّل',
    srRides: 'رحلات SR مكتملة (بلا عمولة منصة)',
    hrDirectory: 'دليل الطاقم',
    hrRole: 'الدور',
    hrEmail: 'البريد',
    hrCreated: 'أُنشئ',
    hrAddTitle: 'إضافة عضو طاقم/إدارة',
    hrName: 'الاسم الظاهر',
    hrEmailField: 'البريد (@sybnb.app)',
    hrRoleField: 'الدور',
    hrAdd: 'إنشاء الحساب',
    hrAdding: 'جار الإنشاء...',
    hrDomainNote: 'يجب أن يكون البريد على نطاق @sybnb.app.',
    hrMailboxNote: 'يُنشأ صندوق البريد نفسه في Google Workspace؛ هذا فقط يهيّئ الحساب والدور.',
    hrCreated2: 'تم إنشاء الحساب.',
    hrEmpty: 'لا يوجد طاقم بعد.',
  },
  en: {
    title: 'SYBNB Control Center',
    subtitle: 'One unified board — real data from the admin APIs.',
    loading: 'Loading...',
    error: 'Some data could not be loaded.',
    tabs: { guest: 'Guests', hosting: 'Hosts', accounting: 'Accounting', directory: 'Management', needs: 'Needs attention', hr: 'HR' },
    accountControl: 'Account control',
    accountControlHint: 'Open any account and fix its problems, or suspend / reinstate / delete it. Every action is logged.',
    loyalty: 'Loyalty & standing',
    loyaltyHint: 'AI proposes trust tiers for hosts and guests — admins approve or reject. No tier changes without approval.',
    userSearch: 'Search by name or email',
    roleAll: 'All roles',
    statusCol: 'Status',
    suspend: 'Suspend',
    reinstate: 'Reinstate',
    close: 'Close',
    working: 'Working...',
    usersTitle: 'User directory',
    bookingsTitle: 'Booking directory',
    bookingStatusAll: 'All statuses',
    forceCancel: 'Cancel + refund',
    confirmForceCancel: 'Force-cancel this booking and refund the guest?',
    takedown: 'Take down (pause)',
    restore: 'Restore',
    takedownDone: 'Listing status updated.',
    needsTitle: 'Needs attention',
    needsStuck: 'Bookings stuck awaiting payment',
    needsNoPayout: 'Hosts holding money with no payout method',
    needsImbalance: 'Wallets out of sync with the ledger',
    needsReview: 'Aging review items',
    needsDisputes: 'Aging disputes',
    needsSos: 'Aging SOS events',
    actionDone: 'Done.',
    actionError: 'Could not complete the action.',
    passed: 'Passed',
    pending: 'Pending',
    flagged: 'Flagged',
    open: 'Open page',
    reviewQueue: 'Review queue',
    disputes: 'Disputes',
    finance: 'Finance',
    guestVerif: 'ID verification (pending)',
    guestPayments: 'Pending payment proofs',
    guestBookings: 'Bookings awaiting decision',
    guestApprovedPayments: 'Approved payments',
    guestOpenDisputes: 'Open disputes',
    none: 'No items.',
    hostingApproved: 'Approved listings',
    hostingPending: 'Listings pending review',
    hostingRejected: 'Rejected listings',
    hostsCount: 'Hosts',
    aiFlagsTitle: 'AI claim-check flags',
    aiFlags: 'AI flags',
    aiNoFlags: 'No flags on the listings currently in the review queue.',
    revenue: 'Revenue (real STR commission)',
    totalRevenue: 'Total revenue',
    proj30: '30-day projection',
    proj90: '90-day projection',
    walletBalance: 'Wallet balances',
    approvedVolume: 'Approved payment volume',
    approvedCount: 'Approved payments',
    refunds: 'Refunds',
    movements: 'Pending payout movements',
    payoutHost: 'Host',
    payoutAmount: 'Amount',
    payoutAccount: 'Sham Cash account',
    payoutEligible: 'Eligible now',
    payoutHold: 'In protection hold',
    holdDaysNote: (d: number) => `Protection hold: ${d} days after checkout before payout is allowed.`,
    noAccount: 'No account on file',
    srRides: 'Completed SR rides (no platform commission)',
    hrDirectory: 'Staff directory',
    hrRole: 'Role',
    hrEmail: 'Email',
    hrCreated: 'Created',
    hrAddTitle: 'Add a staff/admin member',
    hrName: 'Display name',
    hrEmailField: 'Email (@sybnb.app)',
    hrRoleField: 'Role',
    hrAdd: 'Create account',
    hrAdding: 'Creating...',
    hrDomainNote: 'Email must be on the @sybnb.app domain.',
    hrMailboxNote: 'The mailbox itself is created in Google Workspace; this only sets the account + role.',
    hrCreated2: 'Account created.',
    hrEmpty: 'No staff yet.',
  },
}

function go(hash: string) {
  window.location.hash = hash
}

type ClaimCheckMeta = {
  flagCount?: number
  checks?: Array<{ amenityAr?: string; amenityEn?: string; verdict?: string; reason?: string }>
}

function claimChecksOf(listing: PlatformListing): ClaimCheckMeta | null {
  const meta = listing.metadata as Record<string, unknown> | undefined
  const cc = meta?.claimChecks
  return cc && typeof cc === 'object' ? (cc as ClaimCheckMeta) : null
}

export function AdminControlCenterPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = T[lang]
  const [tab, setTab] = useState<TabId>('guest')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [queue, setQueue] = useState<PlatformReviewQueue | null>(null)
  const [metrics, setMetrics] = useState<PlatformAdminMetrics | null>(null)
  const [revenue, setRevenue] = useState<PlatformRevenueSummary | null>(null)
  const [payouts, setPayouts] = useState<{ payouts: AdminPayout[]; holdDays: number } | null>(null)
  const [disputes, setDisputes] = useState<PlatformDispute[]>([])
  const [staff, setStaff] = useState<PlatformStaffMember[]>([])
  const [needs, setNeeds] = useState<AdminNeedsAttention | null>(null)

  // Directory
  const [users, setUsers] = useState<AdminDirectoryUser[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [bookings, setBookings] = useState<AdminBookingRow[]>([])
  const [bookingStatus, setBookingStatus] = useState('')
  const [actionBusy, setActionBusy] = useState('')
  const [actionMsg, setActionMsg] = useState('')

  // HR form
  const [hrName, setHrName] = useState('')
  const [hrEmail, setHrEmail] = useState('')
  const [hrRole, setHrRole] = useState<string>('SUPPORT')
  const [hrBusy, setHrBusy] = useState(false)
  const [hrError, setHrError] = useState('')
  const [hrMessage, setHrMessage] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    Promise.allSettled([
      fetchPrototypeReviewQueue(),
      fetchPrototypeAdminMetrics(),
      fetchAdminRevenueSummary(),
      fetchAdminPayouts(),
      fetchAdminDisputes(),
      fetchAdminStaff(),
      fetchAdminNeedsAttention(),
    ])
      .then((results) => {
        if (!active) return
        const [q, m, r, p, d, s, n] = results
        if (q.status === 'fulfilled') setQueue(q.value)
        if (m.status === 'fulfilled') setMetrics(m.value)
        if (r.status === 'fulfilled') setRevenue(r.value)
        if (p.status === 'fulfilled') setPayouts(p.value)
        if (d.status === 'fulfilled') setDisputes(d.value)
        if (s.status === 'fulfilled') setStaff(s.value)
        if (n.status === 'fulfilled') setNeeds(n.value)
        if (results.some((res) => res.status === 'rejected')) setError(t.error)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Directory data loads on demand when the tab opens (or on search submit).
  async function loadUsers() {
    try {
      const res = await fetchAdminUsers({ search: userSearch.trim() || undefined })
      setUsers(res.users)
    } catch {
      setActionMsg(t.actionError)
    }
  }
  async function loadBookings() {
    try {
      const res = await fetchAdminBookings({ status: bookingStatus || undefined })
      setBookings(res.bookings)
    } catch {
      setActionMsg(t.actionError)
    }
  }
  useEffect(() => {
    if (tab === 'directory') {
      void loadUsers()
      void loadBookings()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  async function changeUserStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED') {
    setActionBusy(userId)
    setActionMsg('')
    try {
      const updated = await setAdminUserStatus(userId, status)
      setUsers((cur) => cur.map((u) => (u.id === userId ? { ...u, status: updated.status } : u)))
      setActionMsg(t.actionDone)
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : t.actionError)
    } finally {
      setActionBusy('')
    }
  }

  async function takedownListing(listingId: string, status: 'PAUSED' | 'APPROVED') {
    setActionBusy(listingId)
    setActionMsg('')
    try {
      await setAdminListingStatus(listingId, status)
      setActionMsg(t.takedownDone)
      // Reflect in the review queue view if present.
      setQueue((cur) => (cur ? { ...cur, listings: cur.listings.map((l) => (l.id === listingId ? { ...l, status } : l)) } : cur))
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : t.actionError)
    } finally {
      setActionBusy('')
    }
  }

  async function doForceCancel(bookingId: string) {
    if (!window.confirm(t.confirmForceCancel)) return
    setActionBusy(bookingId)
    setActionMsg('')
    try {
      await forceCancelBooking(bookingId)
      setBookings((cur) => cur.map((b) => (b.id === bookingId ? { ...b, status: 'CANCELLED' } : b)))
      setActionMsg(t.actionDone)
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : t.actionError)
    } finally {
      setActionBusy('')
    }
  }

  const openDisputes = useMemo(() => disputes.filter((d) => d.status === 'OPEN'), [disputes])

  async function submitStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setHrError('')
    setHrMessage('')
    setHrBusy(true)
    try {
      const created = await createAdminStaff({ displayName: hrName.trim(), email: hrEmail.trim(), role: hrRole })
      setStaff((current) => [...current, created])
      setHrName('')
      setHrEmail('')
      setHrMessage(t.hrCreated2)
    } catch (err) {
      setHrError(err instanceof Error ? err.message : t.error)
    } finally {
      setHrBusy(false)
    }
  }

  const num = (map: Record<string, number> | undefined, key: string) => (map ? map[key] || 0 : 0)

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.subtitle}>{t.subtitle}</p>
      </header>

      <nav style={styles.tabs} aria-label={t.title}>
        {(['guest', 'hosting', 'accounting', 'directory', 'needs', 'hr'] as TabId[]).map((id) => (
          <button
            key={id}
            style={{ ...styles.tab, ...(tab === id ? styles.tabActive : {}) }}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {t.tabs[id]}
          </button>
        ))}
      </nav>

      {error && <p style={styles.error}>{error}</p>}
      {loading && <p style={styles.muted}>{t.loading}</p>}

      {!loading && tab === 'guest' && (
        <section style={styles.group}>
          <div style={styles.chipRow}>
            <Chip tone="green" label={t.passed} value={num(metrics?.paymentsByStatus, 'APPROVED')} sub={t.guestApprovedPayments} />
            <Chip tone="gold" label={t.pending} value={(queue?.idDocuments.length || 0) + (queue?.payments.length || 0)} sub={`${t.guestVerif} · ${t.guestPayments}`} />
            <Chip tone="red" label={t.flagged} value={openDisputes.length} sub={t.guestOpenDisputes} />
          </div>

          <Card title={t.guestVerif} count={queue?.idDocuments.length || 0}>
            {queue?.idDocuments.length
              ? queue.idDocuments.slice(0, 8).map((doc) => (
                  <Row key={doc.id} left={doc.displayName} right={doc.email || doc.id.slice(0, 8)} />
                ))
              : <p style={styles.muted}>{t.none}</p>}
          </Card>

          <Card title={t.guestBookings} count={queue?.bookings.length || 0}>
            {queue?.bookings.length
              ? queue.bookings.slice(0, 8).map((b) => (
                  <Row key={b.id} left={b.listing ? listingTitleText(b.listing, lang) : b.id.slice(0, 8)} right={b.status} />
                ))
              : <p style={styles.muted}>{t.none}</p>}
          </Card>

          <div style={styles.linkRow}>
            <button style={styles.linkButton} onClick={() => go('/admin/review')}>{t.reviewQueue} →</button>
            <button style={styles.linkButton} onClick={() => go('/admin/disputes')}>{t.disputes} →</button>
          </div>
        </section>
      )}

      {!loading && tab === 'hosting' && (
        <section style={styles.group}>
          <div style={styles.chipRow}>
            <Chip tone="green" label={t.passed} value={num(metrics?.listingsByStatus, 'APPROVED')} sub={t.hostingApproved} />
            <Chip tone="gold" label={t.pending} value={num(metrics?.listingsByStatus, 'PENDING_REVIEW')} sub={t.hostingPending} />
            <Chip tone="red" label={t.flagged} value={num(metrics?.listingsByStatus, 'REJECTED')} sub={t.hostingRejected} />
            <Chip tone="blue" label={t.hostsCount} value={num(metrics?.usersByRole, 'HOST')} sub={t.hostsCount} />
          </div>

          <Card title={t.aiFlagsTitle} count={(queue?.listings || []).filter((l) => (claimChecksOf(l)?.flagCount || 0) > 0).length}>
            {(() => {
              const flagged = (queue?.listings || []).filter((l) => (claimChecksOf(l)?.flagCount || 0) > 0)
              if (!flagged.length) return <p style={styles.muted}>{t.aiNoFlags}</p>
              return flagged.map((listing) => {
                const cc = claimChecksOf(listing)
                const flags = (cc?.checks || []).filter((c) => c.verdict && c.verdict !== 'yes')
                return (
                  <div key={listing.id} style={styles.flagCard}>
                    <div style={styles.flagHead}>
                      <strong>{listingTitleText(listing, lang)}</strong>
                      <span style={styles.flagBadge}>🚩 {cc?.flagCount || flags.length} {t.aiFlags}</span>
                    </div>
                    {flags.map((f, i) => (
                      <div key={i} style={styles.flagLine}>
                        ‘{isAr ? f.amenityAr : f.amenityEn}’ — {f.verdict}{f.reason ? ` · ${f.reason}` : ''}
                      </div>
                    ))}
                    <div style={styles.rowActions}>
                      {listing.status === 'PAUSED' ? (
                        <button style={styles.smallBtn} disabled={actionBusy === listing.id} onClick={() => void takedownListing(listing.id, 'APPROVED')}>
                          {actionBusy === listing.id ? t.working : t.restore}
                        </button>
                      ) : (
                        <button style={styles.smallBtnDanger} disabled={actionBusy === listing.id} onClick={() => void takedownListing(listing.id, 'PAUSED')}>
                          {actionBusy === listing.id ? t.working : t.takedown}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            })()}
          </Card>
          {actionMsg && <p style={styles.hint}>{actionMsg}</p>}

          <div style={styles.linkRow}>
            <button style={styles.linkButton} onClick={() => go('/admin/review')}>{t.reviewQueue} →</button>
          </div>
        </section>
      )}

      {!loading && tab === 'accounting' && (
        <section style={styles.group}>
          <div style={styles.chipRow}>
            {(revenue?.byCurrency || []).map((c) => (
              <Chip key={c.currency} tone="green" label={`${t.totalRevenue} (${c.currency})`} valueText={moneyText(c.totalRevenueMinor, c.currency, lang)} sub={`${t.proj30}: ${moneyText(c.projection.next30DaysMinor, c.currency, lang)}`} />
            ))}
            {(revenue?.byCurrency || []).length === 0 && <Chip tone="gold" label={t.revenue} value={0} sub={t.none} />}
          </div>

          <div style={styles.chipRow}>
            <Chip tone="blue" label={t.walletBalance} valueText={moneyText(metrics?.walletBalanceMinor || 0, 'SYP', lang)} sub={`${metrics?.walletCount || 0}`} />
            <Chip tone="green" label={t.approvedVolume} valueText={moneyText(metrics?.approvedPaymentVolumeMinor || 0, 'SYP', lang)} sub={`${t.approvedCount}: ${metrics?.approvedPaymentCount || 0}`} />
            <Chip tone="red" label={t.refunds} value={num(metrics?.paymentsByStatus, 'REFUNDED')} sub={t.refunds} />
          </div>

          <Card title={t.movements} count={payouts?.payouts.length || 0}>
            {payouts?.holdDays ? <p style={styles.hint}>{t.holdDaysNote(payouts.holdDays)}</p> : null}
            {payouts?.payouts.length
              ? payouts.payouts.slice(0, 12).map((p) => (
                  <div key={p.bookingId} style={styles.payoutRow}>
                    <div style={styles.payoutMain}>
                      <strong>{p.listingTitle || p.bookingId.slice(0, 8)}</strong>
                      <small>{p.hostName || p.hostId?.slice(0, 8) || '-'}</small>
                    </div>
                    <div style={styles.payoutMeta}>
                      <b dir="ltr">{moneyText(p.hostPayoutMinor, p.currency, lang)}</b>
                      <small dir="ltr">
                        {p.hostPayoutMethod ? `•••• ${p.hostPayoutMethod.last4}` : t.noAccount}
                      </small>
                      <span style={{ ...styles.payoutTag, ...(p.eligibleNow ? styles.tagGreen : styles.tagGold) }}>
                        {p.eligibleNow ? t.payoutEligible : t.payoutHold}
                      </span>
                    </div>
                  </div>
                ))
              : <p style={styles.muted}>{t.none}</p>}
          </Card>

          {revenue ? (
            <p style={styles.hint}>{t.srRides}: {revenue.srRidesCompletedCount}</p>
          ) : null}

          <div style={styles.linkRow}>
            <button style={styles.linkButton} onClick={() => go('/finance')}>{t.finance} →</button>
          </div>
        </section>
      )}

      {!loading && tab === 'directory' && (
        <section style={styles.group}>
          {actionMsg && <p style={styles.hint}>{actionMsg}</p>}
          <Card title={t.accountControl}>
            <p style={styles.hint}>{t.accountControlHint}</p>
            <AccountControlPanel lang={lang} />
          </Card>
          <Card title={t.loyalty}>
            <p style={styles.hint}>{t.loyaltyHint}</p>
            <LoyaltyPanel lang={lang} />
          </Card>
          <Card title={t.usersTitle} count={users.length}>
            <form
              style={styles.searchRow}
              onSubmit={(e) => {
                e.preventDefault()
                void loadUsers()
              }}
            >
              <input style={styles.input} placeholder={t.userSearch} value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
              <button type="submit" style={styles.smallBtn}>{isAr ? 'بحث' : 'Search'}</button>
            </form>
            {users.map((u) => (
              <div key={u.id} style={styles.dirRow}>
                <div style={styles.dirMain}>
                  <strong>{u.displayName}</strong>
                  <small dir="ltr" style={styles.mono}>{u.email || '-'}</small>
                  <span style={styles.roleBadges}>{u.roles.join(' · ')}</span>
                </div>
                <div style={styles.dirActions}>
                  <span style={{ ...styles.statusTag, ...(u.status === 'ACTIVE' ? styles.tagGreen : styles.tagRed) }}>{u.status}</span>
                  {u.status === 'ACTIVE' ? (
                    <>
                      <button style={styles.smallBtnDanger} disabled={actionBusy === u.id} onClick={() => void changeUserStatus(u.id, 'SUSPENDED')}>{t.suspend}</button>
                      <button style={styles.smallBtnDanger} disabled={actionBusy === u.id} onClick={() => void changeUserStatus(u.id, 'CLOSED')}>{t.close}</button>
                    </>
                  ) : (
                    <button style={styles.smallBtn} disabled={actionBusy === u.id} onClick={() => void changeUserStatus(u.id, 'ACTIVE')}>{t.reinstate}</button>
                  )}
                </div>
              </div>
            ))}
            {users.length === 0 && <p style={styles.muted}>{t.none}</p>}
          </Card>

          <Card title={t.bookingsTitle} count={bookings.length}>
            <form
              style={styles.searchRow}
              onSubmit={(e) => {
                e.preventDefault()
                void loadBookings()
              }}
            >
              <select style={styles.input} value={bookingStatus} onChange={(e) => setBookingStatus(e.target.value)}>
                <option value="">{t.bookingStatusAll}</option>
                {['PAYMENT_PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'DISPUTED'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button type="submit" style={styles.smallBtn}>{isAr ? 'بحث' : 'Search'}</button>
            </form>
            {bookings.map((b) => (
              <div key={b.id} style={styles.dirRow}>
                <div style={styles.dirMain}>
                  <strong>{b.listing ? (isAr ? b.listing.titleAr : b.listing.titleEn || b.listing.titleAr) : b.id.slice(0, 8)}</strong>
                  <small>{b.guest?.displayName || b.guest?.id?.slice(0, 8) || '-'}</small>
                  <span dir="ltr">{moneyText(b.amountMinor, b.currency, lang)}</span>
                </div>
                <div style={styles.dirActions}>
                  <span style={{ ...styles.statusTag, ...(b.status === 'CANCELLED' ? styles.tagRed : styles.tagGold) }}>{b.status}</span>
                  {['CONFIRMED', 'PAYMENT_PENDING'].includes(b.status) && (
                    <button style={styles.smallBtnDanger} disabled={actionBusy === b.id} onClick={() => void doForceCancel(b.id)}>
                      {actionBusy === b.id ? t.working : t.forceCancel}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {bookings.length === 0 && <p style={styles.muted}>{t.none}</p>}
          </Card>
        </section>
      )}

      {!loading && tab === 'needs' && (
        <section style={styles.group}>
          <h2 className="" style={styles.cardTitle}>{t.needsTitle}</h2>
          <div style={styles.chipRow}>
            <Chip tone="red" label={t.needsStuck} value={needs?.counts.stuckPayments || 0} />
            <Chip tone="gold" label={t.needsNoPayout} value={needs?.counts.noPayoutMethodHosts || 0} />
            <Chip tone="red" label={t.needsImbalance} value={needs?.counts.imbalancedWallets || 0} />
            <Chip tone="gold" label={t.needsReview} value={needs?.counts.agingReviewListings || 0} />
            <Chip tone="gold" label={t.needsDisputes} value={needs?.counts.agingDisputes || 0} />
            <Chip tone="red" label={t.needsSos} value={needs?.counts.agingSos || 0} />
          </div>

          <Card title={t.needsStuck} count={needs?.items.stuckBookings.length || 0}>
            {needs?.items.stuckBookings.length
              ? needs.items.stuckBookings.slice(0, 15).map((b) => (
                  <div key={b.id} style={styles.dirRow}>
                    <div style={styles.dirMain}>
                      <strong>{b.listing?.titleAr || b.id.slice(0, 8)}</strong>
                      <small dir="ltr">{new Date(b.createdAt).toLocaleString(isAr ? 'ar-SY' : 'en-US')}</small>
                    </div>
                    <button style={styles.smallBtnDanger} disabled={actionBusy === b.id} onClick={() => void doForceCancel(b.id)}>
                      {actionBusy === b.id ? t.working : t.forceCancel}
                    </button>
                  </div>
                ))
              : <p style={styles.muted}>{t.none}</p>}
          </Card>

          <Card title={t.needsNoPayout} count={needs?.items.noPayoutMethodHosts.length || 0}>
            {needs?.items.noPayoutMethodHosts.length
              ? needs.items.noPayoutMethodHosts.slice(0, 15).map((h) => (
                  <Row key={h.userId} left={h.displayName} right={moneyText(h.cachedBalanceMinor, h.currency, lang)} />
                ))
              : <p style={styles.muted}>{t.none}</p>}
          </Card>

          <Card title={t.needsImbalance} count={needs?.items.imbalancedWallets.length || 0}>
            {needs?.items.imbalancedWallets.length
              ? needs.items.imbalancedWallets.slice(0, 15).map((w) => (
                  <Row
                    key={w.walletId}
                    left={`${w.userId?.slice(0, 8) || w.walletId.slice(0, 8)} (${w.currency})`}
                    right={`${moneyText(w.cachedBalanceMinor, w.currency, lang)} ≠ ${moneyText(w.computedBalanceMinor, w.currency, lang)}`}
                  />
                ))
              : <p style={styles.muted}>{t.none}</p>}
          </Card>
        </section>
      )}

      {!loading && tab === 'hr' && (
        <section style={styles.group}>
          <Card title={t.hrDirectory} count={staff.length}>
            {staff.length ? (
              <div style={styles.staffTable}>
                <div style={styles.staffHead}>
                  <span>{t.hrName}</span>
                  <span>{t.hrEmail}</span>
                  <span>{t.hrRole}</span>
                </div>
                {staff.map((s) => (
                  <div key={s.id} style={styles.staffRow}>
                    <strong>{s.displayName}</strong>
                    <span dir="ltr" style={styles.mono}>{s.email || '-'}</span>
                    <span style={styles.roleBadges}>{s.roles.join(' · ')}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={styles.muted}>{t.hrEmpty}</p>
            )}
          </Card>

          <form style={styles.hrForm} onSubmit={submitStaff}>
            <h3 style={styles.hrFormTitle}>{t.hrAddTitle}</h3>
            <label style={styles.field}>
              <span>{t.hrName}</span>
              <input style={styles.input} value={hrName} onChange={(e) => setHrName(e.target.value)} required />
            </label>
            <label style={styles.field}>
              <span>{t.hrEmailField}</span>
              <input
                style={styles.input}
                dir="ltr"
                type="email"
                placeholder="name@sybnb.app"
                value={hrEmail}
                onChange={(e) => setHrEmail(e.target.value)}
                required
              />
              <small style={styles.hint}>{t.hrDomainNote}</small>
            </label>
            <label style={styles.field}>
              <span>{t.hrRoleField}</span>
              <select style={styles.input} value={hrRole} onChange={(e) => setHrRole(e.target.value)}>
                {CREATABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>

            <p style={styles.mailboxNote}>ℹ︎ {t.hrMailboxNote}</p>
            {hrError && <p style={styles.error}>{hrError}</p>}
            {hrMessage && <p style={styles.success}>{hrMessage}</p>}

            <button type="submit" disabled={hrBusy} style={styles.createButton}>
              {hrBusy ? t.hrAdding : t.hrAdd}
            </button>
          </form>
        </section>
      )}
    </main>
  )
}

function Chip({
  tone,
  label,
  value,
  valueText,
  sub,
}: {
  tone: 'green' | 'gold' | 'red' | 'blue'
  label: string
  value?: number
  valueText?: string
  sub?: string
}) {
  const toneStyle = tone === 'green' ? styles.chipGreen : tone === 'gold' ? styles.chipGold : tone === 'red' ? styles.chipRed : styles.chipBlue
  return (
    <div style={{ ...styles.chip, ...toneStyle }}>
      <span style={styles.chipLabel}>{label}</span>
      <strong style={styles.chipValue}>{valueText ?? value ?? 0}</strong>
      {sub ? <small style={styles.chipSub}>{sub}</small> : null}
    </div>
  )
}

function Card({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section style={styles.card}>
      <div style={styles.cardHead}>
        <h2 style={styles.cardTitle}>{title}</h2>
        {typeof count === 'number' ? <span style={styles.cardCount}>{count}</span> : null}
      </div>
      <div style={styles.cardBody}>{children}</div>
    </section>
  )
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div style={styles.simpleRow}>
      <strong>{left}</strong>
      <span dir="ltr">{right}</span>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '32px 16px 90px', display: 'grid', gap: 20, maxWidth: 1180, margin: '0 auto' },
  header: { display: 'grid', gap: 6 },
  title: { margin: 0, fontSize: 32, lineHeight: 1.1 },
  subtitle: { margin: 0, color: '#9aa6ba' },
  tabs: { display: 'flex', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid #242735', paddingBottom: 10 },
  tab: { minHeight: 46, border: '1px solid #242735', borderRadius: 999, background: '#101119', color: '#9aa6ba', fontWeight: 900, padding: '0 20px' },
  tabActive: { background: 'rgba(213,169,21,.14)', borderColor: 'rgba(213,169,21,.55)', color: '#e5b80b' },
  group: { display: 'grid', gap: 16 },
  chipRow: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  chip: { border: '1px solid #242735', borderRadius: 12, background: '#101119', padding: 16, display: 'grid', gap: 6 },
  chipGreen: { borderColor: 'rgba(32,210,155,.4)' },
  chipGold: { borderColor: 'rgba(229,184,11,.4)' },
  chipRed: { borderColor: 'rgba(255,78,119,.4)' },
  chipBlue: { borderColor: 'rgba(82,108,255,.4)' },
  chipLabel: { color: '#9aa6ba', fontSize: 13, fontWeight: 800 },
  chipValue: { fontSize: 26, fontWeight: 950 },
  chipSub: { color: '#6f7688', fontSize: 12, fontWeight: 700 },
  card: { border: '1px solid #1e1e2a', borderRadius: 12, background: '#111118', padding: 16, display: 'grid', gap: 12 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  cardTitle: { margin: 0, fontSize: 18 },
  cardCount: { minWidth: 30, textAlign: 'center', borderRadius: 999, background: '#1d2332', color: '#fff', fontWeight: 900, padding: '2px 10px' },
  cardBody: { display: 'grid', gap: 8 },
  simpleRow: { display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #1a1a24', paddingBottom: 8, color: '#9aa6ba' },
  muted: { margin: 0, color: '#9aa6ba' },
  hint: { margin: 0, color: '#6f7688', fontSize: 12, fontWeight: 600 },
  error: { margin: 0, color: '#ffd1d1', fontWeight: 800 },
  success: { margin: 0, color: '#20d29b', fontWeight: 800 },
  linkRow: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  linkButton: { minHeight: 46, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 16px' },
  flagCard: { border: '1px solid rgba(229,184,11,.4)', borderRadius: 8, background: 'rgba(229,184,11,.06)', padding: 12, display: 'grid', gap: 6 },
  flagHead: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  flagBadge: { color: '#e5b80b', fontWeight: 900, fontSize: 13 },
  flagLine: { color: '#ffe6a3', fontSize: 13, fontWeight: 700 },
  payoutRow: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', borderBottom: '1px solid #1a1a24', paddingBottom: 10, flexWrap: 'wrap' },
  payoutMain: { display: 'grid', gap: 2 },
  payoutMeta: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  payoutTag: { borderRadius: 8, padding: '4px 10px', fontWeight: 900, fontSize: 12 },
  tagGreen: { background: 'rgba(32,210,155,.14)', color: '#20d29b' },
  tagGold: { background: 'rgba(229,184,11,.14)', color: '#e5b80b' },
  tagRed: { background: 'rgba(255,78,119,.14)', color: '#ff4e77' },
  rowActions: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  smallBtn: { minHeight: 40, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px' },
  smallBtnDanger: { minHeight: 40, border: '1px solid rgba(255,78,119,.5)', borderRadius: 8, background: 'rgba(255,78,119,.12)', color: '#ffb3c6', fontWeight: 900, padding: '0 14px' },
  searchRow: { display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  dirRow: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', borderBottom: '1px solid #1a1a24', paddingBottom: 10, flexWrap: 'wrap' },
  dirMain: { display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', color: '#9aa6ba' },
  dirActions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  statusTag: { borderRadius: 8, padding: '4px 10px', fontWeight: 900, fontSize: 12 },
  staffTable: { display: 'grid', gap: 0 },
  staffHead: { display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr', gap: 12, color: '#6f7688', fontSize: 12, fontWeight: 800, padding: '0 0 8px', borderBottom: '1px solid #242735' },
  staffRow: { display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #1a1a24' },
  mono: { color: '#9aa6ba', fontSize: 13 },
  roleBadges: { color: '#8ea0ff', fontWeight: 900, fontSize: 13 },
  hrForm: { border: '1px solid #242735', borderRadius: 12, background: '#101119', padding: 18, display: 'grid', gap: 14, maxWidth: 520 },
  hrFormTitle: { margin: 0, fontSize: 18 },
  field: { display: 'grid', gap: 6, color: '#9aa6ba', fontSize: 13, fontWeight: 800 },
  input: { minHeight: 50, borderRadius: 10, border: '1px solid #30384d', background: '#0d1320', color: '#fff', padding: '0 14px', fontSize: 15, fontWeight: 700 },
  mailboxNote: { margin: 0, color: '#8ea0ff', fontSize: 12, fontWeight: 700, lineHeight: 1.5 },
  createButton: { minHeight: 54, border: 0, borderRadius: 10, background: '#d5a915', color: '#181207', fontWeight: 950, fontSize: 15 },
}
