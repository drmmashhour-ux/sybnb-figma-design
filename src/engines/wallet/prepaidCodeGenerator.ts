import {
  createPrepaidCode,
  createWalletEngineHash,
  type PrepaidCode,
  type WalletCurrency,
} from './walletEngine'

export type PrepaidCodeBatchStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED'

export type PrepaidCodeBatchPurpose =
  | 'WALLET_TOP_UP'
  | 'GIFT_CREDIT'
  | 'PROMOTION'
  | 'REFUND_CREDIT'
  | 'AGENT_STOCK'
  | 'TEST_ONLY'

export type PrepaidCodeBatch = {
  id: string
  batchReference: string
  purpose: PrepaidCodeBatchPurpose
  status: PrepaidCodeBatchStatus
  count: number
  amount: number
  currency: WalletCurrency
  createdByAdminId: string
  assignedAgentId?: string
  lockedToUserId?: string
  giftSenderUserId?: string
  giftRecipientUserId?: string
  recipientPhoneHash?: string
  giftRecipientPhoneHash?: string
  giftMessage?: string
  expiresAt?: string
  createdAt: string
}

export type GeneratedPrepaidCode = {
  prepaidCode: PrepaidCode
  plainCode: string
  batchId: string
  batchReference: string
  printLabel: string
}

export type PrepaidCodeBatchResult = {
  batch: PrepaidCodeBatch
  codes: GeneratedPrepaidCode[]
  auditSummary: {
    totalValue: number
    codeCount: number
    firstCodeLast4: string
    lastCodeLast4: string
  }
}

export type PrepaidCodeGeneratorInput = {
  count: number
  amount: number
  currency: WalletCurrency
  purpose: PrepaidCodeBatchPurpose
  createdByAdminId: string
  assignedAgentId?: string
  lockedToUserId?: string
  giftSenderUserId?: string
  giftRecipientUserId?: string
  recipientPhoneHash?: string
  giftRecipientPhoneHash?: string
  giftMessage?: string
  expiresAt?: string
  prefix?: 'SYB'
  now?: Date
  randomToken?: () => string
}

const DEFAULT_PREFIX = 'SYB'
const MAX_BATCH_SIZE = 500
const MIN_CODE_PART_LENGTH = 4
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function nowIso(now = new Date()) {
  return now.toISOString()
}

function assertBatchInput(input: PrepaidCodeGeneratorInput) {
  if (!Number.isInteger(input.count) || input.count <= 0) {
    throw new Error('Batch count must be a positive integer')
  }
  if (input.count > MAX_BATCH_SIZE) {
    throw new Error(`Batch count cannot exceed ${MAX_BATCH_SIZE}`)
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Code amount must be a positive number')
  }
  if (!input.createdByAdminId.trim()) {
    throw new Error('Missing admin id')
  }
}

function makeBatchReference(now: Date, seed: string) {
  const compactDate = now.toISOString().slice(0, 10).replace(/-/g, '')
  return `PCB-${compactDate}-${createWalletEngineHash(seed).slice(0, 6).toUpperCase()}`
}

function makeId(prefix: string, seed: string) {
  return `${prefix}-${createWalletEngineHash(seed).slice(0, 12).toUpperCase()}`
}

function makeFallbackToken(seed: string) {
  const hash = createWalletEngineHash(`${seed}-${Date.now()}-${Math.random()}`, 'SYBNB_PREPAID_GENERATOR_V1')
  return hash.toUpperCase().padEnd(12, '0').slice(0, 12)
}

function normalizeToken(token: string) {
  return token
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[01IO]/g, 'Z')
}

function tokenToCodePart(token: string, offset: number) {
  const cleaned = normalizeToken(token)
  let output = ''
  for (let index = 0; output.length < MIN_CODE_PART_LENGTH; index += 1) {
    const charCode = cleaned.charCodeAt((offset + index) % Math.max(cleaned.length, 1)) || 65
    output += CODE_ALPHABET[charCode % CODE_ALPHABET.length]
  }
  return output
}

