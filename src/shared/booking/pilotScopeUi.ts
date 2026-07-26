import type { PlatformPilotScope } from '../api/platformApi'

// Section B2 — pure UI gates driven by the pilot scope from /api/config/country. Kept as small pure
// functions so the guest UI and the tests share ONE definition of "is this offered", in both pilot and
// full modes. Default (undefined scope — non-pilot server or a failed config fetch) is the FULL feature
// set, so a missing scope never accidentally hides a real capability.

export function isCardPaymentOffered(scope?: PlatformPilotScope | null): boolean {
  return scope?.cardPaymentAvailable !== false
}

export function isSelfServeCancellationOffered(scope?: PlatformPilotScope | null): boolean {
  return scope?.selfServeCancellation !== false
}
