import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { testApp } from '../support/testServer.mjs'

// The public listings feed's `legalReviewStatus` must be config-driven and fail-closed: it reads the
// JurisdictionComplianceProfile(STR, country, '') that admins set (audit-gated), NOT a hardcoded literal.
// APPROVED → 'reviewed'; missing / PENDING / BLOCKED → 'unreviewed'. So counsel-clearance is an admin
// config action (approve the profile) that auto-flips the guest signal — never a code deploy.

const S = String(Date.now()).slice(-6)

describe('legalReviewStatus reflects the JurisdictionComplianceProfile (config-driven, fail-closed)', () => {
  let app
  const codes = []

  async function profileFor(status) {
    const country = `Z${status[0]}${S}` // unique throwaway jurisdiction per status
    await db().jurisdictionComplianceProfile.create({ data: { division: 'STR', countryCode: country, regionCode: '', status } })
    codes.push(country)
    return country
  }
  async function feedStatus(country) {
    const res = await request(app).get(`/api/listings?country=${country}`)
    expect(res.status).toBe(200)
    return res.body.legalReviewStatus
  }

  beforeAll(() => {
    app = testApp()
  })
  afterAll(async () => {
    await db().jurisdictionComplianceProfile.deleteMany({ where: { countryCode: { in: codes } } }).catch(() => {})
  })

  it('APPROVED profile → reviewed (the guest signal flips when counsel clears + admin approves)', async () => {
    const country = await profileFor('APPROVED')
    expect(await feedStatus(country)).toBe('reviewed')
  })

  it('PENDING profile → unreviewed (fail-closed)', async () => {
    const country = await profileFor('PENDING')
    expect(await feedStatus(country)).toBe('unreviewed')
  })

  it('BLOCKED profile → unreviewed (fail-closed)', async () => {
    const country = await profileFor('BLOCKED')
    expect(await feedStatus(country)).toBe('unreviewed')
  })

  it('missing profile → unreviewed (a never-reviewed market is never implicitly live)', async () => {
    expect(await feedStatus(`ZX${S}`)).toBe('unreviewed')
  })
})
