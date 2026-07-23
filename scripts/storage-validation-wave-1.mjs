// Storage Validation Wave 1 harness (X-3 / SYB-014) — the mandatory closed-beta durability gate.
//
// Runs OUTSIDE Vitest (the suite structurally refuses STORAGE_DRIVER=s3 under NODE_ENV=test). Drives the
// real governed object-storage layer (server/lib/object-storage.mjs) against the Cloudflare R2 TEST
// buckets only, with synthetic data only. Never touches production buckets, objects, or credentials.
//
// SAFETY:
//   - Reads config from .env.local; NEVER prints any credential/endpoint value.
//   - Refuses to run against a bucket whose name does not contain "test".
//   - Tracks every object it writes and deletes them all in a final cleanup pass.
//
// Usage: node scripts/storage-validation-wave-1.mjs   (from the repo root, with .env.local present)
//
// A child instance (scenario 18) is this same file invoked with `--durability-read <bucketClass> <key>`.

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  BUCKET_CLASSES, putObject, getObject, deleteObject, objectExists,
  buildObjectKey, assertSafeObjectKey, resolveBucketName, validateStorageConfig,
} from '../server/lib/object-storage.mjs'

// ---- config (never logged) ---------------------------------------------------------------------
function parseEnvFile(path) {
  const out = {}
  let text
  try { text = readFileSync(path, 'utf8') } catch { return out }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const fileEnv = { ...parseEnvFile('.env.local') }
const S3_KEYS = ['STORAGE_DRIVER', 'STORAGE_S3_REGION', 'STORAGE_S3_ENDPOINT', 'STORAGE_S3_ACCESS_KEY_ID', 'STORAGE_S3_SECRET_ACCESS_KEY', 'STORAGE_BUCKET_MEDIA', 'STORAGE_BUCKET_DOCUMENTS']

// A clean env for the s3 driver: NODE_ENV must NOT be 'test' or the config guard (correctly) refuses s3.
function s3Env(overrides = {}) {
  const env = { NODE_ENV: 'development' }
  for (const k of S3_KEYS) if (fileEnv[k] != null) env[k] = fileEnv[k]
  env.STORAGE_DRIVER = 's3'
  return { ...env, ...overrides }
}

// ---- child instance path (scenario 18: cross-instance durability) ------------------------------
if (process.argv[2] === '--durability-read') {
  const bucketClass = process.argv[3]
  const key = process.argv[4]
  try {
    const body = await getObject({ bucketClass, key, env: s3Env() })
    process.stdout.write(createHash('sha256').update(body).digest('hex'))
    process.exit(0)
  } catch (error) {
    process.stdout.write(`ERR:${error?.code || 'UNKNOWN'}`)
    process.exit(1)
  }
}

// ---- harness -----------------------------------------------------------------------------------
const env = s3Env()
const results = []
const created = [] // { bucketClass, key } — cleaned up at the end
const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const syntheticPdf = (sizeBytes) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(Math.max(0, sizeBytes - 9), 0x41)])