export function createPlainPrepaidCode(
  seed: string,
  options?: {
    prefix?: 'SYB'
    randomToken?: () => string
  },
) {
  const prefix = options?.prefix ?? DEFAULT_PREFIX
  const token = options?.randomToken?.() ?? makeFallbackToken(seed)
  return [
    prefix,
    tokenToCodePart(token, 0),
    tokenToCodePart(token, 4),
    tokenToCodePart(token, 8),
  ].join('-')
}

export function generatePrepaidCodeBatch(input: PrepaidCodeGeneratorInput): PrepaidCodeBatchResult {
  assertBatchInput(input)

  const now = input.now ?? new Date()
  const timestamp = nowIso(now)
  const batchReference = makeBatchReference(now, `${input.createdByAdminId}-${input.purpose}-${timestamp}`)
  const batchId = makeId('PCBATCH', batchReference)
  const batch: PrepaidCodeBatch = {
    id: batchId,
    batchReference,
    purpose: input.purpose,
    status: 'ISSUED',
    count: input.count,
    amount: input.amount,
    currency: input.currency,
    createdByAdminId: input.createdByAdminId,
    assignedAgentId: input.assignedAgentId,
    lockedToUserId: input.lockedToUserId,
    expiresAt: input.expiresAt,
    createdAt: timestamp,
  }

  const seenCodes = new Set<string>()
  const codes: GeneratedPrepaidCode[] = []

  for (let index = 0; index < input.count; index += 1) {
    let plainCode = createPlainPrepaidCode(`${batchReference}-${index}`, {
      prefix: input.prefix ?? DEFAULT_PREFIX,
      randomToken: input.randomToken,
    })

    let collisionCounter = 0
    while (seenCodes.has(plainCode)) {
      collisionCounter += 1
      plainCode = createPlainPrepaidCode(`${batchReference}-${index}-${collisionCounter}`, {
        prefix: input.prefix ?? DEFAULT_PREFIX,
      })
    }

    seenCodes.add(plainCode)
    const prepaidCode = createPrepaidCode(
      plainCode,
      {
        amount: input.amount,
        currency: input.currency,
        createdByAdminId: input.createdByAdminId,
        assignedAgentId: input.assignedAgentId,
        lockedToUserId: input.lockedToUserId,
        giftSenderUserId: input.giftSenderUserId,
        giftRecipientUserId: input.giftRecipientUserId,
        recipientPhoneHash: input.recipientPhoneHash ?? input.giftRecipientPhoneHash,
        giftRecipientPhoneHash: input.giftRecipientPhoneHash,
        giftMessage: input.giftMessage,
        expiresAt: input.expiresAt,
      },
      now,
    )

    codes.push({
      prepaidCode,
      plainCode,
      batchId,
      batchReference,
      printLabel: `${batchReference} / ${prepaidCode.displayCodeLast4}`,
    })
  }

  return {
    batch,
    codes,
    auditSummary: {
      totalValue: input.count * input.amount,
      codeCount: input.count,
      firstCodeLast4: codes[0]?.prepaidCode.displayCodeLast4 ?? '',
      lastCodeLast4: codes[codes.length - 1]?.prepaidCode.displayCodeLast4 ?? '',
    },
  }
}

export function exportPrepaidBatchForPrinting(result: PrepaidCodeBatchResult) {
  return result.codes.map((item) => ({
    batchReference: item.batchReference,
    code: item.plainCode,
    amount: item.prepaidCode.amount,
    currency: item.prepaidCode.currency,
    expiresAt: item.prepaidCode.expiresAt ?? '',
    printLabel: item.printLabel,
  }))
}

export function exportPrepaidBatchForDatabase(result: PrepaidCodeBatchResult) {
  return {
    batch: result.batch,
    codes: result.codes.map((item) => item.prepaidCode),
  }
}
