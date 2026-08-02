import type { PlatformBooking, PlatformListing } from '../../shared/api/platformApi'

export type GuestFeeSummary = {
  stayAmountMinor: number
  cleaningFeeMinor: number
  taxesMinor: number
  extraFeesMinor: number
  cancellationProtectionFeeMinor: number
  cancellationProtectionPurchased: boolean
  totalMinor: number
}

type BookingLike = Pick<PlatformBooking, 'amountMinor'> & {
  listing?: Pick<PlatformListing, 'division' | 'metadata'>
  metadata?: Record<string, unknown>
}

// MUST mirror server expectedTotalMinor() (server/routes/payments.mjs) and finance-ledger.mjs so the
// total the guest SEES equals what the wallet floor requires and what Stripe charges. Keep these rates
// in sync with finance-ledger.mjs (STR_CLEANING_RATE / STR_TAX_RATE / CANCELLATION_PROTECTION_RATE).
const STR_CLEANING_RATE = 0.05
const STR_TAX_RATE = 0
const CANCELLATION_PROTECTION_RATE = 0.03

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

// A fractional RATE (e.g. taxRate 0.13) must NOT be rounded — rounding turns 0.13 into 0 and drops the tax.
function metadataRate(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export function guestFeeSummary(booking: BookingLike): GuestFeeSummary {
  // booking.amountMinor is the STAY-ONLY base (nightly rent for the dates). Fees are added ON TOP —
  // exactly like the server. (The previous version treated amountMinor as the grand total and subtracted
  // fees, so the total shown was too low and the wallet payment got rejected / the card overcharged.)
  const stayAmountMinor = Math.max(0, Math.round(booking.amountMinor || 0))
  const metadata = booking.listing?.metadata
  const bookingMetadata = booking.metadata
  const isShortStay = !booking.listing || booking.listing.division === 'STAYS'

  const cleaningFeeMinor = metadataNumber(metadata, 'cleaningFeeMinor') || (isShortStay ? Math.round(stayAmountMinor * STR_CLEANING_RATE) : 0)
  const taxRate = metadataRate(metadata, 'taxRate')
  const taxesMinor = taxRate > 0
    ? Math.round(stayAmountMinor * taxRate)
    : (metadataNumber(metadata, 'taxesMinor') || (isShortStay ? Math.round(stayAmountMinor * STR_TAX_RATE) : 0))
  const extraFeesMinor = metadataNumber(metadata, 'extraFeesMinor')
  const cancellationProtectionPurchased = bookingMetadata?.cancellationProtectionPurchased === true
  const cancellationProtectionFeeMinor = cancellationProtectionPurchased
    ? metadataNumber(bookingMetadata, 'cancellationProtectionFeeMinor') || Math.round(stayAmountMinor * CANCELLATION_PROTECTION_RATE)
    : 0

  const totalMinor = stayAmountMinor + cleaningFeeMinor + taxesMinor + extraFeesMinor + cancellationProtectionFeeMinor

  return {
    stayAmountMinor,
    cleaningFeeMinor,
    taxesMinor,
    extraFeesMinor,
    cancellationProtectionFeeMinor,
    cancellationProtectionPurchased,
    totalMinor,
  }
}
