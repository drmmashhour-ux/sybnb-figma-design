// Facebook-style marketplace (goods) category tree — Phase 1. Top-level categories with optional
// subcategories. A MARKETPLACE listing must carry a `category` equal to one of the top-level ids below;
// `subcategory` is optional and free-form for now. Kept in sync with src/shared/marketplace/categories.ts
// (client labels). CARS and property have their own divisions, so vehicles/real-estate are not here.
export const MARKETPLACE_CATEGORY_TREE = [
  { id: 'ELECTRONICS', subcategories: ['PHONES', 'COMPUTERS', 'TVS', 'AUDIO', 'CAMERAS', 'GAMING'] },
  { id: 'HOME_FURNITURE', subcategories: ['FURNITURE', 'DECOR', 'KITCHEN', 'BEDDING', 'LIGHTING'] },
  { id: 'APPLIANCES', subcategories: ['LARGE', 'SMALL', 'AC_HEATING'] },
  { id: 'CLOTHING_ACCESSORIES', subcategories: ['MEN', 'WOMEN', 'KIDS', 'SHOES', 'BAGS', 'WATCHES'] },
  { id: 'BABY_KIDS', subcategories: ['TOYS', 'STROLLERS', 'CLOTHING', 'GEAR'] },
  { id: 'SPORTS_OUTDOORS', subcategories: ['FITNESS', 'CYCLING', 'CAMPING', 'TEAM_SPORTS'] },
  { id: 'TOOLS_DIY', subcategories: ['POWER_TOOLS', 'HAND_TOOLS', 'BUILDING', 'GARDEN'] },
  { id: 'BOOKS_MEDIA', subcategories: ['BOOKS', 'MUSIC', 'MOVIES', 'INSTRUMENTS'] },
  { id: 'BEAUTY_HEALTH', subcategories: ['MAKEUP', 'FRAGRANCE', 'HEALTH'] },
  { id: 'PETS', subcategories: ['SUPPLIES', 'ACCESSORIES'] },
  { id: 'BUSINESS_INDUSTRIAL', subcategories: ['EQUIPMENT', 'SUPPLIES'] },
  { id: 'OTHER', subcategories: [] },
]

export const MARKETPLACE_CATEGORY_IDS = new Set(MARKETPLACE_CATEGORY_TREE.map((c) => c.id))

export function isValidMarketplaceCategory(value) {
  return MARKETPLACE_CATEGORY_IDS.has(String(value || '').toUpperCase())
}
