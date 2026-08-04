ALTER TYPE listing_status ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS expires_at timestamptz;
