// Global Vitest setup: raises the login/register rate limits for the whole run so functional
// tests that legitimately call these endpoints several times (register + login + duplicate +
// invalid-field variants across multiple files) don't trip F-08's limiter as a side effect.
// Rate-limit enforcement itself is exercised deliberately, with its own narrow per-test
// overrides, in test/security/rate-limit-http.test.mjs and test/unit/rate-limit.test.mjs.
process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '1000'
process.env.RATE_LIMIT_AUTH_REGISTER_MAX = '1000'
