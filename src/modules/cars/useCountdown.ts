import { useEffect, useState } from 'react'

// Shared live countdown for auction badges/panels (CarBrowsePage cards, AuctionBidPanel). Returns
// whole seconds remaining until `endsAt` (0 once passed) plus a small AR/EN-formattable breakdown
// so callers don't each reimplement the same interval/teardown.
export function useCountdown(endsAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!endsAt) return undefined
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [endsAt])

  if (!endsAt) return { secondsRemaining: 0, isEnded: true, days: 0, hours: 0, minutes: 0, seconds: 0 }

  const remainingMs = Math.max(0, new Date(endsAt).getTime() - now)
  const secondsRemaining = Math.floor(remainingMs / 1000)
  const days = Math.floor(secondsRemaining / 86400)
  const hours = Math.floor((secondsRemaining % 86400) / 3600)
  const minutes = Math.floor((secondsRemaining % 3600) / 60)
  const seconds = secondsRemaining % 60

  return { secondsRemaining, isEnded: secondsRemaining <= 0, days, hours, minutes, seconds }
}

export function formatCountdown(countdown: ReturnType<typeof useCountdown>, isAr: boolean) {
  if (countdown.isEnded) return isAr ? 'انتهى المزاد' : 'Auction ended'
  if (countdown.days > 0) return isAr ? `${countdown.days} يوم ${countdown.hours} س` : `${countdown.days}d ${countdown.hours}h`
  if (countdown.hours > 0) return isAr ? `${countdown.hours} س ${countdown.minutes} د` : `${countdown.hours}h ${countdown.minutes}m`
  return isAr ? `${countdown.minutes} د ${countdown.seconds} ث` : `${countdown.minutes}m ${countdown.seconds}s`
}
