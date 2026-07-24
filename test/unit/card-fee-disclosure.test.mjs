import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STR_HOST_CONTRACT_VERSION, assertContractConsentAccepted } from '../../server/lib/host-consent.mjs'

// H6 / M6 v3 — the host bears the Stripe card processing fee. This must be disclosed UPFRONT in the M6
// consent (contract) + the payout previews, and adding a contract term bumps the version so existing hosts
// re-consent via the M6 gate. Money math is unchanged (host-borne is already how it works).

const wizard = readFileSync(new URL('../../src/modules/seller/SellerListingWizard.tsx', import.meta.url), 'utf8')
const dashboard = readFileSync(new URL('../../src/modules/host/HostDashboardPage.tsx', import.meta.url), 'utf8')
const timeline = readFileSync(new URL('../../src/modules/host/HostPaymentsTimeline.tsx', import.meta.url), 'utf8')

describe('H6 / M6 v3 — card-fee disclosure + re-consent', () => {
  it('bumps the contract version (forcing re-consent) to a card-fee version', () => {
    expect(STR_HOST_CONTRACT_VERSION).toBe('str-host-commission-v3-card-fee')
  })

  it('the M6 gate now REQUIRES the new version — the prior v2 consent is stale', () => {
    expect(() => assertContractConsentAccepted({ acceptContract: true, contractVersion: 'str-host-commission-v2-accom-cleaning' })).toThrow()
    expect(() => assertContractConsentAccepted({ acceptContract: true, contractVersion: STR_HOST_CONTRACT_VERSION })).not.toThrow()
  })

  it('the wizard consent + note disclose the card fee in ar/en/fr', () => {
    // Consent checkbox itself carries the term (what the host accepts).
    expect(wizard).toMatch(/card processing fee is deducted from my payout \(no fee on Sham Cash\)/)
    // Tri-lingual disclosure line.
    expect(wizard).toMatch(/the processing fee is deducted from your payout; local Sham Cash payments have no processing fee/)
    expect(wizard).toMatch(/frais de traitement sont déduits de votre versement/) // fr
    expect(wizard).toMatch(/تُخصم رسوم المعالجة من مستحقاتك/) // ar
  })

  it('the host dashboard accept-time preview discloses the card fee', () => {
    expect(dashboard).toMatch(/cardFeeNote/)
    expect(dashboard).toMatch(/the processing fee is deducted from your payout; local Sham Cash payments have no processing fee/)
  })

  it('the payments timeline labels the card-fee deduction only when net < gross', () => {
    expect(timeline).toMatch(/row\.netPayoutMinor < row\.hostPayoutMinor/)
    expect(timeline).toMatch(/t\.cardFee/)
    expect(timeline).toMatch(/row\.hostPayoutMinor - row\.netPayoutMinor/)
  })
})
