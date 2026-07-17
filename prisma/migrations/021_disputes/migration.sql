-- Consumer-protection dispute/refund (021).
CREATE TYPE "dispute_status" AS ENUM ('OPEN', 'RESOLVED_REFUNDED', 'RESOLVED_REJECTED');

CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "ride_id" TEXT,
    "booking_id" TEXT,
    "opened_by_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "dispute_status" NOT NULL DEFAULT 'OPEN',
    "refund_minor" INTEGER,
    "currency" TEXT,
    "resolution_note" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "disputes_status_idx" ON "disputes"("status");
CREATE INDEX "disputes_opened_by_user_id_idx" ON "disputes"("opened_by_user_id");

ALTER TABLE "disputes" ADD CONSTRAINT "disputes_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "ride_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_user_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
