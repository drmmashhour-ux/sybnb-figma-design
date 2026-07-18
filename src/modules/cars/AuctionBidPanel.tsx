import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchAuctionState, placeAuctionBid, type PlatformAuctionState, type PlatformListing } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'
import { formatCountdown, useCountdown } from './useCountdown'

type Props = {
  lang: Lang
  listing: PlatformListing
  // Reuses the page's EXISTING "Contact seller" action verbatim -- no new messaging code. The
  // "You won" banner is just a thin wrapper around whatever the page already does for that button.
  onContactSeller: () => void
}

const copy = {
  ar: {
    title: 'المزاد',
    currentPrice: 'السعر الحالي',
    reserveMet: 'تم بلوغ الحد الأدنى',
    reserveNotMet: 'لم يتم بلوغ الحد الأدنى بعد',
    timeLeft: 'الوقت المتبقي',
    bidCount: 'عدد العروض',
    yourMaxBid: 'أعلى سعر ترغب بدفعه',
    placeBid: 'قدّم عرضك',
    placing: 'جارِ الإرسال...',
    youAreLeading: 'أنت صاحب أعلى عرض حالياً',
    ended: 'انتهى المزاد',
    youWon: 'لقد فزت بهذا المزاد!',
    reserveNotMetEnded: 'انتهى المزاد دون بلوغ الحد الأدنى للبائع.',
    noWinner: 'انتهى المزاد دون فوز أحد بالحد الأدنى المطلوب.',
    contactSeller: 'تواصل مع البائع',
    minBidHint: (amount: string) => `أدخل ${amount} على الأقل.`,
  },
  en: {
    title: 'Auction',
    currentPrice: 'Current price',
    reserveMet: 'Reserve met',
    reserveNotMet: 'Reserve not yet met',
    timeLeft: 'Time left',
    bidCount: 'Bids',
    yourMaxBid: 'Your maximum bid',
    placeBid: 'Place bid',
    placing: 'Placing...',
    youAreLeading: 'You are currently the highest bidder',
    ended: 'Auction ended',
    youWon: 'You won this auction!',
    reserveNotMetEnded: "The auction ended without reaching the seller's reserve price.",
    noWinner: 'The auction ended without a winning bid at the reserve price.',
    contactSeller: 'Contact seller',
    minBidHint: (amount: string) => `Enter at least ${amount}.`,
  },
}

export function AuctionBidPanel({ lang, listing, onContactSeller }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [auction, setAuction] = useState<PlatformAuctionState | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [bidAmount, setBidAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const countdown = useCountdown(auction?.endsAt)

  async function load() {
    try {
      const state = await fetchAuctionState(listing.id)
      setAuction(state)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.id])

  async function submitBid() {
    if (!auction) return
    const amount = Number(bidAmount)
    if (!Number.isInteger(amount) || amount <= 0) {
      setError(isAr ? 'أدخل مبلغاً صحيحاً.' : 'Enter a valid amount.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await placeAuctionBid(listing.id, amount)
      await load()
      setBidAmount('')
    } catch (err) {
      setError(err instanceof Error ? err.message : (isAr ? 'تعذر إرسال العرض.' : 'Could not place bid.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading') return null
  if (status === 'error' || !auction) return null

  return (
    <section style={styles.panel} dir={isAr ? 'rtl' : 'ltr'}>
      <strong>{t.title}</strong>
      <div style={styles.row}>
        <span style={styles.label}>{t.currentPrice}</span>
        <strong dir="ltr">{moneyText(auction.currentPriceMinor, listing.currency, lang)}</strong>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>{auction.reserveMet ? t.reserveMet : t.reserveNotMet}</span>
      </div>
      {auction.status === 'OPEN' && (
        <div style={styles.row}>
          <span style={styles.label}>{t.timeLeft}</span>
          <strong>{formatCountdown(countdown, isAr)}</strong>
        </div>
      )}
      <div style={styles.row}>
        <span style={styles.label}>{t.bidCount}</span>
        <strong>{auction.bidCount}</strong>
      </div>

      {auction.status === 'OPEN' && (
        <>
          {auction.youAreHighestBidder && <p style={styles.leading}>{t.youAreLeading}</p>}
          <label style={styles.field}>
            <span>{t.yourMaxBid}</span>
            <input
              dir="ltr"
              inputMode="numeric"
              onChange={(event) => setBidAmount(event.target.value)}
              placeholder={String(auction.currentPriceMinor)}
              value={bidAmount}
            />
          </label>
          <span style={styles.hint}>{t.minBidHint(moneyText(auction.currentPriceMinor, listing.currency, lang))}</span>
          {error && <p style={styles.error}>{error}</p>}
          <button disabled={submitting} onClick={() => void submitBid()} style={styles.submitButton} type="button">
            {submitting ? t.placing : t.placeBid}
          </button>
        </>
      )}

      {auction.status === 'ENDED' && (
        <div style={styles.endedBlock}>
          <strong>{t.ended}</strong>
          {auction.youWon ? (
            <>
              <p style={styles.wonMessage}>{t.youWon}</p>
              <button onClick={onContactSeller} style={styles.submitButton} type="button">
                {t.contactSeller}
              </button>
            </>
          ) : (
            <p style={styles.label}>{auction.hasWinner ? t.noWinner : t.reserveNotMetEnded}</p>
          )}
        </div>
      )}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: { border: '1px solid #242735', borderRadius: 12, background: '#0c1220', padding: 14, display: 'grid', gap: 10, color: '#fff' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  label: { color: '#9aa6ba', fontWeight: 850, fontSize: 13 },
  field: { display: 'grid', gap: 6 },
  hint: { color: '#9aa6ba', fontSize: 12 },
  leading: { color: '#20d29b', fontWeight: 850, fontSize: 13 },
  error: { color: '#e0574a', fontSize: 13, fontWeight: 850 },
  submitButton: { minHeight: 44, border: 0, borderRadius: 10, background: '#526cff', color: '#fff', fontWeight: 950 },
  endedBlock: { display: 'grid', gap: 8, borderTop: '1px solid #242735', paddingTop: 10 },
  wonMessage: { color: '#20d29b', fontWeight: 900 },
}
