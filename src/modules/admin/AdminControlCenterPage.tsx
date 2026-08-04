import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { navigate } from '../../app/routes'
import { AdminShell, type AdminNavKey } from './AdminShell'
import { AccountControlPanel } from './AccountControlPanel'
import { LoyaltyPanel } from './LoyaltyPanel'

// Each staff group is its own page (deep-linkable) inside the shared admin shell.
type GroupId = 'guest' | 'host' | 'accounting' | 'management' | 'hr'
type Props = { lang: Lang; group?: GroupId; onLanguageChange?: (lang: Lang) => void }

const TONE = { green: '#29d39b', gold: '#d4af6a', red: '#ff5c7a', blue: '#5b8cff', teal: '#2dd4bf' }

const GROUP_TO_NAV: Record<GroupId, AdminNavKey> = {
  guest: 'guests', host: 'hosts', accounting: 'accounting', management: 'management', hr: 'hr',
}

const META: Record<GroupId, { ar: [string, string]; en: [string, string] }> = {
  guest: { ar: ['العملاء', 'كل ما يحتاج إلى مراجعة في تجربة الضيف.'], en: ['Guests', 'Everything requiring attention across the guest journey.'] },
  host: { ar: ['المضيفون', 'صحة مسار القوائم وإشارات التحقق من الادعاءات.'], en: ['Hosts', 'Listing pipeline health and claim-check signals.'] },
  accounting: { ar: ['المحاسبة', 'الإيرادات والمحافظ والمدفوعات وحركة السداد.'], en: ['Accounting', 'Revenue, wallets, payment volume and payouts.'] },
  management: { ar: ['الإدارة', 'التحكم بالحسابات وبرنامج الولاء وقوائم الانتباه.'], en: ['Management', 'Account control, loyalty standing and attention queues.'] },
  hr: { ar: ['الموارد البشرية', 'دليل الفريق وإنشاء حسابات الإدارة والدعم.'], en: ['Human Resources', 'Staff directory and controlled account creation.'] },
}

const CREATABLE_ROLES = ['ADMIN', 'SUPPORT'] as const

