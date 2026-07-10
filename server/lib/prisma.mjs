import { PrismaClient } from '@prisma/client'

let prisma

export function db() {
  if (!prisma) {
    prisma = new PrismaClient()
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
