-- Marketplace seller reputation (Block 3): seller-confirmed sales gate buyer reviews.
CREATE TABLE "seller_sales" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seller_sales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_sales_listing_id_buyer_id_key" ON "seller_sales"("listing_id", "buyer_id");
CREATE INDEX "seller_sales_seller_id_idx" ON "seller_sales"("seller_id");

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

CREATE UNIQUE INDEX "seller_reviews_sale_id_key" ON "seller_reviews"("sale_id");
CREATE INDEX "seller_reviews_seller_id_hidden_at_idx" ON "seller_reviews"("seller_id", "hidden_at");

ALTER TABLE "seller_sales" ADD CONSTRAINT "seller_sales_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_sales" ADD CONSTRAINT "seller_sales_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_sales" ADD CONSTRAINT "seller_sales_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_reviews" ADD CONSTRAINT "seller_reviews_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "seller_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_reviews" ADD CONSTRAINT "seller_reviews_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_reviews" ADD CONSTRAINT "seller_reviews_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
