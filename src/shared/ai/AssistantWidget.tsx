import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { askAssistant, confirmAssistantBookingDraft, proposeAssistantBookingDraft, type AssistantActionPayload, type AssistantDraft, type AssistantListingCard } from '../api/platformApi'

type Locale = 'ar' | 'en' | 'fr'
type Msg = { role: 'user' | 'assistant'; text: string; listings?: AssistantListingCard[]; draft?: AssistantDraft | null }

const copy = {
  en: { open: 'Ask SYBNB AI', title: 'Booking Assistant', close: 'Close', greeting: 'Tell me your destination, dates, guest count, budget, property type, and requested amenities.', placeholder: 'Where would you like to stay?', send: 'Send', error: 'I could not safely complete that action. It may have expired or changed.', compare: 'Compare', selected: 'selected', prepare: 'Prepare booking draft', confirm: 'Confirm', reject: 'Cancel', checkIn: 'Check-in', checkOut: 'Check-out', guests: 'Guests', draft: 'Booking draft prepared — no reservation or payment has been made.', continue: 'Review booking', perNight: 'nightly base', stayTotal: 'stay total', available: 'Available', unknown: 'Check dates for availability' },
  fr: { open: 'Demander à SYBNB AI', title: 'Assistant de réservation', close: 'Fermer', greeting: 'Indiquez la destination, les dates, le nombre de voyageurs, le budget, le type de logement et les équipements souhaités.', placeholder: 'Où souhaitez-vous séjourner ?', send: 'Envoyer', error: 'Impossible d’effectuer cette action en toute sécurité. Elle a peut-être expiré ou changé.', compare: 'Comparer', selected: 'sélectionnés', prepare: 'Préparer le brouillon', confirm: 'Confirmer', reject: 'Annuler', checkIn: 'Arrivée', checkOut: 'Départ', guests: 'Voyageurs', draft: 'Brouillon préparé — aucune réservation ni aucun paiement effectué.', continue: 'Vérifier la réservation', perNight: 'base par nuit', stayTotal: 'total du séjour', available: 'Disponible', unknown: 'Vérifiez les dates' },
  ar: { open: 'اسأل SYBNB AI', title: 'مساعد الحجز', close: 'إغلاق', greeting: 'أخبرني بالوجهة والتواريخ وعدد الضيوف والميزانية ونوع العقار والمرافق المطلوبة.', placeholder: 'أين ترغب في الإقامة؟', send: 'إرسال', error: 'تعذّر تنفيذ الإجراء بأمان. ربما انتهت صلاحيته أو تغيّرت تفاصيله.', compare: 'مقارنة', selected: 'محدد', prepare: 'تجهيز مسودة الحجز', confirm: 'تأكيد', reject: 'إلغاء', checkIn: 'الوصول', checkOut: 'المغادرة', guests: 'الضيوف', draft: 'تم تجهيز المسودة — لم يتم الحجز أو الدفع.', continue: 'مراجعة الحجز', perNight: 'السعر الأساسي لليلة', stayTotal: 'إجمالي الإقامة', available: 'متاح', unknown: 'تحقق من التواريخ' },
}

export function AssistantWidget({ lang }: { lang: 'ar' | 'en' }) {
  if (import.meta.env.VITE_AI_BOOKING_ASSISTANT_ENABLED !== '1') return null
  return <EnabledAssistant initialLocale={lang} />
}

