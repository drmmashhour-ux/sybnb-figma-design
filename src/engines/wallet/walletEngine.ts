export type WalletCurrency = 'SYP' | 'USD' | 'EUR'

export type WalletStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED'

export type WalletLedgerType =
  | 'CREDIT_PREPAID_CODE'
  | 'CREDIT_AGENT_CASH'
  | 'CREDIT_STRIPE_TOPUP'
  | 'CREDIT_QR_MANUAL'
  | 'DEBIT_BOOKING'
  | 'CREDIT_REFUND'
  | 'DEBIT_ADJUSTMENT'
  | 'CREDIT_ADJUSTMENT'

export type WalletReferenceType =
  | 'PREPAID_CODE'
  | 'AGENT_TOP_UP'
  | 'STRIPE_PAYMENT_INTENT'
  | 'QR_MANUAL_PAYMENT'
  | 'BOOKING'
  | 'REFUND'
  | 'ADMIN_ADJUSTMENT'

export type PrepaidCodeStatus = 'UNUSED' | 'REDEEMED' | 'EXPIRED' | 'BLOCKED' | 'CANCELLED'

export type AgentStatus = 'ACTIVE' | 'SUSPENDED' | 'UNDER_REVIEW' | 'TERMINATED'

export type ReviewStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'

export type WalletAuditAction =
  | 'WALLET_CREATED'
  | 'WALLET_FROZEN'
  | 'WALLET_UNFROZEN'
  | 'WALLET_CLOSED'
  | 'LEDGER_CREDITED'
  | 'LEDGER_DEBITED'
  | 'PREPAID_CODE_CREATED'
  | 'PREPAID_CODE_REDEEMED'
  | 'PREPAID_CODE_BLOCKED'
  | 'TOP_UP_APPROVED'
  | 'TOP_UP_REJECTED'

export type Wallet = {
  id: string
  userId: string
  currency: WalletCurrency
  balance: number
  status: WalletStatus
  createdAt: string
  updatedAt: string
}

export type WalletLedgerEntry = {
  id: string
  walletId: string
  userId: string
  type: WalletLedgerType
  amount: number
  currency: WalletCurrency
  balanceAfter: number
  referenceType: WalletReferenceType
  referenceId: string
  adminNote?: string
  createdAt: string
}

export type PrepaidCode = {
  id: string
  codeHash: string
  displayCodeLast4: string
  amount: number
  currency: WalletCurrency
  status: PrepaidCodeStatus
  assignedAgentId?: string
  lockedToUserId?: string
  giftSenderUserId?: string
  giftRecipientUserId?: string
  recipientPhoneHash?: string
  giftRecipientPhoneHash?: string
  giftMessage?: string
  redeemedByUserId?: string
  redeemedAt?: string
  expiresAt?: string
  createdByAdminId: string
  createdAt: string
}

export type Agent = {
  id: string
  name: string
  phone: string
  city: string
  status: AgentStatus
  commissionRate?: number
  createdAt: string
}

export type AgentTopUpRequest = {
  id: string
  agentId: string
  userId: string
  amount: number
  currency: WalletCurrency
  cashReceived: boolean
  status: ReviewStatus
  proofUrl?: string
  adminNote?: string
  createdAt: string
  reviewedAt?: string
}

export type WalletAuditLogEntry = {
  id: string
  actorId: string
  action: WalletAuditAction
  targetType: 'WALLET' | 'LEDGER_ENTRY' | 'PREPAID_CODE' | 'AGENT_TOP_UP'
  targetId: string
  note?: string
  createdAt: string
}

export type WalletOperationResult = {
  wallet: Wallet
  ledgerEntry: WalletLedgerEntry
  auditLog: WalletAuditLogEntry
}

export type WalletValidationResult = {
  ok: boolean
  errors: string[]
  warnings: string[]
}

export type RedeemPrepaidCodeResult = WalletOperationResult & {
  prepaidCode: PrepaidCode
}

export type TopUpReviewResult = WalletOperationResult & {
  topUpRequest: AgentTopUpRequest
}

const CODE_PATTERN = /^SYB-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{7,18}$/

function nowIso(now = new Date()) {
  return now.toISOString()
}

function makeId(prefix: string, seed = `${Date.now()}-${Math.random()}`) {
  return `${prefix}-${createWalletEngineHash(seed).slice(0, 12).toUpperCase()}`
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, '')
}

function assertPositiveAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be a positive number')
  }
}

function assertSameCurrency(wallet: Wallet, currency: WalletCurrency) {
  if (wallet.currency !== currency) {
    throw new Error(`Wallet currency mismatch: expected ${wallet.currency}, got ${currency}`)
  }
}

