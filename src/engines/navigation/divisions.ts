export type DivisionId =
  | 'stays'
  | 'rentals'
  | 'buy'
  | 'cars'
  | 'marketplace'
  | 'new-construction'
  | 'sell'
  | 'ride'

export type DivisionStatus = 'active' | 'soon'

export type Division = {
  id: DivisionId
  route: string
  status: DivisionStatus
  accent: string
  title: { ar: string; en: string }
  kicker: { ar: string; en: string }
  description: { ar: string; en: string }
  mark: 'key' | 'calendar' | 'tag' | 'car' | 'bag' | 'crane' | 'plus' | 'pin'
  previewSteps: Array<{ ar: string; en: string }>
  flow: Array<{ ar: string; en: string }>
}

export const DIVISIONS: Division[] = [
  {
    id: 'stays',
    route: '/stays',
    status: 'active',
    accent: '#526cff',
    mark: 'key',
    title: { ar: 'الإيجار اليومي', en: 'Daily Stays' },
    kicker: { ar: 'حجز قصير المدة', en: 'Short-term booking' },
    description: { ar: 'ابحث بالتاريخ والضيوف ثم أرسل طلب الحجز.', en: 'Search by dates and guests, then request a stay.' },
    previewSteps: [
      { ar: 'اختيار المدينة', en: 'Choose city' },
      { ar: 'تحديد التواريخ', en: 'Set dates' },
      { ar: 'إرسال طلب الحجز', en: 'Request booking' },
    ],
    flow: [
      { ar: 'تصفح الإقامات بدون حساب.', en: 'Browse stays without an account.' },
      { ar: 'افتح التفاصيل، الصور، القواعد، والمضيف.', en: 'Open details, photos, rules, and host.' },
      { ar: 'سجّل الدخول عند إرسال طلب الحجز فقط.', en: 'Sign in only when requesting a booking.' },
      { ar: 'تابع الحجز والدفع والفاتورة من لوحة الرحلة.', en: 'Track booking, payment, and invoice from trip dashboard.' },
    ],
  },
  {
    id: 'rentals',
    route: '/rentals',
    status: 'active',
    accent: '#19d7ff',
    mark: 'calendar',
    title: { ar: 'الإيجار الشهري', en: 'Monthly Rentals' },
    kicker: { ar: 'سكن طويل المدة', en: 'Long-term homes' },
    description: { ar: 'خيارات حسب المدينة، الميزانية، والغرف.', en: 'Filter by city, budget, and bedrooms.' },
    previewSteps: [
      { ar: 'ميزانية شهرية', en: 'Monthly budget' },
      { ar: 'تفاصيل العقار', en: 'Property details' },
      { ar: 'تواصل مع المالك', en: 'Contact owner' },
    ],
    flow: [
      { ar: 'البحث متاح للجميع.', en: 'Search is open to everyone.' },
      { ar: 'التواصل يتطلب حساباً.', en: 'Contact requires an account.' },
      { ar: 'المحادثة تحفظ في IMMOContact.', en: 'Conversation is saved in IMMOContact.' },
    ],
  },
  {
    id: 'buy',
    route: '/buy',
    status: 'active',
    accent: '#d5a915',
    mark: 'tag',
    title: { ar: 'شراء عقار', en: 'Buy Property' },
    kicker: { ar: 'بيع وشقق وفيلات', en: 'Sales and homes' },
    description: { ar: 'شاهد العقارات، أرسل عرضاً، أو احجز زيارة.', en: 'View properties, make an offer, or request a visit.' },
    previewSteps: [
      { ar: 'بحث العقارات', en: 'Search listings' },
      { ar: 'عرض التفاصيل', en: 'View details' },
      { ar: 'عرض أو زيارة', en: 'Offer or visit' },
    ],
    flow: [
      { ar: 'التصفح مجاني.', en: 'Browsing is free.' },
      { ar: 'العرض والزيارة يتطلبان حساباً.', en: 'Offers and visits require an account.' },
      { ar: 'البيع لا يعتمد على دفع مباشر داخل المنصة حالياً.', en: 'Sales do not depend on direct platform payment yet.' },
    ],
  },
  {
    id: 'cars',
    route: '/cars',
    status: 'active',
    accent: '#20d29b',
    mark: 'car',
    title: { ar: 'المركبات', en: 'Cars' },
    kicker: { ar: 'سيارات وبائعون', en: 'Vehicles and dealers' },
    description: { ar: 'ابحث عن السيارة، تحقق من التفاصيل، وتواصل مع البائع.', en: 'Find a car, inspect details, and contact the seller.' },
    previewSteps: [
      { ar: 'ماركة وسعر', en: 'Make and price' },
      { ar: 'تفاصيل السيارة', en: 'Car details' },
      { ar: 'تواصل آمن', en: 'Safe contact' },
    ],
    flow: [
      { ar: 'بطاقات السيارات تعرض السعر والحالة.', en: 'Car cards show price and condition.' },
      { ar: 'التواصل يفتح محادثة خاصة.', en: 'Contact opens a private thread.' },
      { ar: 'البائعون والوكلاء يمرون بخطة ودفع قبل اللوحة.', en: 'Sellers and dealers pass plan and payment before dashboard.' },
    ],
  },
  {
    id: 'marketplace',
    route: '/marketplace',
    status: 'active',
    accent: '#ff9f43',
    mark: 'bag',
    title: { ar: 'السوق', en: 'Marketplace' },
    kicker: { ar: 'منتجات محلية', en: 'Local items' },
    description: { ar: 'تصفح المنتجات وتواصل مع البائع بعد إنشاء حساب.', en: 'Browse items and contact sellers after account.' },
    previewSteps: [
      { ar: 'تصنيف المنتج', en: 'Item category' },
      { ar: 'تفاصيل وصور', en: 'Details and photos' },
      { ar: 'محادثة آمنة', en: 'Safe message' },
    ],
    flow: [
      { ar: 'الإعلانات لها مدة نشر حسب الخطة.', en: 'Listings expire by selected plan duration.' },
      { ar: 'التواصل يتطلب حساباً.', en: 'Contact requires an account.' },
      { ar: 'المنصة تحافظ على سجل المحادثة النصية.', en: 'The platform preserves text conversation history.' },
    ],
  },
  {
    id: 'new-construction',
    route: '/new-construction',
    status: 'active',
    accent: '#a772ff',
    mark: 'crane',
    title: { ar: 'مشاريع جديدة', en: 'New Construction' },
    kicker: { ar: 'مطوّرون وخطط بناء', en: 'Developers and projects' },
    description: { ar: 'استعرض المشاريع الجديدة وتفاصيلها المتاحة، ثم اطلب زيارة أو تواصلاً.', en: 'Browse new projects and their available details, then request a visit or contact.' },
    previewSteps: [
      { ar: 'بطاقة المشروع', en: 'Project card' },
      { ar: 'تفاصيل المشروع', en: 'Project details' },
      { ar: 'حجز زيارة', en: 'Visit request' },
    ],
    flow: [
      { ar: 'الزائر يرى ما يرفعه المطور حسب الخطة.', en: 'Visitors see what the developer unlocks by plan.' },
      { ar: 'تظهر التفاصيل التي يقدّمها المطور بوضوح.', en: 'Developer-provided details are shown clearly.' },
      { ar: 'الحجز أو التواصل يتطلب حساباً.', en: 'Visit/contact requires account.' },
      { ar: 'المطور يدفع عبر Sham Cash أو بطاقة حسب الخطة.', en: 'Developer pays by Sham Cash or card by plan.' },
    ],
  },
  {
    id: 'sell',
    route: '/sell',
    status: 'active',
    accent: '#6f8cff',
    mark: 'plus',
    title: { ar: 'أضف إعلانك', en: 'Add Listing' },
    kicker: { ar: 'مدخل موحد للبائعين', en: 'Unified seller entry' },
    description: { ar: 'اختر دورك ثم الخطة ثم ارفع تفاصيل الإعلان.', en: 'Choose your role, plan, then upload listing details.' },
    previewSteps: [
      { ar: 'اختيار الدور', en: 'Choose role' },
      { ar: 'اختيار الخطة', en: 'Choose plan' },
      { ar: 'مراجعة ونشر', en: 'Review and publish' },
    ],
    flow: [
      { ar: 'الصفحة الرئيسية تعرض بطاقة واحدة فقط للإضافة.', en: 'Landing shows one Add Listing card only.' },
      { ar: 'الأدوار تظهر داخل /sell.', en: 'Roles appear inside /sell.' },
      { ar: 'الدفع والمراجعة قبل فتح لوحة البائع.', en: 'Payment and review happen before seller dashboard.' },
    ],
  },
  {
    id: 'ride',
    route: '/ride',
    status: 'active',
    accent: '#19d7ff',
    mark: 'pin',
    title: { ar: 'سير', en: 'SYBNB Ride' },
    kicker: { ar: 'رحلات مباشرة', en: 'Live rides' },
    description: { ar: 'اطلب رحلة، اختر الفئة، وتابع تعيين السائق.', en: 'Request a ride, choose category, and track driver assignment.' },
    previewSteps: [
      { ar: 'موقع العميل', en: 'Client location' },
      { ar: 'اختيار الفئة', en: 'Select category' },
      { ar: 'تتبع الرحلة', en: 'Track ride' },
    ],
    flow: [
      { ar: 'حدد نقطة الانطلاق والوجهة يدوياً أو عبر GPS.', en: 'Set pickup and dropoff manually or with GPS.' },
      { ar: 'اختر الفئة ووضع البيانات المنخفض.', en: 'Choose category and low-data mode.' },
      { ar: 'يتم حفظ الطلب وتعيين السائق من الإدارة.', en: 'The request is saved and driver assignment is admin controlled.' },
    ],
  },
]

export function findDivisionByRoute(route: string) {
  return DIVISIONS.find((division) => division.route === route)
}