function EnabledAssistant({ initialLocale }: { initialLocale: Locale }) {
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [details, setDetails] = useState({ checkIn: '', checkOut: '', guests: 1 })
  const [pending, setPending] = useState<{ proposalId: string; payload: AssistantActionPayload; message: string } | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const isAr = locale === 'ar'; const t = copy[locale]

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }) }, [messages, busy, open])

  async function send(question = input.trim()) {
    if (!question || busy) return
    setInput(''); setMessages((items) => [...items, { role: 'user', text: question }]); setBusy(true)
    try {
      const history = messages.slice(-10).map((item) => ({ role: item.role, content: item.text }))
      const result = await askAssistant(question, locale, history)
      setMessages((items) => [...items, { role: 'assistant', text: result.answer || t.error, listings: result.listings, draft: result.draft }])
    } catch { setMessages((items) => [...items, { role: 'assistant', text: t.error }]) } finally { setBusy(false) }
  }

  async function proposeDraft() {
    if (selected.length !== 1 || !details.checkIn || !details.checkOut || busy) return
    const payload = { listingId: selected[0], ...details }; setBusy(true)
    try { const proposal = await proposeAssistantBookingDraft(payload, locale); setPending({ proposalId: proposal.proposalId, payload, message: proposal.message }) }
    catch { setMessages((items) => [...items, { role: 'assistant', text: t.error }]) } finally { setBusy(false) }
  }
  async function resolveDraft(decision: boolean) {
    if (!pending || busy) return; setBusy(true)
    try { const result = await confirmAssistantBookingDraft(pending.proposalId, pending.payload, decision, locale); if (result.result?.draft) setMessages((items) => [...items, { role: 'assistant', text: t.draft, draft: result.result?.draft }]); setPending(null) }
    catch { setPending(null); setMessages((items) => [...items, { role: 'assistant', text: t.error }]) } finally { setBusy(false) }
  }

  function toggle(id: string) { setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : items.length < 3 ? [...items, id] : items) }
  const side = isAr ? { left: 16 } : { right: 16 }
  if (!open) return <button onClick={() => setOpen(true)} style={{ ...styles.fab, ...side }} aria-label={t.open}>✨ {t.open}</button>

  return (
    <section role="dialog" aria-modal="false" aria-label={t.title} dir={isAr ? 'rtl' : 'ltr'} style={{ ...styles.panel, ...side }}>
      <header style={styles.header}><strong>{t.title}</strong><div style={styles.headerActions}>{(['en', 'fr', 'ar'] as Locale[]).map((item) => <button key={item} aria-pressed={locale === item} onClick={() => setLocale(item)} style={{ ...styles.lang, ...(locale === item ? styles.langOn : {}) }}>{item.toUpperCase()}</button>)}<button onClick={() => setOpen(false)} style={styles.closeBtn} aria-label={t.close}>×</button></div></header>
      <div ref={threadRef} style={styles.thread} aria-live="polite">
        <div style={styles.aiBubble}>{t.greeting}</div>
        {messages.map((message, index) => <div key={index} style={styles.messageGroup}><div style={message.role === 'user' ? styles.userBubble : styles.aiBubble}>{message.text}</div>{message.listings?.map((listing) => <ListingCard key={listing.id} listing={listing} locale={locale} selected={selected.includes(listing.id)} onToggle={() => toggle(listing.id)} />)}{message.draft ? <DraftCard draft={message.draft} locale={locale} /> : null}</div>)}
        {busy ? <div style={styles.aiBubble}>…</div> : null}
      </div>
      {selected.length > 1 ? <button style={styles.compareBtn} onClick={() => void send(`${t.compare}: ${selected.join(', ')}`)}>{t.compare} ({selected.length}/3 {t.selected})</button> : null}
      {selected.length === 1 ? <div style={styles.draftFields}><label>{t.checkIn}<input type="date" value={details.checkIn} onChange={(e) => setDetails((v) => ({ ...v, checkIn: e.target.value }))}/></label><label>{t.checkOut}<input type="date" value={details.checkOut} onChange={(e) => setDetails((v) => ({ ...v, checkOut: e.target.value }))}/></label><label>{t.guests}<input type="number" min={1} max={30} value={details.guests} onChange={(e) => setDetails((v) => ({ ...v, guests: Number(e.target.value) }))}/></label><button style={styles.confirmBtn} onClick={() => void proposeDraft()}>{t.prepare}</button></div> : null}
      {pending ? <div role="alertdialog" aria-label={t.confirm} style={styles.confirmation}><p>{pending.message}</p><button style={styles.confirmBtn} onClick={() => void resolveDraft(true)}>{t.confirm}</button><button style={styles.compareBtn} onClick={() => void resolveDraft(false)}>{t.reject}</button></div> : null}
      <form style={styles.inputRow} onSubmit={(event) => { event.preventDefault(); void send() }}><input value={input} maxLength={1000} onChange={(event) => setInput(event.target.value)} placeholder={t.placeholder} style={styles.inputBox} aria-label={t.placeholder}/><button type="submit" disabled={busy || !input.trim()} style={styles.sendBtn}>{t.send}</button></form>
    </section>
  )
}

function ListingCard({ listing, locale, selected, onToggle }: { listing: AssistantListingCard; locale: Locale; selected: boolean; onToggle: () => void }) {
  const t = copy[locale]; const title = listing.title[locale] || listing.title.en
  return <article style={styles.card}>{listing.image ? <img src={listing.image} alt="" style={styles.image} /> : null}<div style={styles.cardBody}><strong>{title}</strong><span>{listing.locationSummary || '—'}</span><span dir="ltr">{new Intl.NumberFormat(locale === 'ar' ? 'ar-SY' : locale).format(listing.price.amountMinor / 100)} {listing.price.currency} · {listing.price.basis === 'stay_total' ? t.stayTotal : t.perNight}</span><span>{listing.availability === true ? t.available : t.unknown}{listing.rating != null ? ` · ★ ${listing.rating} (${listing.reviewCount})` : ''}</span><div style={styles.cardActions}><a href={listing.link} style={styles.link}>Details</a><label><input type="checkbox" checked={selected} onChange={onToggle}/> {t.compare}</label></div></div></article>
}

