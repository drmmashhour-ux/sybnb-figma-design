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
  const totalMinor = Math.max(0, Math.round(booking.amountMinor || 0))
  const metadata = booking.listing?.metadata
  const bookingMetadata = booking.metadata

  // Guest checkout must keep the exact confirmed quote. Fees appear only when they were
  // explicitly configured; there are no hidden automatic cleaning, tax, or platform fees.
  const cleaningFeeMinor = metadataNumber(metadata, 'cleaningFeeMinor')
  const taxesMinor = metadataNumber(metadata, 'taxesMinor')
  const extraFeesMinor = metadataNumber(metadata, 'extraFeesMinor')
  const cancellationProtectionPurchased = bookingMetadata?.cancellationProtectionPurchased === true
  const cancellationProtectionFeeMinor = cancellationProtectionPurchased ? metadataNumber(bookingMetadata, 'cancellationProtectionFeeMinor') : 0
  const itemizedFeesMinor = cleaningFeeMinor + taxesMinor + extraFeesMinor + cancellationProtectionFeeMinor
  const stayAmountMinor = Math.max(0, totalMinor - itemizedFeesMinor)

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
