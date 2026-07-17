import { db } from './prisma.mjs'

// UGC-safety blocks (024). A block is stored directionally (blocker → blocked) but ENFORCED symmetrically:
// once either user blocks the other, the pair can neither be SR-matched nor message each other, no matter
// who blocked whom. Both enforcement points (SR matching, messaging) go through here.
export async function isPairBlocked(client, userA, userB) {
  if (!userA || !userB || userA === userB) return false
  const block = await client.userBlock.findFirst({
    where: {
      OR: [
        { blockerUserId: userA, blockedUserId: userB },
        { blockerUserId: userB, blockedUserId: userA },
      ],
    },
    select: { id: true },
  })
  return Boolean(block)
}

export async function assertNotBlockedPair(client, userA, userB, { code = 'USER_BLOCK_ACTIVE', message = 'You cannot interact with this user because of a block.', statusCode = 409 } = {}) {
  if (await isPairBlocked(client, userA, userB)) {
    const error = new Error(message)
    error.statusCode = statusCode
    error.code = code
    error.expose = true
    throw error
  }
}
