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

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

export function guestFeeSummary(booking: BookingLike): GuestFeeSummary {
  const stayAmountMinor = Math.max(0, Math.round(booking.amountMinor || 0))
  const metadata = booking.listing?.metadata
  const bookingMetadata = booking.metadata
  const isShortStay = !booking.listing || booking.listing.division === 'STAYS'

  const cleaningFeeMinor = metadataNumber(metadata, 'cleaningFeeMinor') || (isShortStay ? Math.round(stayAmountMinor * 0.05) : 0)
  const taxesMinor = metadataNumber(metadata, 'taxesMinor') || (isShortStay ? Math.round(stayAmountMinor * 0.02) : 0)
  const extraFeesMinor = metadataNumber(metadata, 'extraFeesMinor')
  const cancellationProtectionPurchased = bookingMetadata?.cancellationProtectionPurchased === true
  const cancellationProtectionFeeMinor = cancellationProtectionPurchased
    ? metadataNumber(bookingMetadata, 'cancellationProtectionFeeMinor') || Math.round(stayAmountMinor * 0.03)
    : 0

  return {
    stayAmountMinor,
    cleaningFeeMinor,
    taxesMinor,
    extraFeesMinor,
    cancellationProtectionFeeMinor,
    cancellationProtectionPurchased,
    totalMinor: stayAmountMinor + cleaningFeeMinor + taxesMinor + extraFeesMinor + cancellationProtectionFeeMinor,
  }
}