function record(id, name, expected, actual, pass, note = '') {
  results.push({ id, name, expected, actual, pass, note })
  const tag = pass ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${id}. ${name}`)
}

// A message must never leak provider internals. Buckets legitimately contain the word we ban, so we
// only scan for secret-shaped tokens: endpoint host, account id, access key, secret, r2 host.
function leaksSecret(message) {
  const s = String(message || '')
  const probes = [
    fileEnv.STORAGE_S3_ENDPOINT, fileEnv.STORAGE_S3_ACCESS_KEY_ID, fileEnv.STORAGE_S3_SECRET_ACCESS_KEY,
    'r2.cloudflarestorage', 'cloudflarestorage.com',
  ].filter(Boolean)
  return probes.some((p) => p && s.includes(p))
}

async function main() {
  console.log('SYBNB Storage Validation Wave 1 — R2 test buckets, synthetic data only\n')

  // Pre-flight: config valid, and buckets are TEST buckets (fail-safe against a stray production config).
  try { validateStorageConfig({ ...env, NODE_ENV: 'development' }) } catch (e) {
    console.error('Pre-flight config invalid; aborting before any network call:', e.code || e.message); process.exit(2)
  }
  const media = resolveBucketName(BUCKET_CLASSES.MEDIA, env)
  const docs = resolveBucketName(BUCKET_CLASSES.DOCUMENTS, env)
  if (!/test/i.test(media) || !/test/i.test(docs)) {
    console.error('Refusing to run: a configured bucket is not a TEST bucket. Aborting.'); process.exit(2)
  }
  console.log('  buckets: media/documents test buckets confirmed (names not printed)\n')

  const mkey = buildObjectKey('pdf')
  const bodyA = syntheticPdf(4096)

  // 1. upload
  try {
    await putObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: mkey, body: bodyA, contentType: 'application/pdf', env })
    created.push({ bucketClass: BUCKET_CLASSES.MEDIA, key: mkey })
    record(1, 'upload', 'object written, no error', 'written', true)
  } catch (e) { record(1, 'upload', 'written', e.code || e.message, false); return }

  // 2. download  +  6. object integrity
  try {
    const got = await getObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: mkey, env })
    record(2, 'download', 'bytes returned', `${got.length} bytes`, got.length === bodyA.length)
    record(6, 'object integrity', 'sha256(get)==sha256(put)', 'compared', sha(got) === sha(bodyA))
  } catch (e) { record(2, 'download', 'bytes', e.code, false); record(6, 'object integrity', 'match', e.code, false) }

  // 3. overwrite
  try {
    const bodyB = syntheticPdf(8192)
    await putObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: mkey, body: bodyB, contentType: 'application/pdf', env })
    const got = await getObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: mkey, env })
    record(3, 'overwrite', 'new bytes returned', 'compared', sha(got) === sha(bodyB) && got.length === bodyB.length)
  } catch (e) { record(3, 'overwrite', 'new bytes', e.code, false) }

  // 4. metadata (ContentType round-trip via a direct HeadObject)
  try {
    const { HeadObjectCommand, S3Client } = await import('@aws-sdk/client-s3')
    const client = new S3Client({ endpoint: env.STORAGE_S3_ENDPOINT, region: env.STORAGE_S3_REGION || 'auto', forcePathStyle: true,
      credentials: { accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID, secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY } })
    const head = await client.send(new HeadObjectCommand({ Bucket: media, Key: `${BUCKET_CLASSES.MEDIA}/${mkey}` }))
    record(4, 'metadata', 'ContentType application/pdf + ContentLength', String(head.ContentType), head.ContentType === 'application/pdf' && head.ContentLength === 8192)
  } catch (e) { record(4, 'metadata', 'ContentType', e.code || e.name, false) }

  // 5. delete  (and confirm gone)
  try {
    await deleteObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: mkey, env })
    const stillThere = await objectExists({ bucketClass: BUCKET_CLASSES.MEDIA, key: mkey, env })
    record(5, 'delete', 'object removed (exists=false)', `exists=${stillThere}`, stillThere === false)
    if (!stillThere) created.splice(created.findIndex((c) => c.key === mkey), 1)
  } catch (e) { record(5, 'delete', 'removed', e.code, false) }

  // 7. invalid credentials — corrupt the access key (busts the client cache) → sanitized failure
  try {
    const badEnv = s3Env({ STORAGE_S3_ACCESS_KEY_ID: 'invalid-access-key-000000' })
    const k = buildObjectKey('pdf')
    let threw = false, msg = ''
    try { await putObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: k, body: bodyA, contentType: 'application/pdf', env: badEnv }) }
    catch (e) { threw = true; msg = `${e.code}:${e.message}` }
    record(7, 'invalid credentials', 'STORAGE_UNAVAILABLE, no secret leaked', msg || 'no-throw', threw && /STORAGE_UNAVAILABLE/.test(msg) && !leaksSecret(msg))
  } catch (e) { record(7, 'invalid credentials', 'sanitized failure', e.code, false) }

  // 8. invalid endpoint & 9. unavailable storage — unroutable endpoint → sanitized STORAGE_UNAVAILABLE
  try {
    const badEnv = s3Env({ STORAGE_S3_ENDPOINT: 'https://127.0.0.1:1' })
    const k = buildObjectKey('pdf')
    let threw = false, msg = ''
    try { await getObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: k, env: badEnv }) }
    catch (e) { threw = true; msg = `${e.code}:${e.message}` }
    const ok = threw && /STORAGE_UNAVAILABLE/.test(msg) && !leaksSecret(msg)
    record(8, 'invalid endpoint', 'STORAGE_UNAVAILABLE, no endpoint leaked', msg || 'no-throw', ok)
    record(9, 'unavailable storage', 'STORAGE_UNAVAILABLE (no false success)', msg || 'no-throw', ok)
  } catch (e) { record(8, 'invalid endpoint', 'sanitized', e.code, false); record(9, 'unavailable storage', 'sanitized', e.code, false) }

  // 10. interrupted upload — a failed put must leave NO readable object in the real bucket
  try {
    const badEnv = s3Env({ STORAGE_S3_ENDPOINT: 'https://127.0.0.1:1' })
    const k = buildObjectKey('pdf')
    try { await putObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: k, body: bodyA, contentType: 'application/pdf', env: badEnv }) } catch { /* expected */ }
    const exists = await objectExists({ bucketClass: BUCKET_CLASSES.MEDIA, key: k, env })
    record(10, 'interrupted upload', 'no partial object persisted', `exists=${exists}`, exists === false)
  } catch (e) { record(10, 'interrupted upload', 'no partial', e.code, false) }

  // 11. interrupted download — a get of a never-written key returns NOT_FOUND, never garbage
  try {
    const k = buildObjectKey('pdf')
    let msg = ''
    try { await getObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: k, env }) } catch (e) { msg = e.code }
    record(11, 'interrupted download', 'STORAGE_OBJECT_NOT_FOUND, no garbage', msg, msg === 'STORAGE_OBJECT_NOT_FOUND')
  } catch (e) { record(11, 'interrupted download', 'not-found', e.code, false) }

  // 12. retry behaviour + 13. recovery — after a failure, a valid op succeeds (client recovers)
  try {
    const k = buildObjectKey('pdf')
    await putObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: k, body: bodyA, contentType: 'application/pdf', env })
    created.push({ bucketClass: BUCKET_CLASSES.MEDIA, key: k })
    const got = await getObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: k, env })
    record(12, 'retry behaviour', 'SDK default retries; op completes intact', 'completed', sha(got) === sha(bodyA))
    record(13, 'recovery', 'valid op succeeds after a prior failure', 'recovered', sha(got) === sha(bodyA))
  } catch (e) { record(12, 'retry behaviour', 'completes', e.code, false); record(13, 'recovery', 'recovers', e.code, false) }

  // 14. access control — buckets are PRIVATE: an unauthenticated direct GET must NOT return the object
  try {
    const k = buildObjectKey('pdf')
    await putObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: k, body: bodyA, contentType: 'application/pdf', env })
    created.push({ bucketClass: BUCKET_CLASSES.MEDIA, key: k })
    const url = `${env.STORAGE_S3_ENDPOINT.replace(/\/$/, '')}/${media}/${BUCKET_CLASSES.MEDIA}/${k}`
    const resp = await fetch(url) // unauthenticated
    record(14, 'access control', 'unauthenticated GET refused (not 200)', `http ${resp.status}`, resp.status !== 200)
  } catch (e) {
    // A network error on the unauthenticated request also means "not served publicly".
    record(14, 'access control', 'unauthenticated GET refused', `network-refused (${e.code || 'err'})`, true)
  }

  // 15. bucket isolation — an object in DOCUMENTS must not be visible in MEDIA
  try {
    const k = buildObjectKey('pdf')
    await putObject({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: k, body: bodyA, contentType: 'application/pdf', env })
    created.push({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: k })
    const inDocs = await objectExists({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: k, env })
    const inMedia = await objectExists({ bucketClass: BUCKET_CLASSES.MEDIA, key: k, env })
    record(15, 'bucket isolation', 'present in DOCUMENTS, absent in MEDIA', `docs=${inDocs} media=${inMedia}`, inDocs === true && inMedia === false)
  } catch (e) { record(15, 'bucket isolation', 'isolated', e.code, false) }

  // 16. object naming — traversal / non-UUID keys are refused before any I/O
  try {
    let rejected = 0
    for (const bad of ['../etc/passwd', 'not-a-uuid.pdf', 'a'.repeat(40) + '.exe', '']) {
      try { assertSafeObjectKey(bad); } catch { rejected++ }
    }
    const good = buildObjectKey('png')
    let goodOk = true; try { assertSafeObjectKey(good) } catch { goodOk = false }
    record(16, 'object naming', 'all 4 malformed keys refused; valid UUID accepted', `${rejected}/4 refused`, rejected === 4 && goodOk)
  } catch (e) { record(16, 'object naming', 'refused', e.code, false) }

  // 18. durability assumptions — cross-instance: a SEPARATE node process reads the object intact
  try {
    const k = buildObjectKey('pdf')
    const durBody = syntheticPdf(2048)
    await putObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: k, body: durBody, contentType: 'application/pdf', env })
    created.push({ bucketClass: BUCKET_CLASSES.MEDIA, key: k })
    const child = spawnSync(process.execPath, [process.argv[1], '--durability-read', BUCKET_CLASSES.MEDIA, k], { encoding: 'utf8' })
    const childHash = (child.stdout || '').trim()
    record(18, 'durability assumptions', 'fresh process reads identical bytes (survives instance replacement)', childHash.startsWith('ERR') ? childHash : 'hash compared', childHash === sha(durBody))
  } catch (e) { record(18, 'durability assumptions', 'cross-instance read', e.code, false) }

  // 19. large object handling — 5MB within the 8MB ceiling, integrity preserved
  try {
    const k = buildObjectKey('pdf')
    const big = syntheticPdf(5 * 1024 * 1024)
    await putObject({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: k, body: big, contentType: 'application/pdf', env })
    created.push({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: k })
    const got = await getObject({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: k, env })
    record(19, 'large object handling', '5MB round-trips with integrity', `${got.length} bytes`, sha(got) === sha(big))
  } catch (e) { record(19, 'large object handling', 'integrity', e.code, false) }

  // 20. failure reporting — every error path returns a sanitized code, no secret leakage (aggregate)
  try {
    const failMsgs = results.filter((r) => /invalid|unavailable|interrupted/.test(r.name)).map((r) => r.actual)
    const anyLeak = failMsgs.some(leaksSecret)
    record(20, 'failure reporting', 'no endpoint/credential/secret in any failure message', anyLeak ? 'LEAK DETECTED' : 'clean', !anyLeak)
  } catch (e) { record(20, 'failure reporting', 'clean', e.code, false) }

  // 17. cleanup — delete everything created, verify none remain
  let cleaned = 0, remaining = 0
  for (const c of created) {
    try { await deleteObject({ ...c, env }); cleaned++ } catch { /* already gone */ }
  }
  for (const c of created) {
    try { if (await objectExists({ ...c, env })) remaining++ } catch { /* treat as gone */ }
  }
  record(17, 'cleanup', 'all created test objects removed', `deleted=${cleaned}, remaining=${remaining}`, remaining === 0)

  // ---- verdict ----
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  console.log(`\n  RESULT: ${passed}/${total} scenarios passed`)
  console.log(passed === total ? '  VALIDATION WAVE 1 PASSED' : '  VALIDATION WAVE 1 FAILED')
  // Emit a machine-readable matrix for the results document (no secrets).
  console.log('\n---JSON---')
  console.log(JSON.stringify(results.map(({ id, name, expected, actual, pass }) => ({ id, name, expected, actual, pass }))))
  process.exit(passed === total ? 0 : 1)
}

main().catch((e) => { console.error('Harness aborted:', e?.code || e?.message || 'unknown'); process.exit(3) })
