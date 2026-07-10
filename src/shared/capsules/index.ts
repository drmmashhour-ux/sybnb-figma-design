export type CapsuleActor = 'guest' | 'renter' | 'buyer' | 'seller' | 'host' | 'admin' | 'advertiser'
export type CapsuleDecision = 'locked' | 'ready' | 'proof' | 'admin' | 'confirmed'

export type AccountGateCapsuleState = {
  actor: CapsuleActor
  requiresAccount: true
  requiresPhoneCode: true
  returnPath: string
}

export type SearchCapsuleState = {
  division: 'STR' | 'RENTALS' | 'BUY' | 'SELLER' | 'MARKETPLACE' | 'SR'
  requiresSearchBeforeResults: boolean
  selectedMainGroup: string
  selectedGovernorate: string
  selectedCity: string
  selectedArea: string
}

export type PaymentCapsuleState = {
  actor: CapsuleActor
  amountLabel: string
  methodLabel: string
  status: CapsuleDecision
  proofCount: number
  adminMustConfirmMoney: boolean
}

export const CAPSULE_RULES = {
  accountFirst: 'Every client, renter, seller, host, advertiser, and admin action that changes platform state must pass account/sign-in first.',
  searchFirst: 'Search pages show the capsule first; results and details appear only after the client presses Search.',
  noOutsidePayment: 'Any payment capsule must keep proof upload and admin confirmation before publishing, confirmation, or service delivery.',
  reusableFilters: 'STR, renter, seller, and future country versions reuse the same visual filter capsule pattern with division-specific groups.',
} as const
