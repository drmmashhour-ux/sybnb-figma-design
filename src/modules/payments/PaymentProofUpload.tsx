import type { Lang } from '../../engines/language/languageEngine'

type PaymentProofUploadProps = {
  lang: Lang
  files: string[]
  onAddFiles: (files: FileList | null) => void
  disabled?: boolean
  title?: string
  cta?: string
  help?: string
  emptyText?: string
}

const copy = {
  ar: {
    title: 'رفع مستندات إثبات الدفع',
    cta: 'اضغط لرفع إيصال الدفع أو صورة التحويل',
    help: 'PDF أو PNG أو JPG. يمكن رفع أكثر من ملف قبل الإرسال للإدارة.',
    files: 'الملفات المرفوعة',
    empty: 'لم يتم رفع أي ملف بعد. لا يمكن إرسال الدفع للإدارة قبل رفع الإثبات.',
    locked: 'أكّد المبلغ وافتح مسار الدفع أولاً، ثم يصبح الرفع متاحاً هنا.',
  },
  en: {
    title: 'Upload payment proof documents',
    cta: 'Tap to upload receipt or transfer screenshot',
    help: 'PDF, PNG, or JPG. Multiple files can be uploaded before sending to admin.',
    files: 'Uploaded files',
    empty: 'No files uploaded yet. Payment cannot be sent to admin before proof is uploaded.',
    locked: 'Confirm the amount and open the payment route first, then upload becomes available here.',
  },
}

export function paymentProofReference(prefix: string, files: string[]) {
  if (!files.length) return ''
  const safeFiles = files.map((fileName) => fileName.replace(/[^\p{L}\p{N}._@+\-() ]/gu, '_'))
  return `session://${prefix}/${safeFiles.join('+')}`
}

export function PaymentProofUpload({ lang, files, onAddFiles, disabled = false, title, cta, help, emptyText }: PaymentProofUploadProps) {
  const t = copy[lang === 'ar' ? 'ar' : 'en']

  return (
    <div className="payment-proof-upload">
      <div className="payment-proof-upload-header">
        <strong>{title || t.title}</strong>
        <p>{disabled ? t.locked : help || t.help}</p>
      </div>
      <label className={`payment-proof-dropzone ${disabled ? 'disabled' : ''}`}>
        <input
          accept=".pdf,.png,.jpg,.jpeg,image/png,image/jpeg,application/pdf"
          disabled={disabled}
          multiple
          type="file"
          onChange={(event) => onAddFiles(event.target.files)}
        />
        <span>{cta || t.cta}</span>
        <em>PDF · PNG · JPG</em>
      </label>
      <div className="payment-proof-file-list">
        <strong>{t.files}</strong>
        {files.length ? (
          <ul>
            {files.map((fileName, index) => (
              <li key={`${fileName}-${index}`}>
                <span>{index + 1}</span>
                <strong>{fileName}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p>{emptyText || t.empty}</p>
        )}
      </div>
    </div>
  )
}
