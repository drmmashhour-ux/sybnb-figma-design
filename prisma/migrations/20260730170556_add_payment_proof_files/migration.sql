-- CreateTable
CREATE TABLE "payment_proof_files" (
    "id" TEXT NOT NULL,
    "proof_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_proof_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_proof_files_proof_id_key" ON "payment_proof_files"("proof_id");

-- AddForeignKey
ALTER TABLE "payment_proof_files" ADD CONSTRAINT "payment_proof_files_proof_id_fkey" FOREIGN KEY ("proof_id") REFERENCES "payment_proofs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
