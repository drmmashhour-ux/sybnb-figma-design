CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE account_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');
CREATE TYPE role_name AS ENUM ('GUEST', 'HOST', 'SELLER', 'DRIVER', 'ADMIN', 'SUPPORT');
CREATE TYPE listing_status AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PAUSED');
CREATE TYPE listing_division AS ENUM ('STAYS', 'RENTALS', 'BUY', 'CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION');
CREATE TYPE booking_status AS ENUM ('DRAFT', 'REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'DISPUTED');
CREATE TYPE payment_status AS ENUM ('PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED', 'REJECTED', 'REFUNDED');
CREATE TYPE wallet_entry_type AS ENUM ('CREDIT', 'DEBIT', 'HOLD', 'RELEASE', 'REFUND');
CREATE TYPE gift_status AS ENUM ('CREATED', 'SENT', 'CLAIM_PENDING', 'CLAIMED', 'LOCKED', 'EXPIRED', 'ADMIN_BLOCKED');
CREATE TYPE ride_status AS ENUM ('DRAFT', 'REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  phone_hash text UNIQUE,
  password_hash text,
  display_name text NOT NULL,
  locale text NOT NULL DEFAULT 'ar-SY',
  status account_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role role_name NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
CREATE INDEX user_roles_role_idx ON user_roles(role);

CREATE TABLE seller_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  seller_type text NOT NULL,
  document_status listing_status NOT NULL DEFAULT 'DRAFT',
  plan_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE driver_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  license_hash text,
  vehicle_make text,
  vehicle_model text,
  vehicle_plate text,
  active boolean NOT NULL DEFAULT false,
  last_location_geo geometry(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_profiles_location_gix ON driver_profiles USING gist(last_location_geo);

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country text NOT NULL DEFAULT 'SY',
  governorate text NOT NULL,
  city text NOT NULL,
  area text,
  street text,
  address_line text,
  geo geometry(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locations_governorate_city_idx ON locations(governorate, city);
CREATE INDEX locations_geo_gix ON locations USING gist(geo);

CREATE TABLE listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  location_id uuid REFERENCES locations(id),
  division listing_division NOT NULL,
  title_ar text NOT NULL,
  title_en text,
  description text,
  status listing_status NOT NULL DEFAULT 'DRAFT',
  price_minor integer NOT NULL,
  currency text NOT NULL DEFAULT 'SYP',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listings_division_status_idx ON listings(division, status);
CREATE INDEX listings_owner_id_idx ON listings(owner_id);

CREATE TABLE listing_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url text NOT NULL,
  kind text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listing_media_listing_id_idx ON listing_media(listing_id);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id),
  guest_id uuid NOT NULL REFERENCES users(id),
  status booking_status NOT NULL DEFAULT 'REQUESTED',
  check_in timestamptz,
  check_out timestamptz,
  amount_minor integer NOT NULL,
  currency text NOT NULL DEFAULT 'SYP',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bookings_guest_status_idx ON bookings(guest_id, status);
CREATE INDEX bookings_listing_status_idx ON bookings(listing_id, status);

CREATE TABLE payment_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id),
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL,
  status payment_status NOT NULL DEFAULT 'PENDING_PROOF',
  amount_minor integer NOT NULL,
  currency text NOT NULL DEFAULT 'SYP',
  proof_asset_url text,
  provider_ref text,
  admin_note text,
  reviewed_by_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_proofs_status_created_idx ON payment_proofs(status, created_at);
CREATE INDEX payment_proofs_user_id_idx ON payment_proofs(user_id);

CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'SYP',
  cached_balance_minor integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, currency)
);

CREATE TABLE wallet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  type wallet_entry_type NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'SYP',
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_entries_wallet_created_idx ON wallet_entries(wallet_id, created_at);
CREATE INDEX wallet_entries_reference_idx ON wallet_entries(reference_type, reference_id);

CREATE TABLE wallet_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id uuid NOT NULL REFERENCES users(id),
  recipient_user_id uuid REFERENCES users(id),
  recipient_phone_hash text NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'SYP',
  message text,
  status gift_status NOT NULL DEFAULT 'CREATED',
  claim_attempt_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_gifts_recipient_status_idx ON wallet_gifts(recipient_phone_hash, status);
CREATE INDEX wallet_gifts_sender_created_idx ON wallet_gifts(sender_user_id, created_at);

CREATE TABLE otp_attempt_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL,
  subject_hash text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purpose, subject_hash)
);

CREATE TABLE ride_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES users(id),
  driver_id uuid REFERENCES users(id),
  pickup_location_id uuid REFERENCES locations(id),
  dropoff_location_id uuid REFERENCES locations(id),
  status ride_status NOT NULL DEFAULT 'REQUESTED',
  requested_at timestamptz NOT NULL DEFAULT now(),
  fare_minor integer,
  currency text NOT NULL DEFAULT 'SYP',
  pickup_geo geometry(Point, 4326),
  dropoff_geo geometry(Point, 4326),
  metadata jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_requests_status_requested_idx ON ride_requests(status, requested_at);
CREATE INDEX ride_requests_driver_status_idx ON ride_requests(driver_id, status);
CREATE INDEX ride_requests_pickup_geo_gix ON ride_requests USING gist(pickup_geo);
CREATE INDEX ride_requests_dropoff_geo_gix ON ride_requests USING gist(dropoff_geo);

CREATE TABLE admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  before jsonb,
  after jsonb,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_logs_entity_idx ON admin_audit_logs(entity_type, entity_id, created_at);
CREATE INDEX admin_audit_logs_actor_idx ON admin_audit_logs(actor_user_id, created_at);
