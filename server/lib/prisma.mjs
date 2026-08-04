import { PrismaClient } from '@prisma/client'
import { assertTestDatabaseSafe } from './test-db-guard.mjs'

let prisma

// When NODE_ENV=test, verify the test-database safety guard before ever constructing a
// PrismaClient — this is the single real connection choke-point for the whole app, so it is the
// most reliable place to enforce that a test run can never open a connection to the development
// database. No-op (and zero added cost) for every non-test environment.
// Neon's POOLED endpoint runs pgbouncer in transaction mode, which does not keep server-side named
// prepared statements. Prisma uses them by default, so on a `-pooler` URL that lacks `pgbouncer=true`
// every findMany/groupBy fails with P2010 (prepared-statement conflict) even though a plain `SELECT 1`
// works. Append the flag defensively so a pooled DATABASE_URL "just works" regardless of the exact string.
function resolveDatabaseUrl() {
  const raw = process.env.DATABASE_URL || ''
  if (!raw.includes('-pooler')) return raw
  // Normalize a Neon POOLED (pgbouncer) URL for Prisma: pgbouncer transaction mode keeps no server-side
  // named prepared statements and doesn't support SCRAM channel binding, so without this every
  // findMany/groupBy fails with P2010 even though `SELECT 1` works.
  try {
    const u = new URL(raw)
    u.searchParams.delete('channel_binding') // unsupported through pgbouncer
    u.searchParams.set('pgbouncer', 'true') // Prisma: disable prepared statements on the pooler
    if (!u.searchParams.has('connect_timeout')) u.searchParams.set('connect_timeout', '15')
    return u.toString()
  } catch {
    return raw
  }
}

export function db() {
  if (!prisma) {
    if (process.env.NODE_ENV === 'test') {
      assertTestDatabaseSafe()
    }
    const url = resolveDatabaseUrl()
    prisma = url && url !== process.env.DATABASE_URL ? new PrismaClient({ datasourceUrl: url }) : new PrismaClient()
  }
  return prisma
}

export async function disconnectDb() {
  if (prisma) {
    await prisma.$disconnect()
    prisma = undefined
  }
}

export async function checkDatabase() {
  await db().$queryRaw`SELECT 1`
  return true
}