function DraftCard({ draft, locale }: { draft: AssistantDraft; locale: Locale }) { const t = copy[locale]; return <div style={styles.draft}><strong>{t.draft}</strong><span dir="ltr">{draft.checkIn} → {draft.checkOut} · {draft.guests}</span><span dir="ltr">{new Intl.NumberFormat(locale === 'ar' ? 'ar-SY' : locale).format(draft.total.amountMinor / 100)} {draft.total.currency}</span><a href={draft.bookingLink} style={styles.link}>{t.continue}</a></div> }

const styles: Record<string, CSSProperties> = {
  fab: { position: 'fixed', bottom: 16, zIndex: 60, minHeight: 48, border: '1px solid rgba(45,212,191,.5)', borderRadius: 999, background: 'linear-gradient(135deg,#35e0cb,#2dd4bf)', color: '#05201c', fontWeight: 900, padding: '0 18px', cursor: 'pointer', boxShadow: '0 8px 24px rgba(45,212,191,.35)' },
  panel: { position: 'fixed', bottom: 16, zIndex: 60, width: 'min(430px, calc(100vw - 24px))', height: 'min(680px, calc(100dvh - 32px))', display: 'flex', flexDirection: 'column', border: '1px solid #2a2c3a', borderRadius: 16, background: '#0d0d14', color: '#fff', overflow: 'hidden', boxShadow: '0 16px 40px rgba(0,0,0,.5)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px', borderBottom: '1px solid #1e1f2b', background: '#111119' }, headerActions: { display: 'flex', alignItems: 'center', gap: 4 }, lang: { border: '1px solid #2a2c3a', borderRadius: 7, background: 'transparent', color: '#9aa6ba', minHeight: 32 }, langOn: { background: '#2dd4bf', color: '#05201c' }, closeBtn: { border: 0, background: 'transparent', color: '#fff', fontSize: 24, minWidth: 36, minHeight: 36, cursor: 'pointer' },
  thread: { flex: 1, overflowY: 'auto', padding: 12, display: 'grid', gap: 10, alignContent: 'start' }, messageGroup: { display: 'grid', gap: 8 }, aiBubble: { justifySelf: 'start', maxWidth: '88%', whiteSpace: 'pre-wrap', background: '#171826', border: '1px solid #242739', borderRadius: 12, padding: '10px 12px', lineHeight: 1.55, fontSize: 14 }, userBubble: { justifySelf: 'end', maxWidth: '88%', background: '#2dd4bf', color: '#05201c', borderRadius: 12, padding: '10px 12px', lineHeight: 1.55, fontSize: 14 },
  card: { display: 'grid', gridTemplateColumns: '96px 1fr', overflow: 'hidden', border: '1px solid #2a2c3a', borderRadius: 12, background: '#111119' }, image: { width: 96, height: '100%', minHeight: 132, objectFit: 'cover' }, cardBody: { display: 'grid', gap: 5, padding: 10, fontSize: 12 }, cardActions: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, link: { color: '#35e0cb', fontWeight: 800 }, draft: { display: 'grid', gap: 6, padding: 12, border: '1px solid #d5a915', borderRadius: 12, background: '#17150c', fontSize: 13 },
  compareBtn: { margin: '0 10px 8px', minHeight: 42, borderRadius: 10, border: '1px solid #2dd4bf', background: 'transparent', color: '#2dd4bf', fontWeight: 900 }, confirmBtn: { margin: '0 10px 8px', minHeight: 44, borderRadius: 10, border: 0, background: '#d5a915', color: '#1a1300', fontWeight: 900 }, inputRow: { display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #1e1f2b', background: '#111119' }, inputBox: { flex: 1, minWidth: 0, minHeight: 44, border: '1px solid #2a2c3a', borderRadius: 10, background: '#0d0d14', color: '#fff', padding: '0 12px', fontSize: 16 }, sendBtn: { minHeight: 44, border: 0, borderRadius: 10, background: '#d5a915', color: '#1a1300', fontWeight: 900, padding: '0 16px' },
  draftFields: { display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 6, padding: '0 10px 8px', fontSize: 12 }, confirmation: { margin: '0 10px 8px', padding: 10, border: '1px solid #d5a915', borderRadius: 10, background: '#17150c' },
}
