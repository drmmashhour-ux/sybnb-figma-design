// Runs before every other setup file and before any test file is imported for the database-
// backed Vitest config (vitest.config.ts, covering test/api and test/security). Loads .env.test
// — never .env — and fails loudly if it's missing, rather than silently letting
// server/index.mjs's own loadEnv('.env') populate DATABASE_URL from the development environment.
import '../../scripts/require-test-env.mjs'

// Then reset the isolated test database to a blank slate before this run's first test. Combined
// with test/support/testServer.mjs's unique-per-run id generation, this makes two consecutive
// full suite runs produce identical results — not just "no collisions" but "provably starting
// from the same empty state" — which is what proves repeatability rather than merely hoping for
// it. resetTestDatabase() re-validates the safety guard itself; this is not this file's only
// protection.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resetTestDatabase } from './resetTestDatabase.mjs'
import { seedApprovedJurisdictions } from './seedApprovedJurisdictions.mjs'

// Object storage (ADR-0010): pin the suite to the local filesystem driver in a throwaway temp
// directory, unconditionally. Assigned here rather than read from .env.test so that the suite is
// runnable with just `npm ci` and — more importantly — so a real STORAGE_S3_* credential sitting in
// a developer's shell can never be picked up and used to read or write a live R2 bucket. The driver
// itself refuses `s3` under NODE_ENV=test as well (server/lib/object-storage.mjs); this is the
// belt to that braces.
process.env.STORAGE_DRIVER = 'local'
process.env.STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), 'sybnb-test-objects-'))
delete process.env.STORAGE_S3_ENDPOINT
delete process.env.STORAGE_S3_ACCESS_KEY_ID
delete process.env.STORAGE_S3_SECRET_ACCESS_KEY

// SYB-008: the SR/Ride and other-division test suites drive gated APIs directly. The closed-beta
// division gate is enforced in beta/production but relaxed here under this EXPLICIT test flag, so the
// existing division suites keep passing. The division-isolation test unsets it to prove enforcement.
process.env.CLOSED_BETA_ALLOW_GATED_ROUTES = '1'

await resetTestDatabase()
// Jurisdiction compliance (026) fail-closes STR/SR by default -- every existing test fixture
// implicitly assumes "the market is fine, test the feature," so seed Syria as APPROVED here.
// Tests that specifically exercise the jurisdiction gate itself override this per-test.
await seedApprovedJurisdictions()
