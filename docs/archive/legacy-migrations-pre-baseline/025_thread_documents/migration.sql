-- Thread documents (025): real per-thread file uploads, replacing the previous behavior where
-- "uploading" a Rentals/Buy request document only captured the filename and pasted it into a
-- chat message -- the actual bytes were never stored anywhere.

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

CREATE INDEX "thread_documents_thread_id_created_at_idx" ON "thread_documents"("thread_id", "created_at");

ALTER TABLE "thread_documents" ADD CONSTRAINT "thread_documents_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thread_documents" ADD CONSTRAINT "thread_documents_uploader_user_id_fkey" FOREIGN KEY ("uploader_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
