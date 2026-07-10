import { db } from './prisma.mjs'
import { verifySessionToken } from './security.mjs'

export async function getAuthContext(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const session = token ? verifySessionToken(token) : null
  if (!session?.sub) return null

  const user = await db().user.findUnique({
    where: { id: session.sub },
    include: { roles: true },
  })
  if (!user || user.status !== 'ACTIVE') return null

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
