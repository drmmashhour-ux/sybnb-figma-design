-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "reset_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limit_hits_reset_at_idx" ON "rate_limit_hits"("reset_at");

