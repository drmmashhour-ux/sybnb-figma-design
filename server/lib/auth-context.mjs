import { db } from './prisma.mjs'
import { verifySessionToken } from './security.mjs'
import { assertJurisdictionApproved, resolveDriverJurisdiction } from './jurisdiction-compliance.mjs'
import { assertDriverGstQstRegisteredForQuebec } from './tax-profile.mjs'

export async function getAuthContext(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const session = token ? verifySessionToken(token) : null
  if (!session?.sub) return null

  // A validly-signed token can only carry a malformed subject if AUTH_SECRET was ever weaker or
  // compromised, or the user id format changes in the future — treat that the same as "no such
  // user" (fail closed to 401) instead of letting Prisma's UUID-parse error (P2023) surface as an
  // unhandled 500.
  let user
  try {
    user = await db().user.findUnique({
      where: { id: session.sub },
      include: { roles: true },
    })
  } catch (error) {
    if (error?.code === 'P2023') return null
    throw error
  }
  if (!user || user.status !== 'ACTIVE') return null

  // Revocation check (F-02): a stateless signed token has no server-side record of its own, so
  // "logging out" or resetting a password can't delete it -- instead those actions bump
  // user.sessionVersion, and any token minted before that bump (recorded as its `sv` claim at
  // issuance) is treated as expired even though its signature and `exp` are still valid.
  const tokenVersion = Number.isInteger(session.sv) ? session.sv : 0
  if (tokenVersion !== user.sessionVersion) return null

  return {
    user,
    roles: user.roles.map((item) => item.role),
  }
}

export function requireAuth(context, roles = []) {
  if (!context?.user) {
    const error = new Error('Authentication required.')
    error.statusCode = 401
    error.code = 'AUTH_REQUIRED'
    error.expose = true
    throw error
  }

  if (roles.length > 0 && !roles.some((role) => context.roles.includes(role))) {
    const error = new Error('This account does not have permission for this V6 action.')
    error.statusCode = 403
    error.code = 'FORBIDDEN'
    error.expose = true
    throw error
  }
}

// SECURITY (SR verified-only): a DRIVER may only see the ride pool, claim, or work a ride once their ID
// document has been ADMIN-approved. DRIVER is a public self-register role, so role alone is not enough —
// without this gate an unverified/ID-rejected stranger could be matched to real riders.
export function requireVerifiedDriver(context) {
  requireAuth(context, ['DRIVER'])
  if (context.user.idDocumentStatus !== 'APPROVED') {
    const error = new Error('Your driver account must be verified by SYBNB before you can go online or accept rides.')
    error.statusCode = 403
    error.code = 'DRIVER_NOT_VERIFIED'
    error.expose = true
    throw error
  }
}

// SECURITY (SR road-ready, 015): claiming or working a ride requires the full vetting stack, not just an
// ID. Layered on top of requireVerifiedDriver so the two stay composable — a driver may only be matched to
// a real rider once their ID *and* license *and* vehicle registration are all APPROVED.
export async function requireRoadReadyDriver(context) {
  requireVerifiedDriver(context)
  // Jurisdiction gate (026): this re-checks on every claim/work action (not only at document-approval
  // time), so an admin pausing SR in a market via the jurisdiction panel takes effect immediately for
  // every driver already approved there — no need to individually re-review each driver's documents.
  await assertJurisdictionApproved(db(), resolveDriverJurisdiction(), { subject: 'Ride-hailing in this market' })
  const approved = await db().driverDocument.findMany({
    where: {
      driverUserId: context.user.id,
      status: 'APPROVED',
      type: { in: ['LICENSE', 'VEHICLE_REGISTRATION'] },
    },
    select: { type: true },
  })
  const approvedTypes = new Set(approved.map((doc) => doc.type))
  if (!approvedTypes.has('LICENSE') || !approvedTypes.has('VEHICLE_REGISTRATION')) {
    const error = new Error('Your license and vehicle registration must be approved by SYBNB before you can accept rides.')
    error.statusCode = 403
    error.code = 'DRIVER_NOT_ROAD_READY'
    error.expose = true
    throw error
  }
  // Tax-compliance foundation (029): Revenu Québec requires a rideshare driver to be GST/QST
  // registered before their first paid Quebec ride. A no-op for every driver today (Quebec SR isn't
  // live -- see resolveDriverJurisdiction above), real the moment one is.
  await assertDriverGstQstRegisteredForQuebec(db(), context.user.id)
}
