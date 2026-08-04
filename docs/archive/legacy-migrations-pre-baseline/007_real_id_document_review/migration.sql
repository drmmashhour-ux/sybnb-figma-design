CREATE TYPE id_document_status AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document_mime_type text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document_status id_document_status;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document_reviewed_by_id uuid;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document_reviewed_at timestamptz;
