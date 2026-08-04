-- Separate link table keeps internal payment-proof ids out of public Listing payloads. Unique proof_id
-- makes one approved plan consumable at most once; listing_id makes one plan mandatory per new listing.
CREATE TABLE "str_plan_consumptions" (
  "listing_id" TEXT NOT NULL,
  "proof_id" TEXT NOT NULL,
  "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "str_plan_consumptions_pkey" PRIMARY KEY ("listing_id")
);
CREATE UNIQUE INDEX "str_plan_consumptions_proof_id_key" ON "str_plan_consumptions"("proof_id");
ALTER TABLE "str_plan_consumptions" ADD CONSTRAINT "str_plan_consumptions_listing_id_fkey"
  FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "str_plan_consumptions" ADD CONSTRAINT "str_plan_consumptions_proof_id_fkey"
  FOREIGN KEY ("proof_id") REFERENCES "payment_proofs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve historical consumption semantics by pairing each host's oldest approved plan with their
-- oldest existing STAYS listing. Extra plans remain unused; extra legacy listings remain nullable.
WITH ranked_plans AS (
  SELECT id, user_id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) AS rn
  FROM payment_proofs
  WHERE provider = 'str_host_plan' AND status = 'APPROVED'
), ranked_listings AS (
  SELECT id, owner_id, ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at, id) AS rn
  FROM listings
  WHERE division = 'STAYS'
)
INSERT INTO str_plan_consumptions (listing_id, proof_id)
SELECT rl.id, p.id
FROM ranked_listings rl
JOIN ranked_plans p ON p.user_id = rl.owner_id AND p.rn = rl.rn;
