// Country configuration (021) — the single per-country source of truth that both STR and SR read from,
// so the platform can be licensed and operated across countries without re-architecture. Ship with Syria
// fully configured; adding a country later is one entry here. Values that already live in dedicated
// config (vehicle age limits, SR cancellation) are referenced, not duplicated, so there is one source.
import { VEHICLE_AGE_LIMITS } from './fleet.mjs'
import { SR_CANCELLATION_CONFIG } from './sr-cancellation.mjs'

export const DEFAULT_COUNTRY = 'SY'

// The four consumer-protection guarantees are the same platform-wide — they describe SYBNB's operating
// model, not a local regulation — so every country references this one object.
const CONSUMER_PROTECTION = {
  priceBeforeCommit: true,
  cancellationGrace: true,
  disputeRefunds: true,
  dataStaysOnPlatform: true,
}

// SR late-cancel fee floor/ceiling are denominated in SYP in SR_CANCELLATION_CONFIG. For any non-SYP
// market they are NOT yet tuned, so keep the universal grace window + fee RATE and leave the fee
// effectively uncapped (min 0, a large ceiling) until a per-currency min/max is set — CONFIRM per market.
const UNTUNED_MAX_FEE_MINOR = 100_000_000
function srCancel({ minFeeMinor = 0, maxFeeMinor = UNTUNED_MAX_FEE_MINOR } = {}) {
  return {
    graceWindowSeconds: SR_CANCELLATION_CONFIG.graceWindowSeconds,
    feeRate: SR_CANCELLATION_CONFIG.feeRate,
    minFeeMinor,
    maxFeeMinor,
  }
}

