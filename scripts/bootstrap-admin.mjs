// One-time ADMIN bootstrap. The control center can only CREATE staff when an ADMIN is already
// signed in (POST /api/admin/staff requires role ADMIN), and no seed creates one — a chicken-and-egg
// gap that leaves the whole "host lists -> admin approves -> goes live" chain stuck at step one.
// This script inserts (or upgrades) the FIRST admin directly. Idempotent, keyed by email.
//
// Run against the target database (its DATABASE_URL must be in the environment):
//   ADMIN_EMAIL=info@sybnb.app ADMIN_PASSWORD='<min 8 chars>' ADMIN_NAME='SYBNB Admin' \
//     node --env-file=.env scripts/bootstrap-admin.mjs
//
// The password is read from the environment and never committed. After running, sign in at the
// Partner/Admin gate with this email + password (email OTP applies once a mail provider is set).
import { db } from '../server/lib/prisma.mjs'
import { hashPassword } from '../server/lib/security.mjs'

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD || ''
const displayName = process.env.ADMIN_NAME || 'SYBNB Admin'

async function main() {
  // Safe to run on every deploy: with no ADMIN_EMAIL/ADMIN_PASSWORD it simply skips (exit 0), so it
  // never blocks a build. Set both env vars in Vercel and the first admin is created on next deploy.
  if (!email || !email.includes('@') || String(password).length < 8) {
    console.log('bootstrap-admin: skipped — set ADMIN_EMAIL (valid email) + ADMIN_PASSWORD (8+ chars) to create the first admin.')
    return
  }

  const passwordHash = hashPassword(String(password))
  const roles = ['ADMIN', 'GUEST'] // GUEST lets the same person also browse as a normal user.
  const base = {
    displayName,
    passwordHash,
    status: 'ACTIVE',
    idDocumentStatus: 'APPROVED',
    idDocumentSubmittedAt: new Date(),
  }

  const existing = await db().user.findUnique({ where: { email }, include: { roles: true } })
  if (existing) {
    await db().userRole.deleteMany({ where: { userId: existing.id } })
    const updated = await db().user.update({
      where: { id: existing.id },
      data: { ...base, roles: { create: roles.map((role) => ({ role })) } },
      include: { roles: true },
    })
    console.log('Upgraded existing user to ADMIN:', updated.email, '->', updated.roles.map((r) => r.role).join(', '))
    return
  }

  const created = await db().user.create({
    data: {
      email,
      referralCode: 'ADMIN' + Math.random().toString(36).slice(2, 7).toUpperCase(),
      ...base,
      roles: { create: roles.map((role) => ({ role })) },
    },
    include: { roles: true },
  })
  console.log('Created ADMIN:', created.email, '->', created.roles.map((r) => r.role).join(', '))
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('bootstrap-admin failed:', error?.message || error)
    process.exit(1)
  })
