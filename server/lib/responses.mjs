export function json(res, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body, null, 2)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(payload)
}

export function notFound(res) {
  json(res, 404, {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: 'No V6 API route matched this request.',
    },
  })
}

export function methodNotAllowed(res, allowed) {
  json(
    res,
    405,
    {
      ok: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: `Use ${allowed.join(', ')} for this endpoint.`,
      },
    },
    { allow: allowed.join(', ') },
  )
}

// Cap request bodies so a few large (or malicious) uploads can't pin function memory. 20MB comfortably
// covers the biggest legit payload: an 8–12MB image/document sent as base64 (~16MB) plus JSON overhead.
const MAX_JSON_BODY_BYTES = 20 * 1024 * 1024

function payloadTooLargeError() {
  const error = new Error('Request body is too large.')
  error.statusCode = 413
  error.code = 'PAYLOAD_TOO_LARGE'
  error.expose = true
  return error
}

export async function readJson(req) {
  const declaredLength = Number(req.headers?.['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) throw payloadTooLargeError()

  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_JSON_BODY_BYTES) throw payloadTooLargeError()
    chunks.push(chunk)
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch {
    const error = new Error('Request body must be valid JSON.')
    error.statusCode = 400
    error.code = 'INVALID_JSON'
    throw error
  }
}

export function handleRouteError(res, error) {
  if (!error.statusCode || error.statusCode >= 500) {
    console.error('[api:error]', error)
  }

  // Only error.expose === true gates whether the client sees the real message. A statusCode
  // alone used to be enough to leak error.message (see the security audit, finding F-15) — that
  // let any code path that set a statusCode without deliberately opting into exposure leak
  // internal details (e.g. a raw Prisma error message revealing column names) by accident rather
  // than by design.
  json(res, error.statusCode || 500, {
    ok: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.expose === true ? error.message : 'Unexpected V6 API error.',
      // Structured, machine-readable detail (e.g. the exact missing attribute labels) rides the same
      // exposure gate as the message: only surfaced when the throwing code deliberately opted in with
      // error.expose === true, so it can never leak internal shape by accident.
      ...(error.expose === true && error.details ? { details: error.details } : {}),
    },
  })
}

export function publicUrl(req) {
  const host = req.headers.host || '127.0.0.1'
  return new URL(req.url || '/', `http://${host}`)
}
