-- SR cancellation layer (019): grace-window anchor + cancellation outcome on the ride, plus a
-- driver-cancellation accountability ledger.
ALTER TABLE "ride_requests" ADD COLUMN "driver_matched_at" TIMESTAMP(3);
ALTER TABLE "ride_requests" ADD COLUMN "cancelled_at" TIMESTAMP(3);
ALTER TABLE "ride_requests" ADD COLUMN "cancelled_by_role" TEXT;
ALTER TABLE "ride_requests" ADD COLUMN "cancel_reason" TEXT;
ALTER TABLE "ride_requests" ADD COLUMN "cancellation_fee_minor" INTEGER;

CREATE TABLE "driver_cancellations" (
    "id" TEXT NOT NULL,
    "ride_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "driver_cancellations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "driver_cancellations_driver_id_idx" ON "driver_cancellations"("driver_id");
CREATE INDEX "driver_cancellations_ride_id_idx" ON "driver_cancellations"("ride_id");

ALTER TABLE "driver_cancellations" ADD CONSTRAINT "driver_cancellations_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "ride_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_cancellations" ADD CONSTRAINT "driver_cancellations_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
