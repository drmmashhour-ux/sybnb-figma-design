import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  COUNTRY_CONFIGS,
  DEFAULT_COUNTRY,
  disputeWindowHours,
  getCountryConfig,
  strLateCancelFeeMinor,
} from '../../server/lib/country-config.mjs'
import { testApp } from '../support/testServer.mjs'

// Globalization: the per-country config layer is seeded with an Arab-region + global starter set. These
// prove every seeded country is well-formed, the lookup/default/unknown contract holds, the public
// endpoint exposes a seeded country and 404s an unknown one, and the derived helpers read config.
const SR_TIERS = ['SR Economy', 'SR Comfort', 'SR SUV', 'SR XXL']
const REQUIRED_KEYS = [
  'code', 'name', 'currency', 'usdAccepted', 'languages', 'primaryLanguage', 'rtl',
  'paymentMethods', 'vatRatePct', 'vehicleAgeLimits', 'srCancellation', 'disputeWindowHours',
  'strLateCancelFee', 'consumerProtection',
]

describe('Country configuration (globalization seed set)', () => {
  it('1. every configured country is well-formed', () => {
    const codes = Object.keys(COUNTRY_CONFIGS)
    expect(codes.length).toBeGreaterThanOrEqual(10) // SY + the 9 seed countries

    for (const [code, cfg] of Object.entries(COUNTRY_CONFIGS)) {
      // the map key matches the config's own code, uppercased 2-letter
      expect(cfg.code).toBe(code)
      expect(code).toMatch(/^[A-Z]{2}$/)

      for (const key of REQUIRED_KEYS) {
        expect(cfg, `${code} is missing ${key}`).toHaveProperty(key)
      }

      expect(cfg.currency, `${code} currency`).toMatch(/^[A-Z]{3}$/)
      expect(Array.isArray(cfg.languages) && cfg.languages.length > 0, `${code} languages`).toBe(true)
      expect(cfg.languages, `${code} includes primaryLanguage`).toContain(cfg.primaryLanguage)
      expect(typeof cfg.rtl, `${code} rtl`).toBe('boolean')
      expect(typeof cfg.usdAccepted, `${code} usdAccepted`).toBe('boolean')
      expect(Number.isFinite(cfg.vatRatePct) && cfg.vatRatePct >= 0, `${code} vatRatePct`).toBe(true)
      expect(cfg.disputeWindowHours, `${code} disputeWindowHours`).toBeGreaterThan(0)
      expect(Array.isArray(cfg.paymentMethods) && cfg.paymentMethods.length > 0, `${code} paymentMethods`).toBe(true)

      for (const tier of SR_TIERS) {
        expect(cfg.vehicleAgeLimits, `${code} vehicleAgeLimits.${tier}`).toHaveProperty(tier)
        expect(cfg.vehicleAgeLimits[tier], `${code} ${tier} age`).toBeGreaterThan(0)
      }

      expect(Number.isFinite(cfg.strLateCancelFee.feeMinor) && cfg.strLateCancelFee.feeMinor >= 0, `${code} feeMinor`).toBe(true)
      expect(Number.isFinite(cfg.strLateCancelFee.feeMinorUsd) && cfg.strLateCancelFee.feeMinorUsd >= 0, `${code} feeMinorUsd`).toBe(true)

      for (const flag of ['priceBeforeCommit', 'cancellationGrace', 'disputeRefunds', 'dataStaysOnPlatform']) {
        expect(cfg.consumerProtection[flag], `${code} consumerProtection.${flag}`).toBe(true)
      }
    }
  })

  it('2. getCountryConfig: case-insensitive lookup, default, and unknown → null', () => {
    // sham_cash is a Syria-only payment method — assert it stays scoped to SY.
    expect(getCountryConfig('SY').paymentMethods).toContain('sham_cash')
    for (const code of Object.keys(COUNTRY_CONFIGS)) {
      expect(getCountryConfig(code).code).toBe(code)
      expect(getCountryConfig(code.toLowerCase()).code).toBe(code) // case-insensitive
      if (code !== 'SY') {
        expect(getCountryConfig(code).paymentMethods, `${code} must not offer sham_cash`).not.toContain('sham_cash')
      }
    }
    expect(getCountryConfig('ZZ')).toBeNull()
    expect(getCountryConfig()).toBe(COUNTRY_CONFIGS[DEFAULT_COUNTRY]) // default is SY
    expect(getCountryConfig().code).toBe('SY')
  })

  describe('3. public endpoint GET /api/config/country/:code', () => {
    let app
    beforeAll(() => {
      app = testApp()
    })

    it('returns 200 with the config for a seeded country (AE)', async () => {
      const res = await request(app).get('/api/config/country/AE')
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.country.code).toBe('AE')
      expect(res.body.country.currency).toBe('AED')
      expect(res.body.country.paymentMethods).not.toContain('sham_cash')
    })

    it('404s an unknown country', async () => {
      const res = await request(app).get('/api/config/country/ZZ')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('COUNTRY_NOT_CONFIGURED')
    })
  })

  it('4. helpers read the configured values', () => {
    expect(disputeWindowHours('GB')).toBe(48)
    expect(strLateCancelFeeMinor('USD', 'US')).toBe(10) // feeMinorUsd for US
    expect(strLateCancelFeeMinor('GBP', 'GB')).toBe(8) // local feeMinor for GB
    expect(strLateCancelFeeMinor('USD', 'ZZ')).toBe(0) // unknown country → 0
  })
})
