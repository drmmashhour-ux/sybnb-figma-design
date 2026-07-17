-- SMS/phone one-time verification codes (022).
CREATE TABLE "phone_verification_codes" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'guest-signup',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "phone_verification_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "phone_verification_codes_phone_purpose_idx" ON "phone_verification_codes"("phone", "purpose");
