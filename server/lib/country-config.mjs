// Country configuration (021) — the single per-country source of truth that both STR and SR read from,
// so the platform can be licensed and operated across countries without re-architecture. Ship with Syria
// fully configured; adding a country later is one entry here. Values that already live in dedicated
// config (vehicle age limits, SR cancellation) are referenced, not duplicated, so there is one source.
import { VEHICLE_AGE_LIMITS } from './fleet.mjs'
import { SR_CANCELLATION_CONFIG } from './sr-cancellation.mjs'

export const DEFAULT_COUNTRY = 'SY'

export const COUNTRY_CONFIGS = {
  SY: {
    code: 'SY',
    name: 'Syria',
    currency: 'SYP',
    usdAccepted: true, // riders/guests may pay in USD (converted, rounded up) per currency.mjs
    languages: ['ar', 'en'],
    primaryLanguage: 'ar',
    rtl: true,
    paymentMethods: ['sham_cash', 'mastercard', 'wallet'],
    vatRatePct: 0, // set the real rate before launch if VAT applies
    vehicleAgeLimits: VEHICLE_AGE_LIMITS, // { 'SR Economy': 10, ... }
    srCancellation: {
      graceWindowSeconds: SR_CANCELLATION_CONFIG.graceWindowSeconds,
      feeRate: SR_CANCELLATION_CONFIG.feeRate,
      minFeeMinor: SR_CANCELLATION_CONFIG.minFeeMinor,
      maxFeeMinor: SR_CANCELLATION_CONFIG.maxFeeMinor,
    },
    disputeWindowHours: 48, // a customer may open a dispute within 48h of a completed ride/booking
    consumerProtection: {
      priceBeforeCommit: true,
      cancellationGrace: true,
      disputeRefunds: true,
      dataStaysOnPlatform: true,
    },
  },
}

export function getCountryConfig(code = DEFAULT_COUNTRY) {
  return COUNTRY_CONFIGS[String(code || '').toUpperCase()] || null
}

export function disputeWindowHours(code = DEFAULT_COUNTRY) {
  return getCountryConfig(code)?.disputeWindowHours ?? 48
}
