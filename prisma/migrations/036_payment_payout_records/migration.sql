-- M5 (031): frozen financial statement records — Payment + Payout. Additive only.
-- Statements/totals render FROM these records (never live-recompute), closing the M2 restatement gap.

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "gross_minor" INTEGER NOT NULL,
    "accommodation_minor" INTEGER NOT NULL DEFAULT 0,
    "cleaning_fee_minor" INTEGER NOT NULL DEFAULT 0,
    "extra_fees_minor" INTEGER NOT NULL DEFAULT 0,
    "processing_fee_minor" INTEGER NOT NULL DEFAULT 0,
    "commission_base_minor" INTEGER NOT NULL,
    "commission_rate_parts" INTEGER NOT NULL,
    "commission_amount_minor" INTEGER NOT NULL,
    "host_payout_minor" INTEGER NOT NULL,
    "tax_components" JSONB NOT NULL DEFAULT '[]',
    "tax_total_minor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "settlement_ref" TEXT NOT NULL,
    "base_version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SETTLED',
    "source" TEXT NOT NULL DEFAULT 'live',
    "settled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_HOLD',
    "release_date" TIMESTAMP(3),
    "released_by_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'live',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_booking_id_key" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "payments_status_settled_at_idx" ON "payments"("status", "settled_at");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_booking_id_key" ON "payouts"("booking_id");

-- CreateIndex
CREATE INDEX "payouts_host_id_status_idx" ON "payouts"("host_id", "status");

-- CreateIndex
CREATE INDEX "payouts_status_release_date_idx" ON "payouts"("status", "release_date");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
