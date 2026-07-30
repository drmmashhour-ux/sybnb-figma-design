import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { askAssistant } from '../api/platformApi'

// ─────────────────────────────────────────────────────────────────────────────
// "ASK SYBNB AI" — floating assistant widget (client capsule)
//
// Available to EVERY user (guest/host/admin) from any page. Sends the question + language to the
// role-aware server capsule (/api/assistant/ask), which grounds + guardrails the answer and derives
// the role from the session. UI-only here; all safety lives in the server capsule.
// ─────────────────────────────────────────────────────────────────────────────

type Lang = 'ar' | 'en'
type Msg = { role: 'user' | 'ai'; text: string }

export function AssistantWidget({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const threadRef = useRef<HTMLDivElement>(null)

  const t = {
    open: isAr ? 'اسأل SYBNB AI' : 'Ask SYBNB AI',
    title: isAr ? 'مساعد SYBNB' : 'SYBNB Assistant',
    placeholder: isAr ? 'اكتب سؤالك…' : 'Type your question…',
    send: isAr ? 'إرسال' : 'Send',
    greeting: isAr
      ? 'مرحباً! كيف أساعدك في استخدام SYBNB؟ (الحجز، إضافة إعلان، الخطط، الدفع…)'
      : 'Hi! How can I help you use SYBNB? (booking, listing, plans, payments…)',
    error: isAr ? 'تعذّر الرد الآن. حاول مجدداً.' : 'Could not answer right now. Try again.',
    close: isAr ? 'إغلاق' : 'Close',
  }

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages, busy, open])

  async function send() {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: q }])
    setBusy(true)
    try {
      const { answer } = await askAssistant(q, lang)
      setMessages((m) => [...m, { role: 'ai', text: answer || t.error }])
    } catch {
      setMessages((m) => [...m, { role: 'ai', text: t.error }])
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ ...styles.fab, ...(isAr ? { left: 18 } : { right: 18 }) }} aria-label={t.open}>
        ✨ {t.open}
      </button>
    )
  }

  return (
    <div dir={isAr ? 'rtl' : 'ltr'} style={{ ...styles.panel, ...(isAr ? { left: 18 } : { right: 18 }) }}>
      <div style={styles.header}>
        <strong>{t.title}</strong>
        <button onClick={() => setOpen(false)} style={styles.closeBtn} aria-label={t.close}>×</button>
      </div>
      <div ref={threadRef} style={styles.thread}>
        <div style={styles.aiBubble}>{t.greeting}</div>
        {messages.map((m, i) => (
          <div key={i} style={m.role === 'user' ? styles.userBubble : styles.aiBubble}>{m.text}</div>
        ))}
        {busy && <div style={styles.aiBubble}>…</div>}
      </div>
      <form style={styles.inputRow} onSubmit={(event) => { event.preventDefault(); void send() }}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t.placeholder}
          style={styles.inputBox}
          aria-label={t.placeholder}
        />
        <button type="submit" disabled={busy} style={styles.sendBtn}>{t.send}</button>
      </form>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  fab: {
    position: 'fixed', bottom: 18, zIndex: 60, minHeight: 46, border: '1px solid rgba(45,212,191,.5)', borderRadius: 999,
    background: 'linear-gradient(135deg,#35e0cb,#2dd4bf)', color: '#05201c', fontWeight: 900, padding: '0 18px',
    cursor: 'pointer', boxShadow: '0 8px 24px rgba(45,212,191,.35)',
  },
  panel: {
    position: 'fixed', bottom: 18, zIndex: 60, width: 'min(360px, calc(100vw - 32px))', height: 'min(520px, calc(100vh - 120px))',
    display: 'flex', flexDirection: 'column', border: '1px solid #2a2c3a', borderRadius: 14, background: '#0d0d14',
    color: '#fff', overflow: 'hidden', boxShadow: '0 16px 40px rgba(0,0,0,.5)',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid #1e1f2b', background: '#111119' },
  closeBtn: { border: 0, background: 'transparent', color: '#9aa6ba', fontSize: 22, lineHeight: 1, cursor: 'pointer' },
  thread: { flex: 1, overflowY: 'auto', padding: 12, display: 'grid', gap: 8, alignContent: 'start' },
  aiBubble: { justifySelf: 'start', maxWidth: '85%', background: '#171826', border: '1px solid #242739', borderRadius: 12, padding: '10px 12px', lineHeight: 1.55, fontSize: 14 },
  userBubble: { justifySelf: 'end', maxWidth: '85%', background: 'linear-gradient(135deg,#1f9e90,#2dd4bf)', color: '#05201c', borderRadius: 12, padding: '10px 12px', lineHeight: 1.55, fontSize: 14 },
  inputRow: { display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #1e1f2b', background: '#111119' },
  inputBox: { flex: 1, minHeight: 42, border: '1px solid #2a2c3a', borderRadius: 10, background: '#0d0d14', color: '#fff', padding: '0 12px', fontSize: 14 },
  sendBtn: { minHeight: 42, border: 0, borderRadius: 10, background: '#d5a915', color: '#1a1300', fontWeight: 900, padding: '0 16px', cursor: 'pointer' },
}
