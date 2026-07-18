import { useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { blockUser } from '../../shared/api/platformApi'

// Reusable "Block user" action. POST /api/me/blocks. Enforcement (no SR matching / no messaging) is
// already server-side. Surfaces the CANNOT_BLOCK_SELF / USER_NOT_FOUND guards.
const copy = {
  ar: {
    block: 'حظر المستخدم',
    blocking: 'جار الحظر...',
    blocked: 'تم حظر المستخدم. لن تتم مطابقتكما أو مراسلتكما.',
    manage: 'إدارة المحظورين',
    genericError: 'تعذر حظر المستخدم.',
  },
  en: {
    block: 'Block user',
    blocking: 'Blocking…',
    blocked: 'User blocked. You will not be matched or messaged with them.',
    manage: 'Manage blocked',
    genericError: 'Could not block the user.',
  },
}

export function BlockButton({ lang, userId, compact = false }: { lang: Lang; userId: string; compact?: boolean }) {
  const isAr = lang === 'ar'
  const t = isAr ? copy.ar : copy.en
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle')
  const [error, setError] = useState('')

  async function onBlock() {
    setState('saving')
    setError('')
    try {
      await blockUser(userId)
      setState('done')
    } catch (err) {
      setState('idle')
      setError(err instanceof Error && err.message ? err.message : t.genericError)
    }
  }

  if (state === 'done') {
    return (
      <div style={styles.doneRow} dir={isAr ? 'rtl' : 'ltr'}>
        <span style={styles.success}>{t.blocked}</span>
        <button style={styles.linkButton} onClick={() => (window.location.hash = '/settings')}>{t.manage}</button>
      </div>
    )
  }

  return (
    <div style={styles.col} dir={isAr ? 'rtl' : 'ltr'}>
      <button style={compact ? styles.linkButton : styles.blockButton} disabled={state === 'saving'} onClick={() => void onBlock()}>
        ⛔ {state === 'saving' ? t.blocking : t.block}
      </button>
      {error && <span style={styles.error} role="alert">{error}</span>}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  col: { display: 'flex', flexDirection: 'column', gap: 4 },
  doneRow: { display: 'flex', flexDirection: 'column', gap: 4 },
  blockButton: { padding: '8px 14px', borderRadius: 10, border: '1px solid #ccd', background: '#fff', color: '#8a1c1c', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
  linkButton: { background: 'transparent', border: 'none', color: '#2f6fed', cursor: 'pointer', padding: 0, fontSize: 13, alignSelf: 'flex-start' },
  success: { color: '#0a7d33', fontSize: 13 },
  error: { color: '#b3261e', fontSize: 13 },
}
