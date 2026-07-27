-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "role_name" AS ENUM ('GUEST', 'HOST', 'SELLER', 'DRIVER', 'ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "listing_status" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PAUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "id_document_status" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "availability_status" AS ENUM ('BLOCKED', 'AVAILABLE');

-- CreateEnum
CREATE TYPE "listing_division" AS ENUM ('STAYS', 'RENTALS', 'BUY', 'CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('DRAFT', 'REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED', 'REJECTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "wallet_entry_type" AS ENUM ('CREDIT', 'DEBIT', 'HOLD', 'RELEASE', 'REFUND');

-- CreateEnum
CREATE TYPE "gift_status" AS ENUM ('CREATED', 'SENT', 'CLAIM_PENDING', 'CLAIMED', 'LOCKED', 'EXPIRED', 'ADMIN_BLOCKED');

-- CreateEnum
CREATE TYPE "ride_status" AS ENUM ('DRAFT', 'REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "message_sender_role" AS ENUM ('GUEST', 'HOST', 'ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "referral_status" AS ENUM ('PENDING', 'REWARDED');

-- CreateEnum
CREATE TYPE "auction_status" AS ENUM ('OPEN', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "sos_role" AS ENUM ('RIDER', 'DRIVER');

-- CreateEnum
CREATE TYPE "sos_status" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "driver_document_type" AS ENUM ('LICENSE', 'VEHICLE_REGISTRATION', 'INSURANCE', 'SAAQ_AUTHORIZED_DRIVER_PERMIT', 'CRIMINAL_RECORD_CHECK');

-- CreateEnum
CREATE TYPE "ride_participant_role" AS ENUM ('RIDER', 'DRIVER');

-- CreateEnum
CREATE TYPE "dispute_status" AS ENUM ('OPEN', 'RESOLVED_REFUNDED', 'RESOLVED_REJECTED');

-- CreateEnum
CREATE TYPE "operator_type" AS ENUM ('BUS_COMPANY', 'TAXI_FLEET');

-- CreateEnum
CREATE TYPE "service_trip_status" AS ENUM ('FORMING', 'READY', 'DEPARTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "seat_booking_status" AS ENUM ('RESERVED', 'PAID', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "departure_mode" AS ENUM ('FILL_AND_GO', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "tariff_scope" AS ENUM ('ROUTE', 'OPERATOR', 'GLOBAL');

-- CreateEnum
CREATE TYPE "tariff_reason" AS ENUM ('HOLIDAY', 'HIGH_SEASON', 'EVENT', 'FUEL', 'MANUAL');

-- CreateEnum
CREATE TYPE "tariff_kind" AS ENUM ('MULTIPLIER', 'ABSOLUTE');

-- CreateEnum
CREATE TYPE "report_subject_type" AS ENUM ('LISTING', 'REVIEW', 'SELLER', 'USER', 'RIDE', 'BOOKING');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('OPEN', 'REVIEWED', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "gst_qst_treatment" AS ENUM ('HOST_REGISTERED', 'PLATFORM_COLLECTS');

-- CreateEnum
CREATE TYPE "jurisdiction_calculation_base" AS ENUM ('ACCOMMODATION_ONLY', 'FARE_BASE', 'TOTAL_BOOKING');

-- CreateEnum
CREATE TYPE "jurisdiction_collector_type" AS ENUM ('PLATFORM', 'HOST_OR_DRIVER', 'DEPENDS_ON_REGISTRATION');

-- CreateEnum
CREATE TYPE "jurisdiction_compliance_status" AS ENUM ('PENDING', 'APPROVED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "jurisdiction_division" AS ENUM ('STR', 'SR');

-- CreateEnum
CREATE TYPE "jurisdiction_service_type" AS ENUM ('RIDE', 'STAY');

-- CreateEnum
CREATE TYPE "jurisdiction_tax_type" AS ENUM ('GST', 'QST', 'LODGING', 'REGULATORY_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "listing_document_status" AS ENUM ('PENDING_REVIEW', 'ADMIN_REVIEWED_TEST', 'REJECTED', 'EXPIRED', 'DIGITAL_VERIFICATION_PENDING', 'DIGITALLY_VERIFIED');

-- CreateEnum
CREATE TYPE "listing_document_type" AS ENUM ('CITQ_CERTIFICATE');

-- CreateEnum
CREATE TYPE "malware_scan_status" AS ENUM ('PENDING', 'QUARANTINED', 'NOT_IMPLEMENTED', 'CLEAN');

-- CreateEnum
CREATE TYPE "part_xx_activity_type" AS ENUM ('RIDE', 'ACCOMMODATION');

-- CreateEnum
CREATE TYPE "part_xx_filing_status" AS ENUM ('DRAFT', 'VALIDATED', 'FILED', 'ACCEPTED', 'REJECTED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "quebec_compliance_item_status" AS ENUM ('NOT_STARTED', 'SUBMITTED', 'ADMIN_REVIEWED_TEST', 'REJECTED');

-- CreateEnum
CREATE TYPE "quebec_driver_document_type" AS ENUM ('DRIVERS_LICENSE', 'DRIVING_RECORD_ABSTRACT', 'POLICE_BACKGROUND_CHECK', 'SAAQ_AUTHORIZED_DRIVER_PERMIT', 'PROOF_OF_TRAINING_COMPLETION', 'FRENCH_LANGUAGE_ATTESTATION', 'GST_REGISTRATION', 'QST_REGISTRATION', 'REVENU_QUEBEC_OPERATOR_FILE', 'PROOF_OF_IDENTITY', 'PROOF_OF_ADDRESS');

-- CreateEnum
CREATE TYPE "quebec_driver_onboarding_status" AS ENUM ('DRAFT', 'IDENTITY_PENDING', 'DRIVER_DOCUMENTS_PENDING', 'POLICE_CHECK_PENDING', 'TRAINING_PENDING', 'TAX_REGISTRATION_PENDING', 'VEHICLE_PENDING', 'INSURANCE_PENDING', 'ADMIN_REVIEW', 'APPROVED_INACTIVE', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "quebec_vehicle_document_type" AS ENUM ('VEHICLE_REGISTRATION', 'PROOF_OF_INSURANCE', 'SAAQ_MECHANICAL_INSPECTION', 'VEHICLE_OWNERSHIP_PROOF', 'ACCESSIBILITY_CERTIFICATION', 'COMMERCIAL_PLATE_REGISTRATION', 'VEHICLE_PHOTO');

-- CreateEnum
CREATE TYPE "quebec_vehicle_onboarding_status" AS ENUM ('DRAFT', 'DOCUMENTS_PENDING', 'INSPECTION_PENDING', 'ADMIN_REVIEW', 'APPROVED_INACTIVE', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "tax_identifier_type" AS ENUM ('SIN', 'TIN', 'OTHER');

-- CreateEnum
CREATE TYPE "tax_profile_business_type" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "tax_profile_subject_type" AS ENUM ('DRIVER', 'HOST');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone_hash" TEXT,
    "password_hash" TEXT,
    "display_name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar-SY',
    "status" "account_status" NOT NULL DEFAULT 'ACTIVE',
    "id_document_ref" TEXT,
    "id_document_submitted_at" TIMESTAMP(3),
    "id_document_mime_type" TEXT,
    "id_document_status" "id_document_status",
    "id_document_reviewed_by_id" TEXT,
    "id_document_reviewed_at" TIMESTAMP(3),
    "payout_method" JSONB,
    "session_version" INTEGER NOT NULL DEFAULT 0,
    "referral_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrer_user_id" TEXT NOT NULL,
    "referee_user_id" TEXT NOT NULL,
    "status" "referral_status" NOT NULL DEFAULT 'PENDING',
    "qualifying_booking_id" TEXT,
    "rewarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "role_name" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "seller_type" TEXT NOT NULL,
    "document_status" "listing_status" NOT NULL DEFAULT 'DRAFT',
    "plan_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "license_hash" TEXT,
    "vehicle_make" TEXT,
    "vehicle_model" TEXT,
    "vehicle_plate" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "last_location_geo" geometry,
    "payout_method" TEXT,
    "payout_account_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'SY',

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'SY',
    "governorate" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "area" TEXT,
    "street" TEXT,
    "address_line" TEXT,
    "geo" geometry,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "location_id" TEXT,
    "accommodation_id" TEXT,
    "division" "listing_division" NOT NULL,
    "title_ar" TEXT NOT NULL,
    "title_en" TEXT,
    "description" TEXT,
    "status" "listing_status" NOT NULL DEFAULT 'DRAFT',
    "price_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SYP',
    "instant_book_enabled" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accommodations" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "title_ar" TEXT NOT NULL,
    "title_en" TEXT,
    "description" TEXT,
    "governorate" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "area" TEXT,
    "address" TEXT,
    "status" "listing_status" NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accommodations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accommodation_media" (
    "id" TEXT NOT NULL,
    "accommodation_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accommodation_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_insights" (
    "id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "listing_id" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'PRICING_GAP',
    "facts" JSONB NOT NULL DEFAULT '{}',
    "message_ar" TEXT NOT NULL,
    "message_en" TEXT,
    "ai_provider" TEXT,
    "ai_model" TEXT,
    "read_at" TIMESTAMP(3),
    "email_sent_at" TIMESTAMP(3),
    "email_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auctions" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "status" "auction_status" NOT NULL DEFAULT 'OPEN',
    "starting_price_minor" INTEGER NOT NULL,
    "reserve_price_minor" INTEGER,
    "reserve_met" BOOLEAN NOT NULL DEFAULT false,
    "min_increment_minor" INTEGER NOT NULL,
    "current_price_minor" INTEGER NOT NULL,
    "current_bidder_id" TEXT,
    "current_max_proxy_minor" INTEGER,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "anti_snipe_window_seconds" INTEGER NOT NULL DEFAULT 120,
    "anti_snipe_extension_seconds" INTEGER NOT NULL DEFAULT 120,
    "ended_at" TIMESTAMP(3),
    "winner_bidder_id" TEXT,
    "winner_notified_at" TIMESTAMP(3),
    "winner_email_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "bidder_id" TEXT NOT NULL,
    "max_proxy_minor" INTEGER NOT NULL,
    "visible_price_at_minor" INTEGER NOT NULL,
    "is_winning_bid" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_codes" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'guest-signup',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "listing_availability" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "availability_status" NOT NULL DEFAULT 'BLOCKED',
    "price_override_minor" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_media" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "guest_id" TEXT NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'REQUESTED',
    "check_in" TIMESTAMP(3),
    "check_out" TIMESTAMP(3),
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SYP',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "guest_checked_in_at" TIMESTAMP(3),
    "guest_checked_out_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_proofs" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'PENDING_PROOF',
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SYP',
    "proof_asset_url" TEXT,
    "provider_ref" TEXT,
    "admin_note" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_reviews" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "guest_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "hidden_at" TIMESTAMP(3),
    "hidden_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_sales" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_reviews" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "hidden_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_threads" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT,
    "listing_id" TEXT,
    "guest_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "sender_user_id" TEXT NOT NULL,
    "sender_role" "message_sender_role" NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_documents" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "uploader_user_id" TEXT NOT NULL,
    "asset_url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "original_filename" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SYP',
    "cached_balance_minor" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_entries" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "type" "wallet_entry_type" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SYP',
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_gifts" (
    "id" TEXT NOT NULL,
    "sender_user_id" TEXT NOT NULL,
    "recipient_user_id" TEXT,
    "recipient_phone_hash" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SYP',
    "message" TEXT,
    "status" "gift_status" NOT NULL DEFAULT 'CREATED',
    "claim_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_gifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_attempt_locks" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "subject_hash" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otp_attempt_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_requests" (
    "id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "driver_id" TEXT,
    "pickup_location_id" TEXT,
    "dropoff_location_id" TEXT,
    "status" "ride_status" NOT NULL DEFAULT 'REQUESTED',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fare_minor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'SYP',
    "pickup_geo" geometry,
    "dropoff_geo" geometry,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_location_geo" geometry,
    "last_location_at" TIMESTAMP(3),
    "share_token" TEXT,
    "share_token_created_at" TIMESTAMP(3),
    "pickup_pin" TEXT,
    "pickup_verified_at" TIMESTAMP(3),
    "pin_attempts" INTEGER NOT NULL DEFAULT 0,
    "driver_matched_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_role" TEXT,
    "cancel_reason" TEXT,
    "cancellation_fee_minor" INTEGER,

    CONSTRAINT "ride_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sos_events" (
    "id" TEXT NOT NULL,
    "ride_id" TEXT NOT NULL,
    "raised_by_user_id" TEXT NOT NULL,
    "raised_by_role" "sos_role" NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "note" TEXT,
    "status" "sos_status" NOT NULL DEFAULT 'OPEN',
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sos_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_documents" (
    "id" TEXT NOT NULL,
    "driver_user_id" TEXT NOT NULL,
    "type" "driver_document_type" NOT NULL,
    "asset_url" TEXT NOT NULL,
    "mime_type" TEXT,
    "status" "id_document_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_messages" (
    "id" TEXT NOT NULL,
    "ride_id" TEXT NOT NULL,
    "sender_user_id" TEXT NOT NULL,
    "sender_role" "ride_participant_role" NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_ratings" (
    "id" TEXT NOT NULL,
    "ride_id" TEXT NOT NULL,
    "rater_user_id" TEXT NOT NULL,
    "rated_user_id" TEXT NOT NULL,
    "rater_role" "ride_participant_role" NOT NULL,
    "stars" INTEGER NOT NULL,
    "safety_flag" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_cancellations" (
    "id" TEXT NOT NULL,
    "ride_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "country" TEXT NOT NULL DEFAULT 'SY',

    CONSTRAINT "driver_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporter_user_id" TEXT NOT NULL,
    "subject_type" "report_subject_type" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" "report_status" NOT NULL DEFAULT 'OPEN',
    "resolution_note" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" TEXT NOT NULL,
    "blocker_user_id" TEXT NOT NULL,
    "blocked_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdiction_commission_policies" (
    "id" TEXT NOT NULL,
    "country" TEXT,
    "province" TEXT,
    "service_type" "jurisdiction_service_type" NOT NULL,
    "policy_type" TEXT NOT NULL,
    "flat_rate_parts" INTEGER,
    "tiers" JSONB,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "legally_reviewed_by_id" TEXT,
    "legally_reviewed_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jurisdiction_commission_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdiction_compliance_profiles" (
    "id" TEXT NOT NULL,
    "division" "jurisdiction_division" NOT NULL,
    "country_code" TEXT NOT NULL,
    "region_code" TEXT NOT NULL DEFAULT '',
    "status" "jurisdiction_compliance_status" NOT NULL DEFAULT 'PENDING',
    "tourism_required" BOOLEAN NOT NULL DEFAULT false,
    "tourism_satisfied" BOOLEAN NOT NULL DEFAULT false,
    "tourism_notes" TEXT,
    "transport_required" BOOLEAN NOT NULL DEFAULT false,
    "transport_satisfied" BOOLEAN NOT NULL DEFAULT false,
    "transport_notes" TEXT,
    "tax_required" BOOLEAN NOT NULL DEFAULT false,
    "tax_satisfied" BOOLEAN NOT NULL DEFAULT false,
    "tax_notes" TEXT,
    "platform_required" BOOLEAN NOT NULL DEFAULT false,
    "platform_satisfied" BOOLEAN NOT NULL DEFAULT false,
    "platform_notes" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "operator_respondent_name" TEXT,
    "operator_respondent_contact" TEXT,
    "operator_dispatcher_name" TEXT,
    "operator_dispatcher_contact" TEXT,
    "operator_insurance_reference" TEXT,
    "operator_authorization_number" TEXT,

    CONSTRAINT "jurisdiction_compliance_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdiction_tax_rates" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "province" TEXT,
    "municipality" TEXT,
    "service_type" "jurisdiction_service_type" NOT NULL,
    "tax_type" "jurisdiction_tax_type" NOT NULL,
    "rate_parts" INTEGER NOT NULL,
    "calculation_base" "jurisdiction_calculation_base" NOT NULL,
    "collector_type" "jurisdiction_collector_type" NOT NULL,
    "rounding_rule" TEXT NOT NULL DEFAULT 'ROUND_HALF_UP',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "legally_reviewed_by_id" TEXT,
    "legally_reviewed_at" TIMESTAMP(3),
    "source_url" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jurisdiction_tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_documents" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "type" "listing_document_type" NOT NULL,
    "asset_url" TEXT,
    "mime_type" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "legal_hold_reason" TEXT,
    "legal_hold_set_at" TIMESTAMP(3),
    "legal_hold_set_by_id" TEXT,
    "retention_delete_after" TIMESTAMP(3),
    "status" "listing_document_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "replaces_id" TEXT,

    CONSTRAINT "listing_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_xx_filings" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "status" "part_xx_filing_status" NOT NULL DEFAULT 'DRAFT',
    "t619_transmission_ref" TEXT,
    "submitted_xml" TEXT,
    "cra_response" JSONB,
    "submitted_at" TIMESTAMP(3),
    "submitted_by_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "error_details" JSONB,
    "correction_of_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "part_xx_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_xx_records" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "activity_type" "part_xx_activity_type" NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "gross_consideration_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "activity_count" INTEGER NOT NULL,
    "platform_fees_minor" INTEGER NOT NULL,
    "taxes_withheld_minor" INTEGER NOT NULL DEFAULT 0,
    "refunds_minor" INTEGER NOT NULL DEFAULT 0,
    "property_address" TEXT,
    "status" "part_xx_filing_status" NOT NULL DEFAULT 'DRAFT',
    "filing_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "part_xx_records_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "pricing_snapshots" (
    "id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "province" TEXT,
    "breakdown" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quebec_driver_documents" (
    "id" TEXT NOT NULL,
    "onboarding_user_id" TEXT NOT NULL,
    "type" "quebec_driver_document_type" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "replaces_id" TEXT,
    "asset_url" TEXT,
    "mime_type" TEXT,
    "status" "listing_document_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "issuer" TEXT,
    "issued_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "malware_scan_status" "malware_scan_status" NOT NULL DEFAULT 'PENDING',
    "retention_delete_after" TIMESTAMP(3),
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "legal_hold_reason" TEXT,
    "legal_hold_set_by_id" TEXT,
    "legal_hold_set_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quebec_driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quebec_driver_onboarding" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "quebec_driver_onboarding_status" NOT NULL DEFAULT 'DRAFT',
    "license_number_encrypted" TEXT,
    "license_expires_at" TIMESTAMP(3),
    "police_check_expires_at" TIMESTAMP(3),
    "training_completed_at" TIMESTAMP(3),
    "status_reason" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "legal_name_encrypted" TEXT,
    "legal_name_last4" TEXT,
    "age_eligibility_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "license_class" TEXT,
    "driving_experience_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "driving_experience_confirmed_at" TIMESTAMP(3),
    "french_attestation_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "french_attestation_confirmed_at" TIMESTAMP(3),
    "gst_status" "quebec_compliance_item_status" NOT NULL DEFAULT 'NOT_STARTED',
    "qst_status" "quebec_compliance_item_status" NOT NULL DEFAULT 'NOT_STARTED',
    "operator_file_status" "quebec_compliance_item_status" NOT NULL DEFAULT 'NOT_STARTED',
    "sev_srs_status" "quebec_compliance_item_status" NOT NULL DEFAULT 'NOT_STARTED',
    "assigned_reviewer_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "quebec_driver_onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quebec_vehicle_documents" (
    "id" TEXT NOT NULL,
    "onboarding_vehicle_id" TEXT NOT NULL,
    "type" "quebec_vehicle_document_type" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "replaces_id" TEXT,
    "asset_url" TEXT,
    "mime_type" TEXT,
    "status" "listing_document_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "issuer" TEXT,
    "issued_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "malware_scan_status" "malware_scan_status" NOT NULL DEFAULT 'PENDING',
    "retention_delete_after" TIMESTAMP(3),
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "legal_hold_reason" TEXT,
    "legal_hold_set_by_id" TEXT,
    "legal_hold_set_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quebec_vehicle_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quebec_vehicle_onboarding" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "status" "quebec_vehicle_onboarding_status" NOT NULL DEFAULT 'DRAFT',
    "registration_expires_at" TIMESTAMP(3),
    "insurance_expires_at" TIMESTAMP(3),
    "inspection_expires_at" TIMESTAMP(3),
    "status_reason" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "vin_encrypted" TEXT,
    "vin_last4" TEXT,
    "odometer_km" INTEGER,
    "door_count" INTEGER,
    "seat_count" INTEGER,
    "accessibility_info" JSONB,
    "assigned_reviewer_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "quebec_vehicle_onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject_type" "tax_profile_subject_type" NOT NULL,
    "legal_first_name" TEXT NOT NULL,
    "legal_last_name" TEXT NOT NULL,
    "legal_business_name" TEXT,
    "business_type" "tax_profile_business_type" NOT NULL DEFAULT 'INDIVIDUAL',
    "date_of_birth" TIMESTAMP(3),
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "tax_residence_country" TEXT NOT NULL,
    "tax_residence_region" TEXT,
    "tax_identifier_type" "tax_identifier_type" NOT NULL,
    "tax_identifier_ciphertext" TEXT NOT NULL,
    "tax_identifier_last4" TEXT NOT NULL,
    "gst_registered" BOOLEAN NOT NULL DEFAULT false,
    "gst_number" TEXT,
    "qst_registered" BOOLEAN NOT NULL DEFAULT false,
    "qst_number" TEXT,
    "neq_number" TEXT,
    "payout_account_ciphertext" TEXT,
    "payout_account_last4" TEXT,
    "gst_qst_treatment" "gst_qst_treatment",
    "gst_qst_treatment_effective_at" TIMESTAMP(3),
    "gst_qst_treatment_decided_by_id" TEXT,
    "gst_qst_treatment_decided_at" TIMESTAMP(3),
    "consent_regulatory_reporting" BOOLEAN NOT NULL DEFAULT false,
    "certified_accurate" BOOLEAN NOT NULL DEFAULT false,
    "certified_accurate_at" TIMESTAMP(3),
    "verification_status" "id_document_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "verification_source" TEXT,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_hash_key" ON "users"("phone_hash");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referee_user_id_key" ON "referrals"("referee_user_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_user_id_status_idx" ON "referrals"("referrer_user_id", "status");

-- CreateIndex
CREATE INDEX "user_roles_role_idx" ON "user_roles"("role");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_key" ON "user_roles"("user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "seller_profiles_user_id_key" ON "seller_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_user_id_key" ON "driver_profiles"("user_id");

-- CreateIndex
CREATE INDEX "locations_governorate_city_idx" ON "locations"("governorate", "city");

-- CreateIndex
CREATE INDEX "listings_division_status_idx" ON "listings"("division", "status");

-- CreateIndex
CREATE INDEX "listings_owner_id_idx" ON "listings"("owner_id");

-- CreateIndex
CREATE INDEX "listings_accommodation_id_idx" ON "listings"("accommodation_id");

-- CreateIndex
CREATE INDEX "accommodations_owner_id_idx" ON "accommodations"("owner_id");

-- CreateIndex
CREATE INDEX "accommodation_media_accommodation_id_idx" ON "accommodation_media"("accommodation_id");

-- CreateIndex
CREATE INDEX "host_insights_host_id_created_at_idx" ON "host_insights"("host_id", "created_at");

-- CreateIndex
CREATE INDEX "host_insights_listing_id_idx" ON "host_insights"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "auctions_listing_id_key" ON "auctions"("listing_id");

-- CreateIndex
CREATE INDEX "auctions_status_ends_at_idx" ON "auctions"("status", "ends_at");

-- CreateIndex
CREATE INDEX "bids_auction_id_created_at_idx" ON "bids"("auction_id", "created_at");

-- CreateIndex
CREATE INDEX "bids_bidder_id_idx" ON "bids"("bidder_id");

-- CreateIndex
CREATE INDEX "email_verification_codes_email_purpose_idx" ON "email_verification_codes"("email", "purpose");

-- CreateIndex
CREATE INDEX "phone_verification_codes_phone_purpose_idx" ON "phone_verification_codes"("phone", "purpose");

-- CreateIndex
CREATE INDEX "listing_availability_listing_id_date_idx" ON "listing_availability"("listing_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "listing_availability_listing_id_date_key" ON "listing_availability"("listing_id", "date");

-- CreateIndex
CREATE INDEX "listing_media_listing_id_idx" ON "listing_media"("listing_id");

-- CreateIndex
CREATE INDEX "bookings_guest_id_status_idx" ON "bookings"("guest_id", "status");

-- CreateIndex
CREATE INDEX "bookings_listing_id_status_idx" ON "bookings"("listing_id", "status");

-- CreateIndex
CREATE INDEX "payment_proofs_status_created_at_idx" ON "payment_proofs"("status", "created_at");

-- CreateIndex
CREATE INDEX "payment_proofs_user_id_idx" ON "payment_proofs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "listing_reviews_booking_id_key" ON "listing_reviews"("booking_id");

-- CreateIndex
CREATE INDEX "listing_reviews_listing_id_hidden_at_idx" ON "listing_reviews"("listing_id", "hidden_at");

-- CreateIndex
CREATE INDEX "seller_sales_seller_id_idx" ON "seller_sales"("seller_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_sales_listing_id_buyer_id_key" ON "seller_sales"("listing_id", "buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_reviews_sale_id_key" ON "seller_reviews"("sale_id");

-- CreateIndex
CREATE INDEX "seller_reviews_seller_id_hidden_at_idx" ON "seller_reviews"("seller_id", "hidden_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_threads_booking_id_key" ON "message_threads"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_threads_listing_id_guest_id_key" ON "message_threads"("listing_id", "guest_id");

-- CreateIndex
CREATE INDEX "messages_thread_id_created_at_idx" ON "messages"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "thread_documents_thread_id_created_at_idx" ON "thread_documents"("thread_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_currency_key" ON "wallets"("user_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_idempotency_key_key" ON "wallet_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "wallet_entries_wallet_id_created_at_idx" ON "wallet_entries"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_entries_reference_type_reference_id_idx" ON "wallet_entries"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "wallet_gifts_recipient_phone_hash_status_idx" ON "wallet_gifts"("recipient_phone_hash", "status");

-- CreateIndex
CREATE INDEX "wallet_gifts_sender_user_id_created_at_idx" ON "wallet_gifts"("sender_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "otp_attempt_locks_purpose_subject_hash_key" ON "otp_attempt_locks"("purpose", "subject_hash");

-- CreateIndex
CREATE UNIQUE INDEX "ride_requests_share_token_key" ON "ride_requests"("share_token");

-- CreateIndex
CREATE INDEX "ride_requests_status_requested_at_idx" ON "ride_requests"("status", "requested_at");

-- CreateIndex
CREATE INDEX "ride_requests_driver_id_status_idx" ON "ride_requests"("driver_id", "status");

-- CreateIndex
CREATE INDEX "admin_audit_logs_entity_type_entity_id_created_at_idx" ON "admin_audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_actor_user_id_created_at_idx" ON "admin_audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "sos_events_status_created_at_idx" ON "sos_events"("status", "created_at");

-- CreateIndex
CREATE INDEX "sos_events_ride_id_idx" ON "sos_events"("ride_id");

-- CreateIndex
CREATE INDEX "driver_documents_status_idx" ON "driver_documents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "driver_documents_driver_user_id_type_key" ON "driver_documents"("driver_user_id", "type");

-- CreateIndex
CREATE INDEX "ride_messages_ride_id_created_at_idx" ON "ride_messages"("ride_id", "created_at");

-- CreateIndex
CREATE INDEX "ride_ratings_rated_user_id_safety_flag_idx" ON "ride_ratings"("rated_user_id", "safety_flag");

-- CreateIndex
CREATE INDEX "ride_ratings_rater_user_id_safety_flag_idx" ON "ride_ratings"("rater_user_id", "safety_flag");

-- CreateIndex
CREATE UNIQUE INDEX "ride_ratings_ride_id_rater_user_id_key" ON "ride_ratings"("ride_id", "rater_user_id");

-- CreateIndex
CREATE INDEX "driver_cancellations_driver_id_idx" ON "driver_cancellations"("driver_id");

-- CreateIndex
CREATE INDEX "driver_cancellations_ride_id_idx" ON "driver_cancellations"("ride_id");

-- CreateIndex
CREATE INDEX "driver_vehicles_driver_id_status_idx" ON "driver_vehicles"("driver_id", "status");

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "disputes"("status");

-- CreateIndex
CREATE INDEX "disputes_opened_by_user_id_idx" ON "disputes"("opened_by_user_id");

-- CreateIndex
CREATE INDEX "garages_country_city_idx" ON "garages"("country", "city");

-- CreateIndex
CREATE INDEX "routes_origin_garage_id_idx" ON "routes"("origin_garage_id");

-- CreateIndex
CREATE INDEX "routes_dest_garage_id_idx" ON "routes"("dest_garage_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_tariffs_route_id_tier_key" ON "route_tariffs"("route_id", "tier");

-- CreateIndex
CREATE INDEX "tariff_adjustments_route_id_idx" ON "tariff_adjustments"("route_id");

-- CreateIndex
CREATE INDEX "tariff_adjustments_operator_id_idx" ON "tariff_adjustments"("operator_id");

-- CreateIndex
CREATE INDEX "tariff_adjustments_effective_from_effective_to_idx" ON "tariff_adjustments"("effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "operators_country_status_idx" ON "operators"("country", "status");

-- CreateIndex
CREATE INDEX "service_trips_route_id_status_idx" ON "service_trips"("route_id", "status");

-- CreateIndex
CREATE INDEX "service_trips_operator_id_idx" ON "service_trips"("operator_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_bookings_ticket_code_key" ON "seat_bookings"("ticket_code");

-- CreateIndex
CREATE INDEX "seat_bookings_service_trip_id_idx" ON "seat_bookings"("service_trip_id");

-- CreateIndex
CREATE INDEX "seat_bookings_rider_user_id_idx" ON "seat_bookings"("rider_user_id");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_subject_type_subject_id_idx" ON "reports"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "reports_reporter_user_id_idx" ON "reports"("reporter_user_id");

-- CreateIndex
CREATE INDEX "user_blocks_blocked_user_id_idx" ON "user_blocks"("blocked_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blocker_user_id_blocked_user_id_key" ON "user_blocks"("blocker_user_id", "blocked_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_feature_flags_key_key" ON "compliance_feature_flags"("key");

-- CreateIndex
CREATE INDEX "jurisdiction_commission_policies_country_province_service_t_idx" ON "jurisdiction_commission_policies"("country", "province", "service_type", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdiction_compliance_profiles_division_country_code_regi_key" ON "jurisdiction_compliance_profiles"("division", "country_code", "region_code");

-- CreateIndex
CREATE INDEX "jurisdiction_tax_rates_country_province_municipality_servic_idx" ON "jurisdiction_tax_rates"("country", "province", "municipality", "service_type", "tax_type", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "listing_documents_replaces_id_key" ON "listing_documents"("replaces_id");

-- CreateIndex
CREATE INDEX "listing_documents_listing_id_type_is_current_idx" ON "listing_documents"("listing_id", "type", "is_current");

-- CreateIndex
CREATE INDEX "listing_documents_retention_delete_after_idx" ON "listing_documents"("retention_delete_after");

-- CreateIndex
CREATE INDEX "listing_documents_status_idx" ON "listing_documents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "listing_documents_listing_id_type_version_key" ON "listing_documents"("listing_id", "type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "part_xx_records_seller_id_activity_type_year_quarter_key" ON "part_xx_records"("seller_id", "activity_type", "year", "quarter");

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

-- CreateIndex
CREATE INDEX "pricing_snapshots_subject_type_subject_id_idx" ON "pricing_snapshots"("subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "quebec_driver_documents_replaces_id_key" ON "quebec_driver_documents"("replaces_id");

-- CreateIndex
CREATE INDEX "quebec_driver_documents_onboarding_user_id_type_is_current_idx" ON "quebec_driver_documents"("onboarding_user_id", "type", "is_current");

-- CreateIndex
CREATE INDEX "quebec_driver_documents_retention_delete_after_idx" ON "quebec_driver_documents"("retention_delete_after");

-- CreateIndex
CREATE INDEX "quebec_driver_documents_status_idx" ON "quebec_driver_documents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quebec_driver_onboarding_user_id_key" ON "quebec_driver_onboarding"("user_id");

-- CreateIndex
CREATE INDEX "quebec_driver_onboarding_status_idx" ON "quebec_driver_onboarding"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quebec_vehicle_documents_replaces_id_key" ON "quebec_vehicle_documents"("replaces_id");

-- CreateIndex
CREATE INDEX "quebec_vehicle_documents_onboarding_vehicle_id_type_is_curre_id" ON "quebec_vehicle_documents"("onboarding_vehicle_id", "type", "is_current");

-- CreateIndex
CREATE INDEX "quebec_vehicle_documents_retention_delete_after_idx" ON "quebec_vehicle_documents"("retention_delete_after");

-- CreateIndex
CREATE INDEX "quebec_vehicle_documents_status_idx" ON "quebec_vehicle_documents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quebec_vehicle_onboarding_vehicle_id_key" ON "quebec_vehicle_onboarding"("vehicle_id");

-- CreateIndex
CREATE INDEX "quebec_vehicle_onboarding_status_idx" ON "quebec_vehicle_onboarding"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tax_profiles_user_id_subject_type_key" ON "tax_profiles"("user_id", "subject_type");

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_user_id_fkey" FOREIGN KEY ("referee_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_fkey" FOREIGN KEY ("referrer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_accommodation_id_fkey" FOREIGN KEY ("accommodation_id") REFERENCES "accommodations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accommodations" ADD CONSTRAINT "accommodations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accommodation_media" ADD CONSTRAINT "accommodation_media_accommodation_id_fkey" FOREIGN KEY ("accommodation_id") REFERENCES "accommodations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_insights" ADD CONSTRAINT "host_insights_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_insights" ADD CONSTRAINT "host_insights_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_availability" ADD CONSTRAINT "listing_availability_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_media" ADD CONSTRAINT "listing_media_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_reviews" ADD CONSTRAINT "listing_reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_reviews" ADD CONSTRAINT "listing_reviews_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_reviews" ADD CONSTRAINT "listing_reviews_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_sales" ADD CONSTRAINT "seller_sales_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_sales" ADD CONSTRAINT "seller_sales_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_sales" ADD CONSTRAINT "seller_sales_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_reviews" ADD CONSTRAINT "seller_reviews_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_reviews" ADD CONSTRAINT "seller_reviews_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "seller_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_reviews" ADD CONSTRAINT "seller_reviews_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_documents" ADD CONSTRAINT "thread_documents_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_documents" ADD CONSTRAINT "thread_documents_uploader_user_id_fkey" FOREIGN KEY ("uploader_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_gifts" ADD CONSTRAINT "wallet_gifts_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_gifts" ADD CONSTRAINT "wallet_gifts_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_dropoff_location_id_fkey" FOREIGN KEY ("dropoff_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_pickup_location_id_fkey" FOREIGN KEY ("pickup_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_raised_by_user_id_fkey" FOREIGN KEY ("raised_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "ride_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_messages" ADD CONSTRAINT "ride_messages_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "ride_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_messages" ADD CONSTRAINT "ride_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_rated_user_id_fkey" FOREIGN KEY ("rated_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_rater_user_id_fkey" FOREIGN KEY ("rater_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "ride_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_cancellations" ADD CONSTRAINT "driver_cancellations_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_cancellations" ADD CONSTRAINT "driver_cancellations_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "ride_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_vehicles" ADD CONSTRAINT "driver_vehicles_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_user_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "ride_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_dest_garage_id_fkey" FOREIGN KEY ("dest_garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_origin_garage_id_fkey" FOREIGN KEY ("origin_garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_tariffs" ADD CONSTRAINT "route_tariffs_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_adjustments" ADD CONSTRAINT "tariff_adjustments_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_adjustments" ADD CONSTRAINT "tariff_adjustments_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_trips" ADD CONSTRAINT "service_trips_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_trips" ADD CONSTRAINT "service_trips_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_bookings" ADD CONSTRAINT "seat_bookings_service_trip_id_fkey" FOREIGN KEY ("service_trip_id") REFERENCES "service_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jurisdiction_compliance_profiles" ADD CONSTRAINT "jurisdiction_compliance_profiles_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_documents" ADD CONSTRAINT "listing_documents_legal_hold_set_by_id_fkey" FOREIGN KEY ("legal_hold_set_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_documents" ADD CONSTRAINT "listing_documents_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_documents" ADD CONSTRAINT "listing_documents_replaces_id_fkey" FOREIGN KEY ("replaces_id") REFERENCES "listing_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_documents" ADD CONSTRAINT "listing_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_xx_records" ADD CONSTRAINT "part_xx_records_filing_id_fkey" FOREIGN KEY ("filing_id") REFERENCES "part_xx_filings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_xx_records" ADD CONSTRAINT "part_xx_records_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_driver_documents" ADD CONSTRAINT "quebec_driver_documents_legal_hold_set_by_id_fkey" FOREIGN KEY ("legal_hold_set_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_driver_documents" ADD CONSTRAINT "quebec_driver_documents_onboarding_user_id_fkey" FOREIGN KEY ("onboarding_user_id") REFERENCES "quebec_driver_onboarding"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_driver_documents" ADD CONSTRAINT "quebec_driver_documents_replaces_id_fkey" FOREIGN KEY ("replaces_id") REFERENCES "quebec_driver_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_driver_documents" ADD CONSTRAINT "quebec_driver_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_driver_onboarding" ADD CONSTRAINT "quebec_driver_onboarding_assigned_reviewer_id_fkey" FOREIGN KEY ("assigned_reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_driver_onboarding" ADD CONSTRAINT "quebec_driver_onboarding_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_driver_onboarding" ADD CONSTRAINT "quebec_driver_onboarding_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "driver_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_vehicle_documents" ADD CONSTRAINT "quebec_vehicle_documents_legal_hold_set_by_id_fkey" FOREIGN KEY ("legal_hold_set_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_vehicle_documents" ADD CONSTRAINT "quebec_vehicle_documents_onboarding_vehicle_id_fkey" FOREIGN KEY ("onboarding_vehicle_id") REFERENCES "quebec_vehicle_onboarding"("vehicle_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_vehicle_documents" ADD CONSTRAINT "quebec_vehicle_documents_replaces_id_fkey" FOREIGN KEY ("replaces_id") REFERENCES "quebec_vehicle_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_vehicle_documents" ADD CONSTRAINT "quebec_vehicle_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_vehicle_onboarding" ADD CONSTRAINT "quebec_vehicle_onboarding_assigned_reviewer_id_fkey" FOREIGN KEY ("assigned_reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_vehicle_onboarding" ADD CONSTRAINT "quebec_vehicle_onboarding_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_vehicle_onboarding" ADD CONSTRAINT "quebec_vehicle_onboarding_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "driver_vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

