import { useEffect, useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { deleteMyAccount, fetchMyBlocks, unblockUser, type PlatformUserBlock } from '../../shared/api/platformApi'

// Store-compliance Settings: in-app account deletion (DELETE /api/me) + blocked-accounts management.
const copy = {
  ar: {
    back: 'العودة',
    title: 'الإعدادات',
    subtitle: 'إدارة حسابك والحسابات المحظورة.',
    blockedTitle: 'الحسابات المحظورة',
    blockedEmpty: 'لا توجد حسابات محظورة.',
    blockedLoading: 'جار التحميل...',
    blockedError: 'تعذر تحميل قائمة الحظر.',
    unblock: 'إلغاء الحظر',
    unblocking: 'جار الإلغاء...',
    dangerTitle: 'حذف الحساب',
    dangerBody: 'حذف الحساب يزيل بياناتك الشخصية نهائيًا (الاسم، البريد، الهاتف، وثائق الهوية). تُحتفظ بعض السجلات المالية والتدقيقية التي يفرضها القانون مرتبطةً بحساب مجهول الهوية. لا يمكن التراجع عن هذا الإجراء.',
    deleteBtn: 'حذف حسابي',
    confirmTitle: 'تأكيد حذف الحساب',
    confirmBody: 'سيتم تسجيل خروجك فورًا ولا يمكن استرجاع الحساب. هل أنت متأكد؟',
    confirmDelete: 'نعم، احذف حسابي',
    cancel: 'إلغاء',
    deleting: 'جار الحذف...',
    walletNotEmpty: 'لا يمكن الحذف: لديك رصيد في المحفظة. يرجى سحبه أو إنفاقه أولًا.',
    activeObligations: 'لا يمكن الحذف: لديك حجوزات أو رحلات نشطة. يرجى إنهاؤها أولًا.',
    genericError: 'تعذر حذف الحساب، حاول مجددًا.',
    deleted: 'تم حذف حسابك. مع السلامة.',
  },
  en: {
    back: 'Back',
    title: 'Settings',
    subtitle: 'Manage your account and blocked accounts.',
    blockedTitle: 'Blocked accounts',
    blockedEmpty: 'No blocked accounts.',
    blockedLoading: 'Loading…',
    blockedError: 'Could not load your block list.',
    unblock: 'Unblock',
    unblocking: 'Unblocking…',
    dangerTitle: 'Delete account',
    dangerBody: 'Deleting your account permanently erases your personal data (name, email, phone, ID documents). Some financial and audit records required by law are retained against an anonymized account. This cannot be undone.',
    deleteBtn: 'Delete my account',
    confirmTitle: 'Confirm account deletion',
    confirmBody: 'You will be signed out immediately and the account cannot be recovered. Are you sure?',
    confirmDelete: 'Yes, delete my account',
    cancel: 'Cancel',
    deleting: 'Deleting…',
    walletNotEmpty: 'Can’t delete: you still have a wallet balance. Withdraw or spend it first.',
    activeObligations: 'Can’t delete: you have active bookings or rides. Resolve them first.',
    genericError: 'Could not delete the account. Please try again.',
    deleted: 'Your account has been deleted. Goodbye.',
  },
}

export function SettingsPage({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const t = isAr ? copy.ar : copy.en

  const [blocks, setBlocks] = useState<PlatformUserBlock[]>([])
  const [blockState, setBlockState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [unblocking, setUnblocking] = useState('')

  const [confirming, setConfirming] = useState(false)
  const [deleteState, setDeleteState] = useState<'idle' | 'saving' | 'done'>('idle')
  const [deleteError, setDeleteError] = useState('')

  async function loadBlocks() {
    setBlockState('loading')
    try {
      setBlocks(await fetchMyBlocks())
      setBlockState('ready')
    } catch {
      setBlockState('error')
    }
  }

  useEffect(() => { void loadBlocks() }, [])

  async function onUnblock(userId: string) {
    setUnblocking(userId)
    try {
      await unblockUser(userId)
      setBlocks((prev) => prev.filter((b) => b.blockedUserId !== userId))
    } finally {
      setUnblocking('')
    }
  }

  async function onDelete() {
    setDeleteState('saving')
    setDeleteError('')
    try {
      await deleteMyAccount() // clears the session token on success
      setDeleteState('done')
      // Signed out; return home after a short beat.
      setTimeout(() => (window.location.hash = '/'), 1500)
    } catch (err) {
      setDeleteState('idle')
      const code = (err as { code?: string })?.code
      if (code === 'WALLET_NOT_EMPTY') setDeleteError(t.walletNotEmpty)
      else if (code === 'ACCOUNT_HAS_ACTIVE_OBLIGATIONS') setDeleteError(t.activeObligations)
      else setDeleteError(err instanceof Error && err.message ? err.message : t.genericError)
    }
  }

  if (deleteState === 'done') {
    return (
      <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
        <p style={styles.success}>{t.deleted}</p>
      </main>
    )
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/account')}>{t.back}</button>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>{t.blockedTitle}</h2>
        {blockState === 'loading' && <p style={styles.muted}>{t.blockedLoading}</p>}
        {blockState === 'error' && <p style={styles.error}>{t.blockedError}</p>}
        {blockState === 'ready' && blocks.length === 0 && <p style={styles.muted}>{t.blockedEmpty}</p>}
        {blockState === 'ready' &&
          blocks.map((b) => (
            <div key={b.id} style={styles.blockRow}>
              <span style={styles.mono}>{b.blockedUserId.slice(0, 8).toUpperCase()}</span>
              <button style={styles.secondaryButton} disabled={unblocking === b.blockedUserId} onClick={() => void onUnblock(b.blockedUserId)}>
                {unblocking === b.blockedUserId ? t.unblocking : t.unblock}
              </button>
            </div>
          ))}
      </section>

      <section style={styles.dangerCard}>
        <h2 style={styles.sectionTitle}>{t.dangerTitle}</h2>
        <p style={styles.dangerBody}>{t.dangerBody}</p>
        {!confirming ? (
          <button style={styles.dangerButton} onClick={() => setConfirming(true)}>{t.deleteBtn}</button>
        ) : (
          <div style={styles.confirm}>
            <strong>{t.confirmTitle}</strong>
            <p style={styles.dangerBody}>{t.confirmBody}</p>
            {deleteError && <p style={styles.error} role="alert">{deleteError}</p>}
            <div style={styles.actions}>
              <button style={styles.dangerButton} disabled={deleteState === 'saving'} onClick={() => void onDelete()}>
                {deleteState === 'saving' ? t.deleting : t.confirmDelete}
              </button>
              <button style={styles.secondaryButton} disabled={deleteState === 'saving'} onClick={() => setConfirming(false)}>{t.cancel}</button>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 640, margin: '0 auto', padding: '20px 16px 64px', display: 'flex', flexDirection: 'column', gap: 16 },
  back: { alignSelf: 'flex-start', background: 'transparent', border: 'none', color: '#2f6fed', cursor: 'pointer', padding: 0, fontSize: 14 },
  title: { fontSize: 24, margin: 0 },
  subtitle: { margin: 0, color: '#555', fontSize: 14 },
  card: { display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 14, border: '1px solid #e4e4ee', background: '#fff' },
  dangerCard: { display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 14, border: '1px solid #f0d9d9', background: '#fffafa' },
  sectionTitle: { fontSize: 16, margin: 0 },
  blockRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #eef' },
  mono: { fontFamily: 'monospace', fontSize: 14, color: '#333' },
  dangerBody: { fontSize: 13, color: '#555', lineHeight: 1.6, margin: 0 },
  confirm: { display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 10, background: 'rgba(179,38,30,.05)', border: '1px solid #f0d9d9' },
  actions: { display: 'flex', gap: 10 },
  dangerButton: { padding: '11px 16px', borderRadius: 10, border: 'none', background: '#b3261e', color: '#fff', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
  secondaryButton: { padding: '9px 14px', borderRadius: 10, border: '1px solid #ccd', background: '#fff', color: '#333', fontWeight: 600, cursor: 'pointer' },
  muted: { color: '#888', fontSize: 14, margin: 0 },
  error: { color: '#b3261e', fontSize: 13, margin: 0 },
  success: { color: '#0a7d33', fontSize: 16, margin: 0 },
}
