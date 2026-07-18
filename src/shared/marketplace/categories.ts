import type { Lang } from '../../engines/language/languageEngine'

// Marketplace (goods) category tree — Phase 1. Kept in sync with server/lib/marketplace-categories.mjs
// (the server validates the top-level `id`). Facebook-style top categories with AR/EN labels + an emoji
// for the browse chips.
export type MarketplaceCategory = {
  id: string
  ar: string
  en: string
  icon: string
  subcategories?: Array<{ id: string; ar: string; en: string }>
}

export const MARKETPLACE_CATEGORIES: MarketplaceCategory[] = [
  { id: 'ELECTRONICS', ar: 'إلكترونيات', en: 'Electronics', icon: '📱' },
  { id: 'HOME_FURNITURE', ar: 'أثاث ومنزل', en: 'Home & furniture', icon: '🛋️' },
  { id: 'APPLIANCES', ar: 'أجهزة منزلية', en: 'Appliances', icon: '🔌' },
  { id: 'CLOTHING_ACCESSORIES', ar: 'ملابس واكسسوارات', en: 'Clothing & accessories', icon: '👕' },
  { id: 'BABY_KIDS', ar: 'مستلزمات الأطفال', en: 'Baby & kids', icon: '🧸' },
  { id: 'SPORTS_OUTDOORS', ar: 'رياضة وهواء طلق', en: 'Sports & outdoors', icon: '⚽' },
  { id: 'TOOLS_DIY', ar: 'عدد وأدوات', en: 'Tools & DIY', icon: '🛠️' },
  { id: 'BOOKS_MEDIA', ar: 'كتب ووسائط', en: 'Books & media', icon: '📚' },
  { id: 'BEAUTY_HEALTH', ar: 'جمال وصحة', en: 'Beauty & health', icon: '💄' },
  { id: 'PETS', ar: 'حيوانات أليفة', en: 'Pets', icon: '🐾' },
  { id: 'BUSINESS_INDUSTRIAL', ar: 'تجاري وصناعي', en: 'Business & industrial', icon: '🏭' },
  { id: 'OTHER', ar: 'أخرى', en: 'Other', icon: '📦' },
]

export const MARKETPLACE_CONDITIONS: Array<{ id: string; ar: string; en: string }> = [
  { id: 'NEW', ar: 'جديد', en: 'New' },
  { id: 'EXCELLENT', ar: 'ممتاز', en: 'Excellent' },
  { id: 'GOOD', ar: 'جيد', en: 'Good' },
  { id: 'USED', ar: 'مستعمل', en: 'Used' },
  { id: 'FAIR', ar: 'مقبول', en: 'Fair' },
  { id: 'REFURBISHED', ar: 'مجدد', en: 'Refurbished' },
]

export function categoryLabel(id: string | undefined, lang: Lang): string {
  const cat = MARKETPLACE_CATEGORIES.find((c) => c.id === String(id || '').toUpperCase())
  if (!cat) return String(id || '')
  return lang === 'ar' ? cat.ar : cat.en
}

export function conditionLabel(id: string | undefined, lang: Lang): string {
  const c = MARKETPLACE_CONDITIONS.find((x) => x.id === String(id || '').toUpperCase())
  if (!c) return String(id || '')
  return lang === 'ar' ? c.ar : c.en
}