// Gulf markets typically mandate newer rideshare fleets than the default 10/7/7 — CONFIRM per regulator.
const GULF_VEHICLE_AGE_LIMITS = { 'SR Economy': 7, 'SR Comfort': 7, 'SR SUV': 7 }

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
    strLateCancelFee: {
      feeMinor: 50000, // flat STR late-cancel fee in the country's own currency (SYP) — CONFIRM pre-launch
      feeMinorUsd: 10, // flat fee when the booking was paid in USD
    },
    consumerProtection: {
      priceBeforeCommit: true,
      cancellationGrace: true,
      disputeRefunds: true,
      dataStaysOnPlatform: true,
    },
  },

  // --- Seed set: Arab region + two global templates. Every regulatory number below (VAT, vehicle-age,
  // payment methods, late-cancel amounts) is a provisional SCAFFOLD — CONFIRM with local counsel before a
  // market goes live. Turning a country on is then a reviewed one-entry change. ---

  IQ: {
    code: 'IQ',
    name: 'Iraq',
    currency: 'IQD',
    usdAccepted: true,
    languages: ['ar', 'en'],
    primaryLanguage: 'ar',
    rtl: true,
    paymentMethods: ['card', 'wallet'], // provisional
    vatRatePct: 0, // CONFIRM
    vehicleAgeLimits: VEHICLE_AGE_LIMITS,
    srCancellation: srCancel(),
    disputeWindowHours: 48,
    strLateCancelFee: { feeMinor: 15000, feeMinorUsd: 10 }, // CONFIRM (IQD)
    consumerProtection: CONSUMER_PROTECTION,
  },

  LB: {
    code: 'LB',
    name: 'Lebanon',
    currency: 'LBP',
    usdAccepted: true,
    languages: ['ar', 'en'],
    primaryLanguage: 'ar',
    rtl: true,
    paymentMethods: ['card', 'wallet'], // provisional
    vatRatePct: 11, // CONFIRM
    vehicleAgeLimits: VEHICLE_AGE_LIMITS,
    srCancellation: srCancel(),
    disputeWindowHours: 48,
    strLateCancelFee: { feeMinor: 500000, feeMinorUsd: 10 }, // CONFIRM (LBP)
    consumerProtection: CONSUMER_PROTECTION,
  },

  JO: {
    code: 'JO',
    name: 'Jordan',
    currency: 'JOD',
    usdAccepted: false,
    languages: ['ar', 'en'],
    primaryLanguage: 'ar',
    rtl: true,
    paymentMethods: ['card', 'wallet'], // provisional
    vatRatePct: 16, // CONFIRM
    vehicleAgeLimits: VEHICLE_AGE_LIMITS,
    srCancellation: srCancel(),
    disputeWindowHours: 48,
    strLateCancelFee: { feeMinor: 7, feeMinorUsd: 10 }, // CONFIRM (JOD)
    consumerProtection: CONSUMER_PROTECTION,
  },

  AE: {
    code: 'AE',
    name: 'United Arab Emirates',
    currency: 'AED',
    usdAccepted: true,
    languages: ['ar', 'en'],
    primaryLanguage: 'ar',
    rtl: true,
    paymentMethods: ['card', 'apple_pay', 'wallet'], // provisional
    vatRatePct: 5, // CONFIRM
    vehicleAgeLimits: GULF_VEHICLE_AGE_LIMITS, // CONFIRM per regulator
    srCancellation: srCancel(),
    disputeWindowHours: 48,
    strLateCancelFee: { feeMinor: 40, feeMinorUsd: 10 }, // CONFIRM (AED)
    consumerProtection: CONSUMER_PROTECTION,
  },

  SA: {
    code: 'SA',
    name: 'Saudi Arabia',
    currency: 'SAR',
    usdAccepted: false,
    languages: ['ar', 'en'],
    primaryLanguage: 'ar',
    rtl: true,
    paymentMethods: ['card', 'apple_pay', 'wallet'], // provisional
    vatRatePct: 15, // CONFIRM
    vehicleAgeLimits: GULF_VEHICLE_AGE_LIMITS, // CONFIRM per regulator
    srCancellation: srCancel(),
    disputeWindowHours: 48,
    strLateCancelFee: { feeMinor: 40, feeMinorUsd: 10 }, // CONFIRM (SAR)
    consumerProtection: CONSUMER_PROTECTION,
  },

  EG: {
    code: 'EG',
    name: 'Egypt',
    currency: 'EGP',
    usdAccepted: false,
    languages: ['ar', 'en'],
    primaryLanguage: 'ar',
    rtl: true,
    paymentMethods: ['card', 'wallet'], // provisional
    vatRatePct: 14, // CONFIRM
    vehicleAgeLimits: VEHICLE_AGE_LIMITS,
    srCancellation: srCancel(),
    disputeWindowHours: 48,
    strLateCancelFee: { feeMinor: 300, feeMinorUsd: 10 }, // CONFIRM (EGP)
    consumerProtection: CONSUMER_PROTECTION,
  },

  QA: {
    code: 'QA',
    name: 'Qatar',
    currency: 'QAR',
    usdAccepted: true,
    languages: ['ar', 'en'],
    primaryLanguage: 'ar',
    rtl: true,
    paymentMethods: ['card', 'apple_pay', 'wallet'], // provisional
    vatRatePct: 0, // CONFIRM
    vehicleAgeLimits: GULF_VEHICLE_AGE_LIMITS, // CONFIRM per regulator
    srCancellation: srCancel(),
    disputeWindowHours: 48,
    strLateCancelFee: { feeMinor: 40, feeMinorUsd: 10 }, // CONFIRM (QAR)
    consumerProtection: CONSUMER_PROTECTION,
  },

  US: {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    usdAccepted: true,
    languages: ['en'],
    primaryLanguage: 'en',
    rtl: false,
    paymentMethods: ['card', 'apple_pay', 'wallet'], // provisional
    vatRatePct: 0, // CONFIRM — no federal VAT; state/local sales tax varies and is out of scope here
    vehicleAgeLimits: VEHICLE_AGE_LIMITS,
    srCancellation: srCancel(),
    disputeWindowHours: 48,
    strLateCancelFee: { feeMinor: 10, feeMinorUsd: 10 }, // CONFIRM (USD)
    consumerProtection: CONSUMER_PROTECTION,
  },

  GB: {
    code: 'GB',
    name: 'United Kingdom',
    currency: 'GBP',
    usdAccepted: false,
    languages: ['en'],
    primaryLanguage: 'en',
    rtl: false,
    paymentMethods: ['card', 'apple_pay', 'wallet'], // provisional
    vatRatePct: 20, // CONFIRM
    vehicleAgeLimits: VEHICLE_AGE_LIMITS,
    srCancellation: srCancel(),
    disputeWindowHours: 48,
    strLateCancelFee: { feeMinor: 8, feeMinorUsd: 10 }, // CONFIRM (GBP)
    consumerProtection: CONSUMER_PROTECTION,
  },
}

export function getCountryConfig(code = DEFAULT_COUNTRY) {
  return COUNTRY_CONFIGS[String(code || '').toUpperCase()] || null
}

export function disputeWindowHours(code = DEFAULT_COUNTRY) {
  return getCountryConfig(code)?.disputeWindowHours ?? 48
}

// Flat STR late-cancel fee in the booking's own currency, sourced from country-config so it is one source
// of truth and can be tuned per country. USD-paid bookings use feeMinorUsd; everything else uses the
// local-currency feeMinor. Returns 0 for a country with no fee configured.
export function strLateCancelFeeMinor(currency, code = DEFAULT_COUNTRY) {
  const fee = getCountryConfig(code)?.strLateCancelFee
  if (!fee) return 0
  return currency === 'USD' ? fee.feeMinorUsd ?? 0 : fee.feeMinor ?? 0
}
