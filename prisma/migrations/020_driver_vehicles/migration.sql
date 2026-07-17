-- SR fleet (020): admin-reviewed driver vehicle records, with model year for the age gate.
CREATE TABLE "driver_vehicles" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "plate" TEXT NOT NULL,
    "color" TEXT,
    "category" TEXT NOT NULL,
    "status" "id_document_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "driver_vehicles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "driver_vehicles_driver_id_status_idx" ON "driver_vehicles"("driver_id", "status");

ALTER TABLE "driver_vehicles" ADD CONSTRAINT "driver_vehicles_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
