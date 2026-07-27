-- SR SAFETY layer: SOS events + live location + trip-share token.
-- PostGIS + pgcrypto already enabled by migration 001. Hand-written because last_location_geo is a
-- PostGIS geometry column that Prisma emits as Unsupported(...).

-- Enums
CREATE TYPE sos_role AS ENUM ('RIDER', 'DRIVER');
CREATE TYPE sos_status AS ENUM ('OPEN', 'RESOLVED');

-- RideRequest additions
ALTER TABLE ride_requests
  ADD COLUMN last_location_geo geometry(Point, 4326),
  ADD COLUMN last_location_at timestamptz,
  ADD COLUMN share_token text,
  ADD COLUMN share_token_created_at timestamptz;

CREATE UNIQUE INDEX ride_requests_share_token_key ON ride_requests (share_token);
CREATE INDEX ride_requests_last_location_geo_gix ON ride_requests USING gist (last_location_geo);

-- SosEvent table
CREATE TABLE sos_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES ride_requests (id) ON DELETE CASCADE,
  raised_by_user_id uuid NOT NULL REFERENCES users (id),
  raised_by_role sos_role NOT NULL,
  lat double precision,
  lng double precision,
  note text,
  status sos_status NOT NULL DEFAULT 'OPEN',
  resolved_by_id uuid REFERENCES users (id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sos_events_status_created_at_idx ON sos_events (status, created_at);
CREATE INDEX sos_events_ride_id_idx ON sos_events (ride_id);
