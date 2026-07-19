import type { Lang, Localized } from '../../engines/language/languageEngine'

export type SellerRoleId = 'owner' | 'broker' | 'agency' | 'developer' | 'multi'
export type SellerPlanId = 'plus' | 'premium'

export type SellerRole = {
  id: SellerRoleId
  accent: string
  label: Localized<string>
  shortLabel: Localized<string>
  description: Localized<string>
  nextStep: Localized<string>
}

export type SellerPlan = {
  id: SellerPlanId
  accent: string
  name: string
  price: string
  label: Localized<string>
  features: Array<Localized<string>>
}

export const SELLER_ROLES: SellerRole[] = [
  {
    id: 'owner',
    accent: '#d5a915',
    label: { ar: 'مالك العقار', en: 'Property Owner' },
    shortLabel: { ar: 'مالك', en: 'Owner' },
    description: {
      ar: 'أملك العقار وأريد نشره مباشرة مع مستندات الملكية.',
      en: 'I own the property and want to list it directly with ownership documents.',
    },
    nextStep: { ar: 'إثبات الملكية ثم تفاصيل العقار', en: 'Ownership proof, then listing details' },
  },
  {
    id: 'broker',
    accent: '#526cff',
    label: { ar: 'وسيط بتفويض', en: 'Authorized Broker' },
    shortLabel: { ar: 'وسيط', en: 'Broker' },
    description: {
      ar: 'أمثل المالك وأضيف التفويض قبل نشر الإعلان.',
      en: 'I represent the owner and add authorization before publishing.',
    },
    nextStep: { ar: 'تفويض المالك ثم معلومات التواصل', en: 'Owner authorization, then contact details' },
  },
  {
    id: 'agency',
    accent: '#19d7ff',
    label: { ar: 'مكتب عقاري', en: 'Real Estate Agency' },
    shortLabel: { ar: 'مكتب', en: 'Agency' },
    description: {
      ar: 'أدير عدة عقارات من حساب مكتب واحد ولوحة متابعة.',
      en: 'I manage multiple listings from one agency account and dashboard.',
    },
    nextStep: { ar: 'بيانات المكتب ثم الخطة', en: 'Agency profile, then plan' },
  },
  {
    id: 'developer',
    accent: '#a772ff',
    label: { ar: 'مطوّر مشاريع', en: 'Project Developer' },
    shortLabel: { ar: 'مطوّر', en: 'Developer' },
    description: {
      ar: 'أرفع مشروع بناء جديد مع المخططات والطوابق والوحدات.',
      en: 'I upload a new construction project with plans, floors, and units.',
    },
    nextStep: { ar: 'خطة المطوّر ثم ملفات المشروع', en: 'Developer plan, then project files' },
  },
  {
    id: 'multi',
    accent: '#20d29b',
    label: { ar: 'بائع متعدد الأقسام', en: 'Multi-section Seller' },
    shortLabel: { ar: 'متعدد', en: 'Multi' },
    description: {
      ar: 'أبيع سيارات أو منتجات أو أكثر من نوع إعلان داخل المنصة.',
      en: 'I sell cars, marketplace items, or more than one listing type.',
    },
    nextStep: { ar: 'اختيار القسم ثم الخطة المناسبة', en: 'Choose division, then matching plan' },
  },
]

export const SELLER_PLANS: SellerPlan[] = [
  {
    id: 'plus',
    accent: '#d5a915',
    name: 'Plus',
    price: '$19',
    label: { ar: 'خطة Plus', en: 'Plus' },
    features: [
      { ar: 'صور أكثر وظهور أفضل', en: 'More photos and better visibility' },
      { ar: 'طلبات زيارة وتواصل منظمة', en: 'Organized visit and contact requests' },
      { ar: 'مراجعة أسرع عند الازدحام', en: 'Faster review when queue is busy' },
    ],
  },
  {
    id: 'premium',
    accent: '#a772ff',
    name: 'Premium',
    price: '$49',
    label: { ar: 'خطة Premium', en: 'Premium' },
    features: [
      { ar: 'ظهور مميز وتحليلات', en: 'Featured visibility and analytics' },
      { ar: 'أدوات تسويق ومتابعة العملاء', en: 'Marketing and lead tools' },
      { ar: 'أولوية مراجعة بعد السلامة', en: 'Priority review after safety checks' },
    ],
  },
]

export function pickSellerRole(id: string | null) {
  return SELLER_ROLES.find((role) => role.id === id) ?? SELLER_ROLES[0]
}
