-- CreateTable
CREATE TABLE "account_standings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'NEW',
    "granted_by_id" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_standings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standing_suggestions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "current_tier" TEXT NOT NULL,
    "suggested_tier" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ai_model" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "standing_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_standings_user_id_kind_key" ON "account_standings"("user_id", "kind");

-- CreateIndex
CREATE INDEX "standing_suggestions_status_created_at_idx" ON "standing_suggestions"("status", "created_at");

-- CreateIndex
CREATE INDEX "standing_suggestions_user_id_kind_idx" ON "standing_suggestions"("user_id", "kind");

-- AddForeignKey
ALTER TABLE "account_standings" ADD CONSTRAINT "account_standings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_suggestions" ADD CONSTRAINT "standing_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
