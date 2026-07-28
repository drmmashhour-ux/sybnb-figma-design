// SMS delivery — provider-agnostic, so the platform is not locked to one gateway. Configure via env in
// production; in dev/test the code is returned to the caller (devCode) instead of sent, exactly like the
// email path, so QA and automated tests never depend on a live SMS account.
//
//   SMS_PROVIDER=http    SMS_GATEWAY_URL=https://...   SMS_API_KEY=...   (a generic HTTP gateway — works
//                                                                        with most local/regional SMS
//                                                                        providers and custom endpoints)
//   SMS_PROVIDER=twilio  TWILIO_ACCOUNT_SID=...  TWILIO_AUTH_TOKEN=...  TWILIO_FROM=+...
//
// To add another provider, extend the switch in sendVerificationCodeSms — nothing else changes.

export function isSmsConfigured() {
  const provider = process.env.SMS_PROVIDER
  if (provider === 'twilio') {
    return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM)
  }
  if (provider === 'http') {
    return Boolean(process.env.SMS_GATEWAY_URL)
  }
  return false
}

export async function sendVerificationCodeSms(phone, code) {
  const message = `Your SYBNB verification code is ${code}. It expires in 10 minutes.`
  const provider = process.env.SMS_PROVIDER

  if (provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      signal: AbortSignal.timeout(8000), // bound the call so a hung provider can't burn the 30s budget
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, From: process.env.TWILIO_FROM, Body: message }),
    })
    if (!res.ok) throw new Error(`Twilio SMS send failed: HTTP ${res.status}`)
    return
  }

  if (provider === 'http') {
    const res = await fetch(process.env.SMS_GATEWAY_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(8000), // bound the call so a hung provider can't burn the 30s budget
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SMS_API_KEY ? { Authorization: `Bearer ${process.env.SMS_API_KEY}` } : {}),
      },
      body: JSON.stringify({ to: phone, message }),
    })
    if (!res.ok) throw new Error(`SMS gateway send failed: HTTP ${res.status}`)
    return
  }

  throw new Error('No SMS provider is configured (set SMS_PROVIDER).')
}
