CREATE TABLE "assistant_confirmations" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "fact_hash" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assistant_confirmations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_confirmations_actor_user_id_status_expires_at_idx"
ON "assistant_confirmations"("actor_user_id", "status", "expires_at");

ALTER TABLE "assistant_confirmations"
ADD CONSTRAINT "assistant_confirmations_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
