// A6.2 — append-only audit for auth events. Two things worth an immutable trail: a verification-code/OTP
// being ISSUED, and a password-reset being COMPLETED. Both write a fresh AdminAuditLog row (the same
// append-only model host-consent uses — only ever .create, never update/delete), so the log is a durable
// record of who/what/when.
//
// Privacy (must not undo A2/A5): the row carries ONLY hashed/id references — the actor's userId when known,
// and a hashed email/phone as the entityId — NEVER the code value, the raw email/phone, or a password.
// entityId is a one-way hash (hashEmail/hashPhone) so an admin can correlate repeated events to the same
// identifier without the raw address ever being stored.

export const AUTH_OTP_ISSUED_ACTION = 'AUTH_OTP_ISSUED'
export const AUTH_PASSWORD_RESET_COMPLETED_ACTION = 'AUTH_PASSWORD_RESET_COMPLETED'

// A verification code was issued to an identifier. `identifierHash` is hashEmail()/hashPhone() of the
// target — never the raw address. The code value is deliberately NOT recorded. actorUserId stays null:
// issuance is existence-agnostic (A5), so we do not resolve the identifier to a user here.
export async function recordOtpIssued(dbOrTx, { channel, identifierHash, purpose }) {
  await dbOrTx.adminAuditLog.create({
    data: { actorUserId: null, action: AUTH_OTP_ISSUED_ACTION, entityType: 'auth_otp', entityId: identifierHash, after: { channel, purpose } },
  })
}

// A password reset actually completed for a real user. actorUserId is that user (the actor is known here);
// entityId is the hashed email. No password (old or new) and no raw email are recorded.
export async function recordPasswordResetCompleted(dbOrTx, { actorUserId, identifierHash, channel = 'email' }) {
  await dbOrTx.adminAuditLog.create({
    data: { actorUserId: actorUserId || null, action: AUTH_PASSWORD_RESET_COMPLETED_ACTION, entityType: 'auth_password_reset', entityId: identifierHash, after: { channel } },
  })
}