const T = {
  ar: {
    error: 'تعذر تحميل بعض البيانات.',
    accountControl: 'التحكم بالحسابات',
    accountControlHint: 'افتح أي حساب وأصلح مشاكله، أو علّقه أو أعد تفعيله أو احذفه. كل إجراء يُسجَّل.',
    loyalty: 'الولاء والتقييم',
    loyaltyHint: 'يقترح الذكاء الاصطناعي مستويات الثقة للمضيفين والعملاء — والإدارة تعتمد أو ترفض. لا يتغير أي مستوى دون اعتماد.',
    userSearch: 'ابحث بالاسم أو البريد',
    search: 'بحث',
    suspend: 'تعليق',
    reinstate: 'إعادة تفعيل',
    close: 'إغلاق',
    working: 'جارٍ...',
    usersTitle: 'دليل المستخدمين',
    bookingsTitle: 'دليل الحجوزات',
    bookingStatusAll: 'كل الحالات',
    forceCancel: 'إلغاء + استرداد',
    confirmForceCancel: 'تأكيد إلغاء الحجز واسترداد الضيف؟',
    takedown: 'إيقاف مؤقت',
    restore: 'إعادة نشر',
    takedownDone: 'تم تحديث حالة الإعلان.',
    open: 'فتح',
    review: 'مراجعة',
    reviewQueue: 'الذهاب إلى قائمة المراجعة ←',
    disputesLink: 'عرض النزاعات ←',
    financeLink: 'المالية ←',
    guestVerif: 'التحقق من الهوية',
    guestVerifSub: 'طلبات معلقة للمراجعة',
    guestPayments: 'إثباتات دفع معلّقة',
    guestBookings: 'حجوزات بانتظار القرار',
    guestBookingsSub: 'لا يتم اعتماد أي حجز تلقائياً',
    approvedPayments: 'المدفوعات المعتمدة',
    last30: 'آخر 30 يوماً',
    pendingDecision: 'بانتظار القرار',
    idAndProof: 'هوية وإثبات دفع',
    openDisputes: 'نزاعات مفتوحة',
    needsHuman: 'تحتاج متابعة بشرية',
    none: 'لا عناصر.',
    hostingApproved: 'قوائم معتمدة',
    publishedNow: 'منشورة الآن',
    hostingPending: 'بانتظار المراجعة',
    humanDecision: 'قرار بشري مطلوب',
    hostingRejected: 'مرفوضة',
    sinceMonth: 'منذ بداية الشهر',
    hostsCount: 'إجمالي المضيفين',
    hostAccounts: 'حساب مضيف',
    aiFlagsTitle: 'إشارات التحقق بالذكاء الاصطناعي',
    aiFlagsSub: 'الإشارات استشارية ولا تنفذ تلقائياً',
    aiNoFlags: 'لا إشارات على القوائم المعروضة حالياً.',
    flags: 'إشارات',
    decisionNeeded: 'قرار مطلوب',
    totalRevenue: 'إجمالي الإيراد',
    proj30: (v: string) => `توقع 30 يوماً: ${v}`,
    walletBalance: 'أرصدة المحافظ',
    walletsCount: (n: number) => `${n} محفظة`,
    approvedVolume: 'حجم الدفع المعتمد',
    approvedOps: (n: number) => `${n} عملية`,
    refunds: 'المبالغ المستردة',
    movements: 'حركات السداد المعلقة',
    movementsSub: 'فترة حماية 14 يوماً بعد المغادرة قبل السماح بالسداد',
    payoutEligible: 'مؤهل الآن',
    payoutHold: 'فترة حماية',
    noAccount: 'لا يوجد حساب',
    pay: 'دفع',
    srRides: (n: number) => `رحلات SR المكتملة دون عمولة منصة: ${n}`,
    accountsTitle: 'الحسابات',
    accountsSub: 'ابحث ثم اختر حساباً للتحكم به',
    bookingDir: 'دليل الحجوزات',
    active: 'نشط',
    suspended: 'موقوف',
    approve: 'موافقة',
    scanLink: 'تشغيل فحص عند الطلب ←',
    needsTitle: 'مهام تحتاج انتباه',
    needsStuck: 'حجوزات عالقة بانتظار الدفع',
    needsNoPayout: 'مضيفون لديهم رصيد بلا حساب صرف',
    needsImbalance: 'محافظ غير متطابقة مع السجل',
    needsReview: 'مراجعات متأخرة',
    needsDisputes: 'نزاعات متأخرة',
    needsSos: 'بلاغات SOS متأخرة',
    hrDirectory: 'دليل الموظفين',
    hrDirectorySub: 'حسابات الإدارة والدعم',
    hrAddTitle: 'إضافة عضو فريق',
    hrAddSub: 'يجب أن ينتهي البريد بـ @sybnb.app',
    hrName: 'الاسم المعروض',
    hrEmailField: 'البريد',
    hrRoleField: 'الدور',
    hrAdd: 'إنشاء الحساب',
    hrAdding: 'جار الإنشاء...',
    hrMailboxNote: 'يُنشأ صندوق البريد في Google Workspace بصورة منفصلة؛ هذا النموذج يحدد الحساب والدور فقط.',
    hrEmpty: 'لا يوجد طاقم بعد.',
    actionError: 'تعذر تنفيذ الإجراء.',
  },
  en: {
    error: 'Some data could not be loaded.',
    accountControl: 'Account control',
    accountControlHint: 'Open any account and fix its problems, or suspend / reinstate / delete it. Every action is logged.',
    loyalty: 'Loyalty & standing',
    loyaltyHint: 'AI proposes trust tiers for hosts and guests — admins approve or reject. No tier changes without approval.',
    userSearch: 'Search by name or email',
    search: 'Search',
    suspend: 'Suspend',
    reinstate: 'Reinstate',
    close: 'Close',
    working: 'Working...',
    usersTitle: 'User directory',
    bookingsTitle: 'Booking directory',
    bookingStatusAll: 'All statuses',
    forceCancel: 'Cancel + refund',
    confirmForceCancel: 'Force-cancel this booking and refund the guest?',
    takedown: 'Take down',
    restore: 'Restore',
    takedownDone: 'Listing status updated.',
    open: 'Open',
    review: 'Review',
    reviewQueue: 'Go to review queue →',
    disputesLink: 'View disputes →',
    financeLink: 'Finance →',
    guestVerif: 'ID verification',
    guestVerifSub: 'Pending requests for review',
    guestPayments: 'Pending payment proofs',
    guestBookings: 'Bookings awaiting decision',
    guestBookingsSub: 'No booking is approved automatically',
    approvedPayments: 'Approved payments',
    last30: 'Last 30 days',
    pendingDecision: 'Awaiting decision',
    idAndProof: 'ID & payment proof',
    openDisputes: 'Open disputes',
    needsHuman: 'Needs human follow-up',
    none: 'No items.',
    hostingApproved: 'Approved listings',
    publishedNow: 'Published now',
    hostingPending: 'Pending review',
    humanDecision: 'Human decision required',
    hostingRejected: 'Rejected',
    sinceMonth: 'Since start of month',
    hostsCount: 'Total hosts',
    hostAccounts: 'Host accounts',
    aiFlagsTitle: 'AI claim-check flags',
    aiFlagsSub: 'Flags are advisory and never auto-applied',
    aiNoFlags: 'No flags on the listings currently in the queue.',
    flags: 'flags',
    decisionNeeded: 'Decision needed',
    totalRevenue: 'Total revenue',
    proj30: (v: string) => `30-day projection: ${v}`,
    walletBalance: 'Wallet balances',
    walletsCount: (n: number) => `${n} wallets`,
    approvedVolume: 'Approved payment volume',
    approvedOps: (n: number) => `${n} payments`,
    refunds: 'Refunds',
    movements: 'Pending payout movements',
    movementsSub: '14-day protection hold after checkout before payout is allowed',
    payoutEligible: 'Eligible now',
    payoutHold: 'In protection hold',
    noAccount: 'No account',
    pay: 'Pay',
    srRides: (n: number) => `Completed SR rides (no platform commission): ${n}`,
    accountsTitle: 'Accounts',
    accountsSub: 'Search, then open an account to control it',
    bookingDir: 'Booking directory',
    active: 'Active',
    suspended: 'Suspended',
    approve: 'Approve',
    scanLink: 'Run an on-demand scan →',
    needsTitle: 'Needs attention',
    needsStuck: 'Bookings stuck awaiting payment',
    needsNoPayout: 'Hosts holding money with no payout method',
    needsImbalance: 'Wallets out of sync with the ledger',
    needsReview: 'Aging review items',
    needsDisputes: 'Aging disputes',
    needsSos: 'Aging SOS events',
    hrDirectory: 'Staff directory',
    hrDirectorySub: 'Admin and support accounts',
    hrAddTitle: 'Add a team member',
    hrAddSub: 'Email must end with @sybnb.app',
    hrName: 'Display name',
    hrEmailField: 'Email',
    hrRoleField: 'Role',
    hrAdd: 'Create account',
    hrAdding: 'Creating...',
    hrMailboxNote: 'The mailbox is created separately in Google Workspace; this form only sets the account and role.',
    hrEmpty: 'No staff yet.',
    actionError: 'Could not complete the action.',
  },
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

const initialsOf = (s: string) => (s || '?').replace(/[._-]+/g, ' ').trim().slice(0, 2).toUpperCase()

export function AdminControlCenterPage({ lang, group = 'guest', onLanguageChange }: Props) {
  const isAr = lang === 'ar'
  const t = T[lang]
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

  const loadAll = useCallback(() => {
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

  useEffect(() => loadAll(), [loadAll])

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetchAdminUsers({ search: userSearch.trim() || undefined })
      setUsers(res.users)
    } catch {
      setActionMsg(t.actionError)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSearch])

  const loadBookings = useCallback(async () => {
    try {
      const res = await fetchAdminBookings({ status: bookingStatus || undefined })
      setBookings(res.bookings)
    } catch {
      setActionMsg(t.actionError)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingStatus])

  useEffect(() => {
    if (group === 'management') {
      void loadUsers()
      void loadBookings()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group])

  async function changeUserStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED') {
    setActionBusy(userId)
    setActionMsg('')
    try {
      const updated = await setAdminUserStatus(userId, status)
      setUsers((cur) => cur.map((u) => (u.id === userId ? { ...u, status: updated.status } : u)))
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
      setHrMessage(t.hrAdd)
    } catch (err) {
      setHrError(err instanceof Error ? err.message : t.error)
    } finally {
      setHrBusy(false)
    }
  }

  const num = (map: Record<string, number> | undefined, key: string) => (map ? map[key] || 0 : 0)
  const meta = META[group][lang]

  const counts: Partial<Record<AdminNavKey, number>> = {
    guests: (queue?.idDocuments.length || 0) + (queue?.payments.length || 0),
    hosts: num(metrics?.listingsByStatus, 'PENDING_REVIEW'),
    management: needs ? Object.values(needs.counts).reduce((a, b) => a + (b || 0), 0) : undefined,
    reports: openDisputes.length || undefined,
  }

  return (
    <AdminShell
      lang={lang}
      active={GROUP_TO_NAV[group]}
      title={meta[0]}
      subtitle={meta[1]}
      counts={counts}
      onLanguageChange={onLanguageChange}
      onRefresh={loadAll}
    >
      {error && <div className="alert">{error}</div>}
      {loading && <div className="empty"><div><span>◴</span>{isAr ? 'جار التحميل...' : 'Loading...'}</div></div>}

      {!loading && group === 'guest' && (
        <>
          <div className="metrics">
            <Metric label={t.approvedPayments} value={num(metrics?.paymentsByStatus, 'APPROVED')} sub={t.last30} tone={TONE.green} to="/admin/review" />
            <Metric label={t.pendingDecision} value={(queue?.idDocuments.length || 0) + (queue?.payments.length || 0)} sub={t.idAndProof} tone={TONE.gold} to="/admin/review" />
            <Metric label={t.openDisputes} value={openDisputes.length} sub={t.needsHuman} tone={TONE.red} to="/admin/disputes" />
          </div>
          <div className="grid">
            <KCard title={t.guestVerif} sub={t.guestVerifSub} count={queue?.idDocuments.length || 0} footer={t.reviewQueue} onFooter={() => navigate('/admin/review')}>
              {queue?.idDocuments.length
                ? queue.idDocuments.slice(0, 8).map((doc) => (
                    <KRow key={doc.id} initials={initialsOf(doc.displayName)} name={doc.displayName} meta={doc.email || doc.id.slice(0, 8)} pill={t.pendingDecision} tone="gold" />
                  ))
                : <Empty text={t.none} />}
            </KCard>
            <KCard title={t.guestBookings} sub={t.guestBookingsSub} count={queue?.bookings.length || 0} footer={t.disputesLink} onFooter={() => navigate('/admin/disputes')}>
              {queue?.bookings.length
                ? queue.bookings.slice(0, 8).map((b) => (
                    <KRow key={b.id} initials="BK" name={b.listing ? listingTitleText(b.listing, lang) : b.id.slice(0, 8)} meta={b.id.slice(0, 12).toUpperCase()} pill={b.status} tone="blue" />
                  ))
                : <Empty text={t.none} />}
            </KCard>
          </div>
        </>
      )}

      {!loading && group === 'host' && (
        <>
          <div className="metrics">
            <Metric label={t.hostingApproved} value={num(metrics?.listingsByStatus, 'APPROVED')} sub={t.publishedNow} tone={TONE.green} to="/admin/review" />
            <Metric label={t.hostingPending} value={num(metrics?.listingsByStatus, 'PENDING_REVIEW')} sub={t.humanDecision} tone={TONE.gold} to="/admin/review" />
            <Metric label={t.hostingRejected} value={num(metrics?.listingsByStatus, 'REJECTED')} sub={t.sinceMonth} tone={TONE.red} to="/admin/review" />
            <Metric label={t.hostsCount} value={num(metrics?.usersByRole, 'HOST')} sub={t.hostAccounts} tone={TONE.blue} to="/admin/management" />
          </div>
          <KCard
            title={t.aiFlagsTitle}
            sub={t.aiFlagsSub}
            count={(queue?.listings || []).filter((l) => (claimChecksOf(l)?.flagCount || 0) > 0).length}
            footer={t.reviewQueue}
            onFooter={() => navigate('/admin/review')}
          >
            {(() => {
              const flagged = (queue?.listings || []).filter((l) => (claimChecksOf(l)?.flagCount || 0) > 0)
              if (!flagged.length) return <Empty text={t.aiNoFlags} />
              return flagged.map((listing) => {
                const cc = claimChecksOf(listing)
                return (
                  <KRow
                    key={listing.id}
                    initials="🚩"
                    name={listingTitleText(listing, lang)}
                    meta={`${cc?.flagCount || 0} ${t.flags}`}
                    pill={listing.status === 'PAUSED' ? t.restore : t.decisionNeeded}
                    tone="gold"
                    actionLabel={listing.status === 'PAUSED' ? t.restore : t.takedown}
                    onAction={() => void takedownListing(listing.id, listing.status === 'PAUSED' ? 'APPROVED' : 'PAUSED')}
                    busy={actionBusy === listing.id}
                    busyLabel={t.working}
                  />
                )
              })
            })()}
          </KCard>
        </>
      )}

      {!loading && group === 'accounting' && (
        <>
          <div className="metrics">
            {(revenue?.byCurrency || []).slice(0, 1).map((cur) => (
              <Metric key={cur.currency} label={`${t.totalRevenue} (${cur.currency})`} value={moneyText(cur.totalRevenueMinor, cur.currency, lang)} sub={t.proj30(moneyText(cur.projection.next30DaysMinor, cur.currency, lang))} tone={TONE.blue} to="/admin/review" />
            ))}
            {(metrics?.walletBalancesByCurrency || []).map((row) => <Metric key={`wallet-${row.currency}`} label={`${t.walletBalance} (${row.currency})`} value={moneyText(row.amountMinor, row.currency, lang)} sub={t.walletsCount(row.count)} tone={TONE.green} to="/admin/review" />)}
            {(metrics?.approvedPaymentVolumeByCurrency || []).map((row) => <Metric key={`payments-${row.currency}`} label={`${t.approvedVolume} (${row.currency})`} value={moneyText(row.amountMinor, row.currency, lang)} sub={t.approvedOps(row.count)} tone={TONE.gold} to="/admin/review" />)}
            <Metric label={t.refunds} value={num(metrics?.paymentsByStatus, 'REFUNDED')} sub={t.refunds} tone={TONE.red} to="/admin/review" />
          </div>
          <KCard title={t.movements} sub={t.movementsSub} count={payouts?.payouts.length || 0} footer={t.srRides(revenue?.srRidesCompletedCount || 0)}>
            {payouts?.payouts.length
              ? payouts.payouts.slice(0, 12).map((p) => (
                  <KRow
                    key={p.bookingId}
                    initials="PA"
                    name={p.listingTitle || p.bookingId.slice(0, 8)}
                    meta={`${p.hostName || p.hostId?.slice(0, 8) || '-'} · ${p.hostPayoutMethod ? `•••• ${p.hostPayoutMethod.last4}` : t.noAccount} · ${moneyText(p.hostPayoutMinor, p.currency, lang)}`}
                    pill={p.eligibleNow ? t.payoutEligible : t.payoutHold}
                    tone={p.eligibleNow ? 'green' : 'gold'}
                  />
                ))
              : <Empty text={t.none} />}
          </KCard>
        </>
      )}

      {!loading && group === 'management' && (
        <>
          {actionMsg && <div className="alert">{actionMsg}</div>}
          <div className="grid">
            <KCard title={t.accountControl} sub={t.accountControlHint}>
              <div style={{ padding: '4px 8px' }}><AccountControlPanel lang={lang} /></div>
            </KCard>
            <KCard title={t.loyalty} sub={t.loyaltyHint}>
              <div style={{ padding: '4px 8px' }}><LoyaltyPanel lang={lang} /></div>
            </KCard>
          </div>
          <div style={{ height: 18 }} />
          <div className="grid">
            <KCard title={t.usersTitle} count={users.length}>
              <div className="toolbar">
                <input className="search" placeholder={t.userSearch} value={userSearch} onChange={(e) => setUserSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void loadUsers()} />
                <button className="button ghost small" onClick={() => void loadUsers()}>{t.search}</button>
              </div>
              {users.length
                ? users.map((u) => (
                    <KRow
                      key={u.id}
                      initials={initialsOf(u.displayName)}
                      name={u.displayName}
                      meta={`${u.email || '-'} · ${u.roles.join(' · ')}`}
                      pill={u.status}
                      tone={u.status === 'ACTIVE' ? 'green' : 'red'}
                      actionLabel={u.status === 'ACTIVE' ? t.suspend : t.reinstate}
                      onAction={() => void changeUserStatus(u.id, u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')}
                      busy={actionBusy === u.id}
                      busyLabel={t.working}
                    />
                  ))
                : <Empty text={t.none} />}
            </KCard>
            <KCard title={t.bookingDir} count={bookings.length}>
              <div className="toolbar">
                <select value={bookingStatus} onChange={(e) => setBookingStatus(e.target.value)} style={{ flex: 1 }}>
                  <option value="">{t.bookingStatusAll}</option>
                  {['PAYMENT_PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'DISPUTED'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button className="button ghost small" onClick={() => void loadBookings()}>{t.search}</button>
              </div>
              {bookings.length
                ? bookings.map((b) => (
                    <KRow
                      key={b.id}
                      initials="BK"
                      name={b.listing ? (isAr ? b.listing.titleAr : b.listing.titleEn || b.listing.titleAr) : b.id.slice(0, 8)}
                      meta={`${b.guest?.displayName || b.guest?.id?.slice(0, 8) || '-'} · ${moneyText(b.amountMinor, b.currency, lang)}`}
                      pill={b.status}
                      tone={b.status === 'CANCELLED' ? 'red' : 'gold'}
                      actionLabel={['CONFIRMED', 'PAYMENT_PENDING'].includes(b.status) ? t.forceCancel : undefined}
                      onAction={() => void doForceCancel(b.id)}
                      busy={actionBusy === b.id}
                      busyLabel={t.working}
                    />
                  ))
                : <Empty text={t.none} />}
            </KCard>
          </div>
          <div style={{ height: 18 }} />
          <h2 style={{ fontSize: 18, margin: '4px 2px 14px' }}>{t.needsTitle}</h2>
          <div className="metrics">
            <Metric label={t.needsStuck} value={needs?.counts.stuckPayments || 0} tone={TONE.red} to="/admin/review" />
            <Metric label={t.needsNoPayout} value={needs?.counts.noPayoutMethodHosts || 0} tone={TONE.gold} to="/admin/accounting" />
            <Metric label={t.needsImbalance} value={needs?.counts.imbalancedWallets || 0} tone={TONE.red} to="/admin/review" />
            <Metric label={t.needsReview} value={needs?.counts.agingReviewListings || 0} tone={TONE.gold} to="/admin/review" />
            <Metric label={t.needsDisputes} value={needs?.counts.agingDisputes || 0} tone={TONE.gold} to="/admin/disputes" />
            <Metric label={t.needsSos} value={needs?.counts.agingSos || 0} tone={TONE.red} to="/admin/review" />
          </div>
          <div className="grid">
            <KCard title={t.needsStuck} count={needs?.items.stuckBookings.length || 0}>
              {needs?.items.stuckBookings.length
                ? needs.items.stuckBookings.slice(0, 12).map((b) => (
                    <KRow
                      key={b.id}
                      initials="BK"
                      name={b.listing?.titleAr || b.id.slice(0, 8)}
                      meta={new Date(b.createdAt).toLocaleString(isAr ? 'ar-SY' : 'en-US')}
                      actionLabel={t.forceCancel}
                      onAction={() => void doForceCancel(b.id)}
                      busy={actionBusy === b.id}
                      busyLabel={t.working}
                    />
                  ))
                : <Empty text={t.none} />}
            </KCard>
            <KCard title={t.needsNoPayout} count={needs?.items.noPayoutMethodHosts.length || 0}>
              {needs?.items.noPayoutMethodHosts.length
                ? needs.items.noPayoutMethodHosts.slice(0, 12).map((h) => (
                    <KRow key={h.userId} initials={initialsOf(h.displayName)} name={h.displayName} meta={moneyText(h.cachedBalanceMinor, h.currency, lang)} pill={t.noAccount} tone="grey" />
                  ))
                : <Empty text={t.none} />}
            </KCard>
          </div>
        </>
      )}

      {!loading && group === 'hr' && (
        <div className="grid">
          <KCard title={t.hrDirectory} sub={t.hrDirectorySub} count={staff.length}>
            {staff.length
              ? staff.map((s) => (
                  <KRow key={s.id} initials={initialsOf(s.displayName)} name={s.displayName} meta={s.email || '-'} pill={s.roles.join(' · ')} tone={s.roles.includes('ADMIN') ? 'green' : 'blue'} />
                ))
              : <Empty text={t.hrEmpty} />}
          </KCard>
          <article className="card">
            <header className="card-header"><div><h2>{t.hrAddTitle}</h2><p>{t.hrAddSub}</p></div></header>
            <form className="form" onSubmit={submitStaff}>
              <div className="field">
                <label>{t.hrName}</label>
                <input required value={hrName} onChange={(e) => setHrName(e.target.value)} />
              </div>
              <div className="field">
                <label>{t.hrEmailField}</label>
                <input required type="email" dir="ltr" placeholder="name@sybnb.app" value={hrEmail} onChange={(e) => setHrEmail(e.target.value)} />
              </div>
              <div className="field full">
                <label>{t.hrRoleField}</label>
                <select value={hrRole} onChange={(e) => setHrRole(e.target.value)}>
                  {CREATABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="field full"><p className="note">ℹ︎ {t.hrMailboxNote}</p></div>
              {hrError && <div className="field full"><div className="alert">{hrError}</div></div>}
              {hrMessage && <div className="field full"><p className="note" style={{ borderColor: 'rgba(41,211,155,.3)', background: 'rgba(41,211,155,.06)', color: '#9fe7cc' }}>{hrMessage}</p></div>}
              <div className="field full">
                <button className="button primary" type="submit" disabled={hrBusy}>{hrBusy ? t.hrAdding : t.hrAdd}</button>
              </div>
            </form>
          </article>
        </div>
      )}
    </AdminShell>
  )
}

/* ---- kit helpers ---- */

function Metric({ label, value, sub, tone, to }: { label: string; value: ReactNode; sub?: string; tone: string; to?: string }) {
  const clickable = Boolean(to)
  return (
    <article
      className={`metric${clickable ? ' clickable' : ''}`}
      style={{ ['--tone' as keyof CSSProperties]: tone } as CSSProperties}
      onClick={clickable ? () => navigate(to!) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(to!) } } : undefined}
    >
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {sub ? <small>{sub}</small> : null}
      {clickable ? <span className="metric-go" aria-hidden="true">→</span> : null}
    </article>
  )
}

function KCard({ title, sub, count, footer, onFooter, children }: { title: string; sub?: string; count?: number; footer?: string; onFooter?: () => void; children: ReactNode }) {
  return (
    <article className="card">
      <header className="card-header">
        <div><h2>{title}</h2>{sub ? <p>{sub}</p> : null}</div>
        {typeof count === 'number' ? <span className="count">{count}</span> : null}
      </header>
      <div className="rows">{children}</div>
      {footer ? (onFooter ? <button className="card-footer" type="button" onClick={onFooter}>{footer}</button> : <div className="card-footer-note">{footer}</div>) : null}
    </article>
  )
}

function KRow({ initials, name, meta, pill, tone = 'grey', actionLabel, onAction, busy, busyLabel }: {
  initials: string; name: string; meta?: string; pill?: string; tone?: 'green' | 'gold' | 'red' | 'blue' | 'grey'
  actionLabel?: string; onAction?: () => void; busy?: boolean; busyLabel?: string
}) {
  return (
    <div className="row">
      <div className="identity">
        <span className="mini-avatar">{initials}</span>
        <div><strong>{name}</strong>{meta ? <small>{meta}</small> : null}</div>
      </div>
      <div className="row-meta">
        {pill ? <span className={`pill ${tone}`}>{pill}</span> : null}
        {actionLabel ? (
          <button className="button ghost small" onClick={onAction} disabled={busy}>{busy ? (busyLabel || '…') : actionLabel}</button>
        ) : null}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="empty"><div><span>∅</span>{text}</div></div>
}
