// Reviewer demo accounts (024) — store-readiness. App Store / Play reviewers must be able to get past the
// login screen without uploading real ID, so this seeds a PRE-VERIFIED demo customer and demo driver (and a
// demo host with a listing) they can sign into. Idempotent (keyed by fixed emails), so it can be re-run at
// every deploy. The password comes from DEMO_ACCOUNT_PASSWORD so it is never committed. These accounts carry
// NO admin role and are flagged isDemo.
import { db } from '../server/lib/prisma.mjs'
import { hashPassword } from '../server/lib/security.mjs'

export const DEMO_CUSTOMER_EMAIL = 'demo-customer@sybnb.app'
export const DEMO_DRIVER_EMAIL = 'demo-driver@sybnb.app'
export const DEMO_HOST_EMAIL = 'demo-host@sybnb.app'
export const DEMO_QA_EMAIL = 'qa@sybnb.app'

async function upsertDemoUser({ email, displayName, referralCode, roles, passwordHash, partnerType = null }) {
  const existing = await db().user.findUnique({ where: { email }, include: { roles: true } })
  if (existing) {
    // Re-run: refresh password + verification, guarantee exactly the intended (non-admin) roles.
    await db().userRole.deleteMany({ where: { userId: existing.id } })
    return db().user.update({
      where: { id: existing.id },
      data: {
        displayName,
        passwordHash,
        status: 'ACTIVE',
        isDemo: true,
        partnerType,
        idDocumentStatus: 'APPROVED',
        idDocumentSubmittedAt: new Date(),
        roles: { create: roles.map((role) => ({ role })) },
      },
      include: { roles: true },
    })
  }
  return db().user.create({
    data: {
      email,
      displayName,
      passwordHash,
      referralCode,
      status: 'ACTIVE',
      isDemo: true,
      partnerType,
      idDocumentStatus: 'APPROVED',
      idDocumentSubmittedAt: new Date(),
      roles: { create: roles.map((role) => ({ role })) },
    },
    include: { roles: true },
  })
}

export async function seedDemoAccounts({ password }) {
  if (!password || String(password).length < 8) {
    throw new Error('DEMO_ACCOUNT_PASSWORD must be set to at least 8 characters.')
  }
  const passwordHash = hashPassword(String(password))

  const customer = await upsertDemoUser({ email: DEMO_CUSTOMER_EMAIL, displayName: 'Demo Customer', referralCode: 'DEMOCUST1', roles: ['GUEST'], passwordHash })

  const driver = await upsertDemoUser({ email: DEMO_DRIVER_EMAIL, displayName: 'Demo Driver', referralCode: 'DEMODRIV1', roles: ['DRIVER', 'GUEST'], passwordHash })
  // Make the driver fully road-ready so the reviewer sees the whole SR flow: verified ID + APPROVED license
  // and vehicle registration + an APPROVED vehicle record.
  await db().driverProfile.upsert({
    where: { userId: driver.id },
    create: { userId: driver.id, active: true, vehicleMake: 'Toyota', vehicleModel: 'Corolla', vehiclePlate: 'DEMO-001' },
    update: { active: true },
  })
  for (const type of ['LICENSE', 'VEHICLE_REGISTRATION']) {
    await db().driverDocument.upsert({
      where: { driverUserId_type: { driverUserId: driver.id, type } },
      create: { driverUserId: driver.id, type, assetUrl: `demo-${type}.pdf`, status: 'APPROVED' },
      update: { status: 'APPROVED' },
    })
  }
  const hasVehicle = await db().driverVehicle.findFirst({ where: { driverId: driver.id, plate: 'DEMO-001' } })
  if (!hasVehicle) {
    await db().driverVehicle.create({
      data: { driverId: driver.id, make: 'Toyota', model: 'Corolla', year: 2022, plate: 'DEMO-001', color: 'White', category: 'SR Economy', status: 'APPROVED' },
    })
  }

  const host = await upsertDemoUser({ email: DEMO_HOST_EMAIL, displayName: 'Demo Host', referralCode: 'DEMOHOST1', roles: ['HOST', 'GUEST'], passwordHash })
  const hasListing = await db().listing.findFirst({ where: { ownerId: host.id } })
  if (!hasListing) {
    await db().listing.create({
      data: { ownerId: host.id, division: 'STAYS', status: 'APPROVED', titleAr: 'شقة تجريبية للمراجعة', titleEn: 'Reviewer Demo Apartment', description: 'A demo stay for store review.', priceMinor: 40, currency: 'USD', instantBookEnabled: true },
    })
  }

  // One Preview-only convenience identity for broad manual QA. It deliberately has no ADMIN role;
  // the role-specific accounts above remain the source of truth for authorization testing.
  const qa = await upsertDemoUser({
    email: DEMO_QA_EMAIL,
    displayName: 'SYBNB QA',
    referralCode: 'SYBNBQA01',
    roles: ['GUEST', 'HOST', 'DRIVER'],
    passwordHash,
    partnerType: 'SELLER',
  })
  await db().driverProfile.upsert({
    where: { userId: qa.id },
    create: { userId: qa.id, active: true, vehicleMake: 'Toyota', vehicleModel: 'Corolla', vehiclePlate: 'QA-001' },
    update: { active: true },
  })
  for (const type of ['LICENSE', 'VEHICLE_REGISTRATION']) {
    await db().driverDocument.upsert({
      where: { driverUserId_type: { driverUserId: qa.id, type } },
      create: { driverUserId: qa.id, type, assetUrl: `qa-${type}.pdf`, status: 'APPROVED' },
      update: { status: 'APPROVED' },
    })
  }
  const qaVehicle = await db().driverVehicle.findFirst({ where: { driverId: qa.id, plate: 'QA-001' } })
  if (!qaVehicle) {
    await db().driverVehicle.create({
      data: { driverId: qa.id, make: 'Toyota', model: 'Corolla', year: 2022, plate: 'QA-001', color: 'White', category: 'SR Economy', status: 'APPROVED' },
    })
  }
  const qaListing = await db().listing.findFirst({ where: { ownerId: qa.id } })
  if (!qaListing) {
    await db().listing.create({
      data: { ownerId: qa.id, division: 'STAYS', status: 'APPROVED', titleAr: 'إقامة اختبار SYBNB', titleEn: 'SYBNB QA Stay', description: 'Preview-only QA listing.', priceMinor: 40, currency: 'USD', instantBookEnabled: true },
    })
  }

  return { customerId: customer.id, driverId: driver.id, hostId: host.id, qaId: qa.id }
}

// CLI entrypoint: `DEMO_ACCOUNT_PASSWORD=... node scripts/seed-demo-accounts.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemoAccounts({ password: process.env.DEMO_ACCOUNT_PASSWORD })
    .then((ids) => {
      console.log('Demo accounts seeded:', JSON.stringify(ids))
      console.log(`  customer: ${DEMO_CUSTOMER_EMAIL}`)
      console.log(`  driver:   ${DEMO_DRIVER_EMAIL}`)
      console.log(`  host:     ${DEMO_HOST_EMAIL}`)
      console.log(`  qa:       ${DEMO_QA_EMAIL}`)
      process.exit(0)
    })
    .catch((err) => {
      console.error('Demo seed failed:', err.message)
      process.exit(1)
    })
}
