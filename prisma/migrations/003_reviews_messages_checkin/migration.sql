-- Phase 1: guest check-in/out confirmation (informational, does not touch booking_status)
ALTER TABLE bookings
  ADD COLUMN guest_checked_in_at timestamptz,
  ADD COLUMN guest_checked_out_at timestamptz;

-- Phase 2: guest reviews (auto-published, reactive admin hide)
CREATE TABLE listing_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES users(id),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  hidden_at timestamptz,
  hidden_by_admin_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listing_reviews_listing_id_hidden_at_idx ON listing_reviews (listing_id, hidden_at);

-- Phase 4: support messaging (thread per booking)
CREATE TYPE message_sender_role AS ENUM ('GUEST', 'HOST', 'ADMIN', 'SUPPORT');

CREATE TABLE message_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES users(id),
  sender_role message_sender_role NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_thread_id_created_at_idx ON messages (thread_id, created_at);

-- Phase 5: guest ID document reference (session:// pseudo-URL, matching the payment-proof pattern)
ALTER TABLE users
  ADD COLUMN id_document_ref text,
  ADD COLUMN id_document_submitted_at timestamptz;
