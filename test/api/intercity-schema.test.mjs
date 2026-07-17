import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'

// Smoke test for the DORMANT SR Intercity schema (023). No HTTP endpoints exist yet — this only proves the
// tables and their intra-module relations are sound and that ticketCode is globally unique. It builds a
// full Garage→Route→RouteTariff→Operator→ServiceTrip→SeatBooking chain via Prisma, reads it back through
// the relations, checks the unique constraint, then deletes everything it created (cascades handle the
// children, but we delete explicitly in FK order to be safe and self-contained).
describe('SR Intercity dormant schema (023)', () => {
  const created = { garages: [], routes: [], operators: [], trips: [], seatBookings: [], tariffs: [] }

  afterAll(async () => {
    // Child → parent order; cascades would cover most, but explicit deletes keep this test standalone.
    await db().seatBooking.deleteMany({ where: { id: { in: created.seatBookings } } }).catch(() => {})
    await db().serviceTrip.deleteMany({ where: { id: { in: created.trips } } }).catch(() => {})
    await db().routeTariff.deleteMany({ where: { id: { in: created.tariffs } } }).catch(() => {})
    await db().serviceTrip.deleteMany({ where: { routeId: { in: created.routes } } }).catch(() => {})
    await db().route.deleteMany({ where: { id: { in: created.routes } } }).catch(() => {})
    await db().operator.deleteMany({ where: { id: { in: created.operators } } }).catch(() => {})
    await db().garage.deleteMany({ where: { id: { in: created.garages } } }).catch(() => {})
  })

  it('creates and reads back a full intercity chain, and enforces ticketCode uniqueness', async () => {
    const origin = await db().garage.create({ data: { country: 'SY', city: 'Damascus', name: 'Damascus Central Garage' } })
    const dest = await db().garage.create({ data: { country: 'SY', city: 'Aleppo', name: 'Aleppo Garage' } })
    created.garages.push(origin.id, dest.id)

    const route = await db().route.create({
      data: { originGarageId: origin.id, destGarageId: dest.id, distanceKm: 355, estMinutes: 300 },
    })
    created.routes.push(route.id)

    const tariff = await db().routeTariff.create({
      data: { routeId: route.id, tier: 'economy', perSeatMinor: 15, wholeVehicleMinor: 120, currency: 'USD' },
    })
    created.tariffs.push(tariff.id)

    const operator = await db().operator.create({
      data: { name: 'Al-Shamal Bus Co', type: 'BUS_COMPANY', country: 'SY' },
    })
    created.operators.push(operator.id)

    const trip = await db().serviceTrip.create({
      data: {
        routeId: route.id,
        tier: 'economy',
        operatorId: operator.id,
        driverUserId: 'scalar-driver-id', // scalar cross-module ref (no User relation in the dormant schema)
        vehicleId: 'scalar-vehicle-id',
        capacity: 14,
        seatsAvailable: 14,
        departureMode: 'FILL_AND_GO',
        perSeatMinor: 15,
        currency: 'USD',
      },
    })
    created.trips.push(trip.id)

    const ticketCode = `TKT-${trip.id.slice(0, 8)}`
    const seat = await db().seatBooking.create({
      data: {
        serviceTripId: trip.id,
        riderUserId: 'scalar-rider-id',
        seatCount: 2,
        seatLabels: ['A1', 'A2'],
        amountMinor: 30,
        currency: 'USD',
        ticketCode,
      },
    })
    created.seatBookings.push(seat.id)

    // Read the whole chain back through the intra-module relations in one query.
    const readBack = await db().route.findUnique({
      where: { id: route.id },
      include: {
        originGarage: true,
        destGarage: true,
        tariffs: true,
        trips: { include: { operator: true, seatBookings: true } },
      },
    })
    expect(readBack.originGarage.city).toBe('Damascus')
    expect(readBack.destGarage.city).toBe('Aleppo')
    expect(readBack.tariffs).toHaveLength(1)
    expect(readBack.trips).toHaveLength(1)
    expect(readBack.trips[0].operator.name).toBe('Al-Shamal Bus Co')
    expect(readBack.trips[0].seatBookings).toHaveLength(1)
    expect(readBack.trips[0].seatBookings[0].ticketCode).toBe(ticketCode)
    expect(readBack.trips[0].seatBookings[0].seatLabels).toEqual(['A1', 'A2'])

    // ticketCode is globally unique — a duplicate must be rejected by the DB constraint.
    await expect(
      db().seatBooking.create({
        data: { serviceTripId: trip.id, riderUserId: 'scalar-rider-id-2', amountMinor: 15, currency: 'USD', ticketCode },
      }),
    ).rejects.toThrow()
  })
})