function assertWalletCanMoveMoney(wallet: Wallet) {
  if (wallet.status === 'FROZEN') {
    throw new Error('Wallet is frozen')
  }
  if (wallet.status === 'CLOSED') {
    throw new Error('Wallet is closed')
  }
}

export function createWalletEngineHash(input: string, salt = 'SYBNB_WALLET_ENGINE_V1') {
  // Prototype-only deterministic hash. Production should use server-side HMAC or a slow password hash for prepaid codes.
  const payload = `${salt}|${input}`
  let hash = 0x811c9dc5
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function createPrepaidCodeHash(plainCode: string) {
  return createWalletEngineHash(normalizeCode(plainCode), 'SYBNB_PREPAID_CODE_HASH_V1')
}

export function getPrepaidCodeLast4(plainCode: string) {
  return normalizeCode(plainCode).slice(-4)
}

export function validatePrepaidCodeFormat(plainCode: string): WalletValidationResult {
  const normalized = normalizeCode(plainCode)
  const errors: string[] = []
  if (!CODE_PATTERN.test(normalized)) errors.push('invalid_prepaid_code_format')
  return { ok: errors.length === 0, errors, warnings: [] }
}

export function validateAgent(agent: Pick<Agent, 'name' | 'phone' | 'city' | 'commissionRate'>): WalletValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (!agent.name.trim()) errors.push('missing_agent_name')
  if (!PHONE_PATTERN.test(agent.phone.trim())) errors.push('invalid_agent_phone')
  if (!agent.city.trim()) errors.push('missing_agent_city')
  if (agent.commissionRate && (agent.commissionRate < 0 || agent.commissionRate > 0.2)) {
    warnings.push('agent_commission_rate_outside_recommended_range')
  }
  return { ok: errors.length === 0, errors, warnings }
}

