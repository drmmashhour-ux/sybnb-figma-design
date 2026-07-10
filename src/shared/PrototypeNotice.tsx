/**
 * PrototypeNotice — shared reusable disclaimer component
 * Place in: src/shared/PrototypeNotice.tsx
 *
 * Import:
 *   import PrototypeNotice from "@/shared/PrototypeNotice";
 *
 * Usage:
 *   <PrototypeNotice lang={L} variant="invoice" style={{ marginBottom: 16 }} />
 */

import React from "react";

type Lang = "ar" | "en";

type Variant =
  | "invoice" // Not legally binding
  | "payment" // No real payment processed
  | "ai_data" // Platform data is simulated
  | "pricing" // Pricing is illustrative
  | "booking" // No real reservation created
  | "reference" // Prototype reference code
  | "auth" // Prototype login / not production-secure
  | "upload" // File upload is simulated
  | "sample_cases" // Sample exception cases
  | "finance" // Prototype finance review
  | "automation" // Automation counts simulated
  | "report"; // Report data simulated

const COPY: Record<Variant, { ar: string; en: string }> = {
  invoice: {
    ar: "هذه الفاتورة نموذج تجريبي فقط — غير ملزمة قانونياً",
    en: "Prototype invoice only — not legally binding",
  },
  payment: {
    ar: "لا تتم معالجة أي دفعة حقيقية في هذا النموذج التجريبي",
    en: "No real payment is processed in this prototype",
  },
  ai_data: {
    ar: "بيانات المنصة محاكاة في هذا النموذج التجريبي",
    en: "Platform data is simulated in this prototype",
  },
  pricing: {
    ar: "الأسعار استرشادية — تواصل مع فريق SYBNB للترخيص الفعلي",
    en: "Pricing is illustrative — contact SYBNB team for actual licensing",
  },
  booking: {
    ar: "هذا نموذج تجريبي للحجز — لا يُنشئ التزاماً فعلياً",
    en: "Prototype booking flow — no real reservation is created",
  },
  reference: {
    ar: "رمز المرجع تجريبي — يُستبدل برمز حقيقي من قاعدة البيانات عند التشغيل الفعلي",
    en: "Prototype reference code — replaced by real database ID in production",
  },
  auth: {
    ar: "تسجيل دخول تجريبي — نظام المصادقة يحتاج تأمين إضافي قبل الإنتاج",
    en: "Prototype login — authentication requires production-level security before launch",
  },
  upload: {
    ar: "رفع الملفات محاكى — التخزين الفعلي يتطلب خادم حقيقي",
    en: "File upload is simulated — real storage requires a backend server",
  },
  sample_cases: {
    ar: "القضايا المعروضة نماذج توضيحية — ستأتي من نظام التصعيد الفعلي",
    en: "Sample cases only — real exceptions come from the live escalation system",
  },
  finance: {
    ar: "مراجعة مالية تجريبية — البيانات المعروضة محاكاة",
    en: "Prototype finance review — all data shown is simulated",
  },
  automation: {
    ar: "أعداد الأتمتة محاكاة في هذا النموذج التجريبي",
    en: "Automation counts are simulated in this prototype",
  },
  report: {
    ar: "تقرير تجريبي — جميع الأرقام محاكاة ولا تعكس بيانات حقيقية",
    en: "Prototype report — all numbers are simulated and do not reflect real data",
  },
};

interface Props {
  lang: Lang;
  variant: Variant;
  style?: React.CSSProperties;
}

export default function PrototypeNotice({ lang, variant, style }: Props) {
  const isAr = lang === "ar";
  const copy = COPY[variant];
  const font = isAr ? "'Tajawal', system-ui, sans-serif" : "system-ui, sans-serif";

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        background: "#111118",
        border: "1px solid #1e1e2a",
        borderRadius: 10,
        fontFamily: font,
        fontSize: 12,
        color: "#555566",
        lineHeight: 1.5,
        ...style,
      }}
    >
      <span style={{ fontSize: 13, flexShrink: 0, opacity: 0.7 }}>ℹ</span>
      <span>{isAr ? copy.ar : copy.en}</span>
    </div>
  );
}
