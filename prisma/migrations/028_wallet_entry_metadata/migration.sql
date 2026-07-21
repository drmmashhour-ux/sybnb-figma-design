-- SR commission (028): structured calculation-breakdown context per wallet entry (e.g. the
-- progressive commission tier applied at ride settlement). Additive, defaults to {} so every
-- existing row and every existing recordWalletEntry caller is unaffected.
ALTER TABLE "wallet_entries" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';