export function createWallet(userId: string, currency: WalletCurrency, now = new Date()): Wallet {
  if (!userId.trim()) throw new Error('Missing userId')
  const timestamp = nowIso(now)
  return {
    id: makeId('WALLET', `${userId}-${currency}-${timestamp}`),
    userId,
    currency,
    balance: 0,
    status: 'ACTIVE',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createAuditLog(
  actorId: string,
  action: WalletAuditAction,
  targetType: WalletAuditLogEntry['targetType'],
  targetId: string,
  note?: string,
  now = new Date(),
): WalletAuditLogEntry {
  if (!actorId.trim()) throw new Error('Missing audit actor')
  return {
    id: makeId('WAUD', `${actorId}-${action}-${targetId}-${nowIso(now)}`),
    actorId,
    action,
    targetType,
    targetId,
    note,
    createdAt: nowIso(now),
  }
}

export function createLedgerEntry(
  wallet: Wallet,
  input: Pick<WalletLedgerEntry, 'type' | 'amount' | 'referenceType' | 'referenceId'> &
    Partial<Pick<WalletLedgerEntry, 'adminNote'>>,
  now = new Date(),
): { wallet: Wallet; ledgerEntry: WalletLedgerEntry } {
  assertPositiveAmount(input.amount)
  assertWalletCanMoveMoney(wallet)

  const isDebit = input.type.startsWith('DEBIT_')
  const nextBalance = isDebit ? wallet.balance - input.amount : wallet.balance + input.amount
  if (nextBalance < 0) throw new Error('Insufficient wallet balance')

  const updatedWallet: Wallet = {
    ...wallet,
    balance: nextBalance,
    updatedAt: nowIso(now),
  }

  return {
    wallet: updatedWallet,
    ledgerEntry: {
      id: makeId('WLED', `${wallet.id}-${input.type}-${input.referenceId}-${nowIso(now)}`),
      walletId: wallet.id,
      userId: wallet.userId,
      type: input.type,
      amount: input.amount,
      currency: wallet.currency,
      balanceAfter: nextBalance,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      adminNote: input.adminNote,
      createdAt: nowIso(now),
    },
  }
}

export function creditWallet(
  wallet: Wallet,
  actorId: string,
  input: Pick<WalletLedgerEntry, 'type' | 'amount' | 'referenceType' | 'referenceId'> &
    Partial<Pick<WalletLedgerEntry, 'adminNote'>>,
  now = new Date(),
): WalletOperationResult {
  if (!input.type.startsWith('CREDIT_')) throw new Error('creditWallet requires CREDIT_* ledger type')
  const result = createLedgerEntry(wallet, input, now)
  return {
    ...result,
    auditLog: createAuditLog(actorId, 'LEDGER_CREDITED', 'LEDGER_ENTRY', result.ledgerEntry.id, input.adminNote, now),
  }
}

export function debitWallet(
  wallet: Wallet,
  actorId: string,
  input: Pick<WalletLedgerEntry, 'type' | 'amount' | 'referenceType' | 'referenceId'> &
    Partial<Pick<WalletLedgerEntry, 'adminNote'>>,
  now = new Date(),
): WalletOperationResult {
  if (!input.type.startsWith('DEBIT_')) throw new Error('debitWallet requires DEBIT_* ledger type')
  const result = createLedgerEntry(wallet, input, now)
  return {
    ...result,
    auditLog: createAuditLog(actorId, 'LEDGER_DEBITED', 'LEDGER_ENTRY', result.ledgerEntry.id, input.adminNote, now),
  }
}

export function payBookingFromWallet(wallet: Wallet, bookingId: string, amount: number, now = new Date()) {
  if (!bookingId.trim()) throw new Error('Missing bookingId')
  return debitWallet(
    wallet,
    wallet.userId,
    {
      type: 'DEBIT_BOOKING',
      amount,
      referenceType: 'BOOKING',
      referenceId: bookingId,
    },
    now,
  )
}

export function createPrepaidCode(
  plainCode: string,
  input: Pick<PrepaidCode, 'amount' | 'currency' | 'createdByAdminId'> &
    Partial<
      Pick<
        PrepaidCode,
        | 'assignedAgentId'
        | 'lockedToUserId'
        | 'giftSenderUserId'
        | 'giftRecipientUserId'
        | 'recipientPhoneHash'
        | 'giftRecipientPhoneHash'
        | 'giftMessage'
        | 'expiresAt'
      >
    >,
  now = new Date(),
): PrepaidCode {
  const validation = validatePrepaidCodeFormat(plainCode)
  if (!validation.ok) throw new Error(`Invalid prepaid code: ${validation.errors.join(',')}`)
  assertPositiveAmount(input.amount)
  if (!input.createdByAdminId.trim()) throw new Error('Missing admin id')
  return {
    id: makeId('PCODE', `${plainCode}-${input.amount}-${input.currency}-${nowIso(now)}`),
    codeHash: createPrepaidCodeHash(plainCode),
    displayCodeLast4: getPrepaidCodeLast4(plainCode),
    amount: input.amount,
    currency: input.currency,
    status: 'UNUSED',
    assignedAgentId: input.assignedAgentId,
    lockedToUserId: input.lockedToUserId,
    giftSenderUserId: input.giftSenderUserId,
    giftRecipientUserId: input.giftRecipientUserId,
    recipientPhoneHash: input.recipientPhoneHash ?? input.giftRecipientPhoneHash,
    giftRecipientPhoneHash: input.giftRecipientPhoneHash,
    giftMessage: input.giftMessage,
    expiresAt: input.expiresAt,
    createdByAdminId: input.createdByAdminId,
    createdAt: nowIso(now),
  }
}

export function redeemPrepaidCode(
  wallet: Wallet,
  prepaidCode: PrepaidCode,
  plainCode: string,
  optionsOrNow: Date | { redeemerPhoneHash?: string; now?: Date } = new Date(),
): RedeemPrepaidCodeResult {
  const now = optionsOrNow instanceof Date ? optionsOrNow : optionsOrNow.now ?? new Date()
  const redeemerPhoneHash = optionsOrNow instanceof Date ? undefined : optionsOrNow.redeemerPhoneHash
  assertWalletCanMoveMoney(wallet)
  assertSameCurrency(wallet, prepaidCode.currency)
  if (prepaidCode.status !== 'UNUSED') throw new Error(`Prepaid code cannot be redeemed: ${prepaidCode.status}`)
  if (prepaidCode.lockedToUserId && prepaidCode.lockedToUserId !== wallet.userId) {
    throw new Error('Prepaid code is locked to another wallet user')
  }
  if (prepaidCode.giftRecipientUserId && prepaidCode.giftRecipientUserId !== wallet.userId) {
    throw new Error('Gift code is locked to another recipient')
  }
  const expectedRecipientPhoneHash = prepaidCode.recipientPhoneHash ?? prepaidCode.giftRecipientPhoneHash
  if (expectedRecipientPhoneHash && expectedRecipientPhoneHash !== redeemerPhoneHash) {
    throw new Error('Gift code requires the recipient phone to match')
  }
  if (prepaidCode.expiresAt && new Date(prepaidCode.expiresAt).getTime() < now.getTime()) {
    throw new Error('Prepaid code expired')
  }
  if (createPrepaidCodeHash(plainCode) !== prepaidCode.codeHash) {
    throw new Error('Prepaid code hash mismatch')
  }

  const credited = creditWallet(
    wallet,
    wallet.userId,
    {
      type: 'CREDIT_PREPAID_CODE',
      amount: prepaidCode.amount,
      referenceType: 'PREPAID_CODE',
      referenceId: prepaidCode.id,
    },
    now,
  )

  return {
    ...credited,
    prepaidCode: {
      ...prepaidCode,
      status: 'REDEEMED',
      redeemedByUserId: wallet.userId,
      redeemedAt: nowIso(now),
    },
    auditLog: createAuditLog(wallet.userId, 'PREPAID_CODE_REDEEMED', 'PREPAID_CODE', prepaidCode.id, undefined, now),
  }
}

export function blockPrepaidCode(
  prepaidCode: PrepaidCode,
  adminId: string,
  note: string,
  now = new Date(),
): { prepaidCode: PrepaidCode; auditLog: WalletAuditLogEntry } {
  if (prepaidCode.status === 'REDEEMED') throw new Error('Cannot block redeemed prepaid code')
  return {
    prepaidCode: { ...prepaidCode, status: 'BLOCKED' },
    auditLog: createAuditLog(adminId, 'PREPAID_CODE_BLOCKED', 'PREPAID_CODE', prepaidCode.id, note, now),
  }
}

export function approveAgentTopUp(
  wallet: Wallet,
  request: AgentTopUpRequest,
  adminId: string,
  adminNote?: string,
  now = new Date(),
): TopUpReviewResult {
  if (request.status !== 'PENDING_REVIEW') throw new Error('Top-up request is not pending')
  if (!request.cashReceived) throw new Error('Cash receipt must be confirmed before approval')
  assertSameCurrency(wallet, request.currency)
  const credited = creditWallet(
    wallet,
    adminId,
    {
      type: 'CREDIT_AGENT_CASH',
      amount: request.amount,
      referenceType: 'AGENT_TOP_UP',
      referenceId: request.id,
      adminNote,
    },
    now,
  )
  return {
    ...credited,
    topUpRequest: {
      ...request,
      status: 'APPROVED',
      adminNote,
      reviewedAt: nowIso(now),
    },
    auditLog: createAuditLog(adminId, 'TOP_UP_APPROVED', 'AGENT_TOP_UP', request.id, adminNote, now),
  }
}

export function rejectAgentTopUp(
  request: AgentTopUpRequest,
  adminId: string,
  adminNote: string,
  now = new Date(),
): { topUpRequest: AgentTopUpRequest; auditLog: WalletAuditLogEntry } {
  if (request.status !== 'PENDING_REVIEW') throw new Error('Top-up request is not pending')
  return {
    topUpRequest: {
      ...request,
      status: 'REJECTED',
      adminNote,
      reviewedAt: nowIso(now),
    },
    auditLog: createAuditLog(adminId, 'TOP_UP_REJECTED', 'AGENT_TOP_UP', request.id, adminNote, now),
  }
}

export function freezeWallet(wallet: Wallet, adminId: string, note: string, now = new Date()) {
  const frozenWallet: Wallet = { ...wallet, status: 'FROZEN', updatedAt: nowIso(now) }
  return {
    wallet: frozenWallet,
    auditLog: createAuditLog(adminId, 'WALLET_FROZEN', 'WALLET', wallet.id, note, now),
  }
}

export function unfreezeWallet(wallet: Wallet, adminId: string, note: string, now = new Date()) {
  const activeWallet: Wallet = { ...wallet, status: 'ACTIVE', updatedAt: nowIso(now) }
  return {
    wallet: activeWallet,
    auditLog: createAuditLog(adminId, 'WALLET_UNFROZEN', 'WALLET', wallet.id, note, now),
  }
}

export function balanceFromLedger(entries: WalletLedgerEntry[]) {
  return entries.reduce((balance, entry) => {
    return entry.type.startsWith('DEBIT_') ? balance - entry.amount : balance + entry.amount
  }, 0)
}

export function validateLedgerIntegrity(wallet: Wallet, entries: WalletLedgerEntry[]): WalletValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const sortedEntries = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  let runningBalance = 0

  sortedEntries.forEach((entry) => {
    if (entry.walletId !== wallet.id) errors.push(`entry_wallet_mismatch:${entry.id}`)
    if (entry.currency !== wallet.currency) errors.push(`entry_currency_mismatch:${entry.id}`)
    runningBalance = entry.type.startsWith('DEBIT_') ? runningBalance - entry.amount : runningBalance + entry.amount
    if (Math.abs(runningBalance - entry.balanceAfter) > 0.0001) {
      errors.push(`entry_balance_after_mismatch:${entry.id}`)
    }
  })

  if (Math.abs(runningBalance - wallet.balance) > 0.0001) {
    errors.push('wallet_balance_does_not_match_ledger')
  }

  if (entries.length === 0 && wallet.balance !== 0) {
    warnings.push('wallet_has_balance_without_ledger_entries')
  }

  return { ok: errors.length === 0, errors, warnings }
}

export function bookingPaymentStatusFromWalletDebit(debitCompleted: boolean) {
  return debitCompleted ? 'PAID' : 'PENDING_PAYMENT'
}
