import { db } from './prisma.mjs'

export async function createStayListingWithPlan(userId, listingData) {
  return db().$transaction(async (tx) => {
    // Serialize every plan consumption for one host. The unique FK remains the final database guard,
    // while this lock gives the losing concurrent request a stable product error instead of P2002.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`str-plan-consume:${userId}`}))`
    const plan = await tx.paymentProof.findFirst({
      where: {
        userId, provider: 'str_host_plan', status: 'APPROVED', strPlanConsumption: null,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (!plan) {
      const error = new Error('An unused approved STR host plan is required for each stay listing.')
      error.statusCode = 403
      error.code = 'STR_HOST_PLAN_REQUIRED'
      error.expose = true
      throw error
    }
    const listing = await tx.listing.create({ data: { ...listingData, ownerId: userId, division: 'STAYS' } })
    await tx.strPlanConsumption.create({ data: { listingId: listing.id, proofId: plan.id } })
    return listing
  })
}
