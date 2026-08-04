ALTER TABLE "users" ADD COLUMN "partner_type" TEXT;

ALTER TABLE "email_verification_codes" ADD COLUMN "claimed_at" TIMESTAMP(3);
ALTER TABLE "email_verification_codes" ADD COLUMN "grant_hash" TEXT;
ALTER TABLE "phone_verification_codes" ADD COLUMN "claimed_at" TIMESTAMP(3);
ALTER TABLE "phone_verification_codes" ADD COLUMN "grant_hash" TEXT;

-- Every public partner account is also a customer, so one person can book, ride, buy, and sell
-- without creating duplicate identities. Administrative/support accounts remain staff-only.
INSERT INTO "user_roles" ("id", "user_id", "role", "created_at")
SELECT gen_random_uuid()::text, u."id", 'GUEST'::"role_name", CURRENT_TIMESTAMP
FROM "users" u
WHERE EXISTS (
  SELECT 1 FROM "user_roles" r
  WHERE r."user_id" = u."id" AND r."role" IN ('HOST', 'SELLER', 'DRIVER')
)
AND NOT EXISTS (
  SELECT 1 FROM "user_roles" r
  WHERE r."user_id" = u."id" AND r."role" = 'GUEST'
);

CREATE INDEX "email_verification_codes_created_at_idx" ON "email_verification_codes"("created_at");
CREATE INDEX "phone_verification_codes_created_at_idx" ON "phone_verification_codes"("created_at");
