import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT QR (capsule)
//
// One reusable scan-to-pay QR renderer. Wraps `qrcode`'s toDataURL + the loading state so the exact
// same logic isn't copy-pasted across every payment surface (advertising, wallet, listing plan). Give
// it a payload string (build it with createPlatformPaymentQrPayload) and it renders the image, or a
// labelled loading placeholder while it generates. Pure UI — no money logic, no platform coupling.
// ─────────────────────────────────────────────────────────────────────────────
export function PaymentQr({
  payload,
  alt,
  generatingLabel,
  className = 'seller-sham-qr',
  loadingClassName = 'seller-sham-qr seller-sham-qr-loading',
  scale = 8,
}: {
  payload: string
  alt: string
  generatingLabel: string
  className?: string
  loadingClassName?: string
  scale?: number
}) {
  const [dataUrl, setDataUrl] = useState('')

  useEffect(() => {
    if (!payload) {
      setDataUrl('')
      return
    }
    let cancelled = false
    void QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale,
      color: { dark: '#07111f', light: '#f8fbff' },
    }).then((url) => {
      if (!cancelled) setDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [payload, scale])

  return dataUrl ? (
    <img className={className} src={dataUrl} alt={alt} />
  ) : (
    <div className={loadingClassName} aria-label={generatingLabel} />
  )
}
