-- SR Intercity service module (023) — DORMANT SCHEMA ONLY (tables + enums, no behavior).

-- CreateEnum
CREATE TYPE "operator_type" AS ENUM ('BUS_COMPANY', 'TAXI_FLEET');
CREATE TYPE "service_trip_status" AS ENUM ('FORMING', 'READY', 'DEPARTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "seat_booking_status" AS ENUM ('RESERVED', 'PAID', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
CREATE TYPE "departure_mode" AS ENUM ('FILL_AND_GO', 'SCHEDULED');
CREATE TYPE "tariff_scope" AS ENUM ('ROUTE', 'OPERATOR', 'GLOBAL');
CREATE TYPE "tariff_reason" AS ENUM ('HOLIDAY', 'HIGH_SEASON', 'EVENT', 'FUEL', 'MANUAL');
CREATE TYPE "tariff_kind" AS ENUM ('MULTIPLIER', 'ABSOLUTE');

-- CreateTable
CREATE TABLE "garages" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "garages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" TEXT NOT NULL,
    "origin_garage_id" TEXT NOT NULL,
    "dest_garage_id" TEXT NOT NULL,
    "distance_km" INTEGER,
    "est_minutes" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_tariffs" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "per_seat_minor" INTEGER NOT NULL,
    "whole_vehicle_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "route_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_adjustments" (
    "id" TEXT NOT NULL,
    "scope" "tariff_scope" NOT NULL,
    "route_id" TEXT,
    "operator_id" TEXT,
    "tier" TEXT,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3) NOT NULL,
    "reason" "tariff_reason" NOT NULL,
    "kind" "tariff_kind" NOT NULL,
    "value" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tariff_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operators" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "operator_type" NOT NULL,
    "country" TEXT NOT NULL,
    "contact_phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_trips" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "operator_id" TEXT,
    "driver_user_id" TEXT,
    "vehicle_id" TEXT,
    "capacity" INTEGER NOT NULL,
    "seats_available" INTEGER NOT NULL,
    "seat_map" JSONB,
    "status" "service_trip_status" NOT NULL DEFAULT 'FORMING',
    "departure_mode" "departure_mode" NOT NULL,
    "scheduled_depart_at" TIMESTAMP(3),
    "departed_at" TIMESTAMP(3),
    "per_seat_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_bookings" (
    "id" TEXT NOT NULL,
    "service_trip_id" TEXT NOT NULL,
    "rider_user_id" TEXT NOT NULL,
    "seat_count" INTEGER NOT NULL DEFAULT 1,
    "seat_labels" TEXT[],
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "ticket_code" TEXT NOT NULL,
    "status" "seat_booking_status" NOT NULL DEFAULT 'RESERVED',
    "boarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "seat_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "garages_country_city_idx" ON "garages"("country", "city");
CREATE INDEX "routes_origin_garage_id_idx" ON "routes"("origin_garage_id");
CREATE INDEX "routes_dest_garage_id_idx" ON "routes"("dest_garage_id");
CREATE UNIQUE INDEX "route_tariffs_route_id_tier_key" ON "route_tariffs"("route_id", "tier");
CREATE INDEX "tariff_adjustments_route_id_idx" ON "tariff_adjustments"("route_id");
CREATE INDEX "tariff_adjustments_operator_id_idx" ON "tariff_adjustments"("operator_id");
CREATE INDEX "tariff_adjustments_effective_from_effective_to_idx" ON "tariff_adjustments"("effective_from", "effective_to");
CREATE INDEX "operators_country_status_idx" ON "operators"("country", "status");
CREATE INDEX "service_trips_route_id_status_idx" ON "service_trips"("route_id", "status");
CREATE INDEX "service_trips_operator_id_idx" ON "service_trips"("operator_id");
CREATE UNIQUE INDEX "seat_bookings_ticket_code_key" ON "seat_bookings"("ticket_code");
CREATE INDEX "seat_bookings_service_trip_id_idx" ON "seat_bookings"("service_trip_id");
CREATE INDEX "seat_bookings_rider_user_id_idx" ON "seat_bookings"("rider_user_id");

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_origin_garage_id_fkey" FOREIGN KEY ("origin_garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "routes" ADD CONSTRAINT "routes_dest_garage_id_fkey" FOREIGN KEY ("dest_garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "route_tariffs" ADD CONSTRAINT "route_tariffs_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tariff_adjustments" ADD CONSTRAINT "tariff_adjustments_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tariff_adjustments" ADD CONSTRAINT "tariff_adjustments_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_trips" ADD CONSTRAINT "service_trips_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_trips" ADD CONSTRAINT "service_trips_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "seat_bookings" ADD CONSTRAINT "seat_bookings_service_trip_id_fkey" FOREIGN KEY ("service_trip_id") REFERENCES "service_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
