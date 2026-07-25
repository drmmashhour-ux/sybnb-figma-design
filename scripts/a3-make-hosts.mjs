// A3.3 browser-E2E helper: provision two HOST accounts in the LOCAL test DB and print their session
// tokens so the browser E2E can inject a real seller session (localStorage) and drive the rendered
// wizard UI as an authenticated host — one WITH a phone on file (happy path) and one WITHOUT (to prove
// the phone-required notice blocks publish). Run: node --env-file=.env.test scripts/a3-make-hosts.mjs
import { db } from '../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../server/lib/security.mjs'

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run A3.3 host helper with NODE_ENV=production.')
  process.exit(1)
}

const rand = () => Math.random().toString(36).slice(2, 10)

async function makeHost(withPhone) {
  const suffix = rand()
  const u = await db().user.create({
    data: {
      email: `a3-wiz-${withPhone ? 'phone' : 'nophone'}-${suffix}@sybnb.test`,
      passwordHash: hashPassword('correct-horse-battery'),
      displayName: `A3 Wizard Host ${suffix}`,
      referralCode: `A3W-${suffix.toUpperCase()}`,
      status: 'ACTIVE',
      isDemo: false,
      roles: { create: { role: 'HOST' } },
      ...(withPhone ? { phoneHash: `a3-phone-${suffix}` } : {}),
    },
    include: { roles: true },
  })
  const token = createSessionToken(u)
  return { token, user: { id: u.id, email: u.email, displayName: u.displayName, roles: u.roles.map((r) => ({ role: r.role })) } }
}

async function main() {
  const withPhone = await makeHost(true)
  const noPhone = await makeHost(false)
  console.log(JSON.stringify({ withPhone, noPhone }))
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message || e)
    process.exit(1)
  })
