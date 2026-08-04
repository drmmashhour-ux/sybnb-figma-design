// READ-ONLY production-database diagnostic for the P1 launch gate.
//
// SAFETY: this script issues ONLY SELECTs (information_schema / pg_catalog). It never writes, never
// runs a migration, never touches data. It opens ONE connection, reads metadata, and prints a report.
//
// USAGE (run by the database owner; the connection string never leaves their shell):
//   DATABASE_URL="<PROD_OR_STAGING_URL>" node scripts/prod-db-diagnose.mjs
//
// Then ALSO capture the full schema delta (also read-only — --script prints SQL, does NOT execute it):
//   DATABASE_URL="<PROD_URL>" npx prisma migrate diff \
//     --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script > prod-vs-schema.sql
//
// Return BOTH this script's stdout AND prod-vs-schema.sql. Do not paste the connection string.

import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()
const out = {}
const q = async (label, sql) => {
  try {
    out[label] = await p.$queryRawUnsafe(sql)
  } catch (e) {
    out[label] = { error: e.message }
  }
}

try {
  // 0. Who/where (no secrets — just db name + server version + postgis presence)
  await q('server', `SELECT current_database() AS db, current_user AS usr, version() AS version`)
  await q('extensions', `SELECT extname FROM pg_extension ORDER BY extname`)

  // 1. THE B1 CRUX: are id / *_id columns uuid or text? (a split proves the old uuid lineage)
  await q(
    'id_column_type_distribution',
    `SELECT data_type, count(*)::int AS columns
       FROM information_schema.columns
      WHERE table_schema='public' AND (column_name='id' OR column_name LIKE '%\\_id')
      GROUP BY data_type ORDER BY columns DESC`,
  )
  await q(
    'key_table_id_types',
    `SELECT table_name, data_type
       FROM information_schema.columns
      WHERE table_schema='public' AND column_name='id'
        AND table_name IN ('users','listings','bookings','wallets','wallet_entries','payment_proofs','ride_requests','disputes','seller_sales')
      ORDER BY table_name`,
  )

  // 2. Migration tracking state (what Prisma thinks is applied)
  await q(
    'prisma_migrations',
    `SELECT migration_name, (finished_at IS NOT NULL) AS finished, (rolled_back_at IS NOT NULL) AS rolled_back
       FROM _prisma_migrations ORDER BY started_at`,
  )

  // 3. Object inventory (counts + names) so extra/missing objects vs the repo baseline are visible
  await q('base_table_count', `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`)
  await q('base_tables', `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)
  await q('enum_types', `SELECT t.typname AS enum FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e' ORDER BY t.typname`)
  await q('foreign_key_count', `SELECT count(*)::int AS n FROM information_schema.table_constraints WHERE constraint_schema='public' AND constraint_type='FOREIGN KEY'`)
  await q('index_count', `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='public'`)

  // 4. FK type-compatibility scan: any FK whose child/parent column types differ would FAIL to apply
  //    on a fresh build (this is exactly the text->uuid class that caused B1). Empty = healthy.
  await q(
    'incompatible_fk_type_pairs',
    `SELECT tc.table_name AS child_table, kcu.column_name AS child_col, c1.data_type AS child_type,
            ccu.table_name AS parent_table, ccu.column_name AS parent_col, c2.data_type AS parent_type
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema
       JOIN information_schema.columns c1 ON c1.table_schema=tc.table_schema AND c1.table_name=tc.table_name AND c1.column_name=kcu.column_name
       JOIN information_schema.columns c2 ON c2.table_schema=ccu.table_schema AND c2.table_name=ccu.table_name AND c2.column_name=ccu.column_name
      WHERE tc.constraint_type='FOREIGN KEY' AND tc.constraint_schema='public' AND c1.data_type <> c2.data_type`,
  )

  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2))
} finally {
  await p.$disconnect()
}
