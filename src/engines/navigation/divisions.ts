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
  title: { ar: string; en: string; fr: string }
  kicker: { ar: string; en: string; fr: string }
  description: { ar: string; en: string; fr: string }
  mark: 'key' | 'calendar' | 'tag' | 'car' | 'bag' | 'crane' | 'plus' | 'pin'
  previewSteps: Array<{ ar: string; en: string; fr: string }>
  flow: Array<{ ar: string; en: string; fr: string }>
}

export const DIVISIONS: Division[] = [
  {
    id: 'stays',
    route: '/stays',
    status: 'active',
    accent: '#526cff',
    mark: 'key',
    title: { ar: 'الإيجار اليومي', en: 'Daily Stays', fr: 'Séjours courts' },
    kicker: { ar: 'حجز قصير المدة', en: 'Short-term booking', fr: 'Réservation courte durée' },
    description: {
      ar: 'ابحث بالتاريخ والضيوف ثم أرسل طلب الحجز.',
      en: 'Search by dates and guests, then request a stay.',
      fr: 'Recherchez par dates et voyageurs, puis envoyez une demande de réservation.',
    },
    previewSteps: [
      { ar: 'اختيار المدينة', en: 'Choose city', fr: 'Choisir la ville' },
      { ar: 'تحديد التواريخ', en: 'Set dates', fr: 'Définir les dates' },
      { ar: 'إرسال طلب الحجز', en: 'Request booking', fr: 'Envoyer la demande' },
    ],
    flow: [
      { ar: 'تصفح الإقامات بدون حساب.', en: 'Browse stays without an account.', fr: 'Parcourez les séjours sans compte.' },
      {
        ar: 'افتح التفاصيل، الصور، القواعد، والمضيف.',
        en: 'Open details, photos, rules, and host.',
        fr: 'Consultez les détails, photos, règles et l’hôte.',
      },
      {
        ar: 'سجّل الدخول عند إرسال طلب الحجز فقط.',
        en: 'Sign in only when requesting a booking.',
        fr: 'Connectez-vous uniquement pour envoyer une demande.',
      },
      {
        ar: 'تابع الحجز والدفع والفاتورة من لوحة الرحلة.',
        en: 'Track booking, payment, and invoice from trip dashboard.',
        fr: 'Suivez réservation, paiement et facture depuis le tableau de bord.',
      },
    ],
  },
  {
    id: 'rentals',
    route: '/rentals',
    status: 'soon',
    accent: '#19d7ff',
    mark: 'calendar',
    title: { ar: 'الإيجار الشهري', en: 'Monthly Rentals', fr: 'Locations mensuelles' },
    kicker: { ar: 'سكن طويل المدة', en: 'Long-term homes', fr: 'Logements longue durée' },
    description: {
      ar: 'خيارات حسب المدينة، الميزانية، والغرف.',
      en: 'Filter by city, budget, and bedrooms.',
      fr: 'Filtrez par ville, budget et nombre de chambres.',
    },
    previewSteps: [
      { ar: 'ميزانية شهرية', en: 'Monthly budget', fr: 'Budget mensuel' },
      { ar: 'تفاصيل العقار', en: 'Property details', fr: 'Détails du logement' },
      { ar: 'تواصل مع المالك', en: 'Contact owner', fr: 'Contacter le propriétaire' },
    ],
    flow: [
      { ar: 'البحث متاح للجميع.', en: 'Search is open to everyone.', fr: 'La recherche est ouverte à tous.' },
      { ar: 'التواصل يتطلب حساباً.', en: 'Contact requires an account.', fr: 'Un compte est requis pour contacter.' },
      {
        ar: 'المحادثة تحفظ في IMMOContact.',
        en: 'Conversation is saved in IMMOContact.',
        fr: 'La conversation est enregistrée dans IMMOContact.',
      },
    ],
  },
  {
    id: 'buy',
    route: '/buy',
    status: 'soon',
    accent: '#d5a915',
    mark: 'tag',
    title: { ar: 'شراء عقار', en: 'Buy Property', fr: 'Acheter un bien' },
    kicker: { ar: 'بيع وشقق وفيلات', en: 'Sales and homes', fr: 'Ventes et biens' },
    description: {
      ar: 'شاهد العقارات، أرسل عرضاً، أو احجز زيارة.',
      en: 'View properties, make an offer, or request a visit.',
      fr: 'Consultez les biens, faites une offre ou demandez une visite.',
    },
    previewSteps: [
      { ar: 'بحث العقارات', en: 'Search listings', fr: 'Rechercher des biens' },
      { ar: 'عرض التفاصيل', en: 'View details', fr: 'Voir les détails' },
      { ar: 'عرض أو زيارة', en: 'Offer or visit', fr: 'Offre ou visite' },
    ],
    flow: [
      { ar: 'التصفح مجاني.', en: 'Browsing is free.', fr: 'La consultation est gratuite.' },
      {
        ar: 'العرض والزيارة يتطلبان حساباً.',
        en: 'Offers and visits require an account.',
        fr: 'Un compte est requis pour les offres et visites.',
      },
      {
        ar: 'البيع لا يعتمد على دفع مباشر داخل المنصة حالياً.',
        en: 'Sales do not depend on direct platform payment yet.',
        fr: 'Les ventes ne passent pas encore par un paiement direct sur la plateforme.',
      },
    ],
  },
  {
    id: 'cars',
    route: '/cars',
    status: 'soon',
    accent: '#20d29b',
    mark: 'car',
    title: { ar: 'المركبات', en: 'Cars', fr: 'Véhicules' },
    kicker: { ar: 'سيارات وبائعون', en: 'Vehicles and dealers', fr: 'Véhicules et vendeurs' },
    description: {
      ar: 'ابحث عن السيارة، تحقق من التفاصيل، وتواصل مع البائع.',
      en: 'Find a car, inspect details, and contact the seller.',
      fr: 'Trouvez une voiture, vérifiez les détails et contactez le vendeur.',
    },
    previewSteps: [
      { ar: 'ماركة وسعر', en: 'Make and price', fr: 'Marque et prix' },
      { ar: 'تفاصيل السيارة', en: 'Car details', fr: 'Détails du véhicule' },
      { ar: 'تواصل آمن', en: 'Safe contact', fr: 'Contact sécurisé' },
    ],
    flow: [
      {
        ar: 'بطاقات السيارات تعرض السعر والحالة.',
        en: 'Car cards show price and condition.',
        fr: 'Les fiches véhicules affichent prix et état.',
      },
      { ar: 'التواصل يفتح محادثة خاصة.', en: 'Contact opens a private thread.', fr: 'Le contact ouvre une conversation privée.' },
      {
        ar: 'البائعون والوكلاء يمرون بخطة ودفع قبل اللوحة.',
        en: 'Sellers and dealers pass plan and payment before dashboard.',
        fr: 'Vendeurs et concessionnaires passent par un forfait et un paiement avant le tableau de bord.',
      },
    ],
  },
  {
    id: 'marketplace',
    route: '/marketplace',
    status: 'soon',
    accent: '#ff9f43',
    mark: 'bag',
    title: { ar: 'السوق', en: 'Marketplace', fr: 'Marché' },
    kicker: { ar: 'منتجات محلية', en: 'Local items', fr: 'Articles locaux' },
    description: {
      ar: 'تصفح المنتجات وتواصل مع البائع بعد إنشاء حساب.',
      en: 'Browse items and contact sellers after account.',
      fr: 'Parcourez les articles et contactez les vendeurs après création d’un compte.',
    },
    previewSteps: [
      { ar: 'تصنيف المنتج', en: 'Item category', fr: 'Catégorie de l’article' },
      { ar: 'تفاصيل وصور', en: 'Details and photos', fr: 'Détails et photos' },
      { ar: 'محادثة آمنة', en: 'Safe message', fr: 'Message sécurisé' },
    ],
    flow: [
      {
        ar: 'الإعلانات لها مدة نشر حسب الخطة.',
        en: 'Listings expire by selected plan duration.',
        fr: 'La durée de publication dépend du forfait choisi.',
      },
      { ar: 'التواصل يتطلب حساباً.', en: 'Contact requires an account.', fr: 'Un compte est requis pour contacter.' },
      {
        ar: 'المنصة تحافظ على سجل المحادثة النصية.',
        en: 'The platform preserves text conversation history.',
        fr: 'La plateforme conserve l’historique des conversations.',
      },
    ],
  },
  {
    id: 'new-construction',
    route: '/new-construction',
    status: 'soon',
    accent: '#a772ff',
    mark: 'crane',
    title: { ar: 'مشاريع جديدة', en: 'New Construction', fr: 'Nouveaux projets' },
    kicker: { ar: 'مطوّرون وخطط بناء', en: 'Developers and projects', fr: 'Promoteurs et projets' },
    description: {
      ar: 'شاهد المشروع على أقسام: الأسلوب، المخططات، الطوابق، التشطيب، والدفع.',
      en: 'View projects by sections: style, plans, floors, finishing, and terms.',
      fr: 'Explorez les projets par sections : style, plans, étages, finitions et conditions.',
    },
    previewSteps: [
      { ar: 'بطاقة المشروع', en: 'Project card', fr: 'Fiche du projet' },
      { ar: 'أقسام المشروع', en: 'Project sections', fr: 'Sections du projet' },
      { ar: 'حجز زيارة', en: 'Visit request', fr: 'Demande de visite' },
    ],
    flow: [
      {
        ar: 'الزائر يرى ما يرفعه المطور حسب الخطة.',
        en: 'Visitors see what the developer unlocks by plan.',
        fr: 'Les visiteurs voient ce que le promoteur publie selon son forfait.',
      },
      {
        ar: 'كل قسم مستقل وليس صفحة طويلة واحدة.',
        en: 'Each section is separate, not one long page.',
        fr: 'Chaque section est indépendante, pas une seule longue page.',
      },
      { ar: 'الحجز أو التواصل يتطلب حساباً.', en: 'Visit/contact requires account.', fr: 'Un compte est requis pour visiter ou contacter.' },
      {
        ar: 'المطور يدفع عبر Sham Cash أو بطاقة حسب الخطة.',
        en: 'Developer pays by Sham Cash or card by plan.',
        fr: 'Le promoteur paie via Sham Cash ou carte selon le forfait.',
      },
    ],
  },
  {
    id: 'sell',
    route: '/sell',
    status: 'soon',
    accent: '#6f8cff',
    mark: 'plus',
    title: { ar: 'أضف إعلانك', en: 'Add Listing', fr: 'Ajouter une annonce' },
    kicker: { ar: 'مدخل موحد للبائعين', en: 'Unified seller entry', fr: 'Accès unique vendeurs' },
    description: {
      ar: 'اختر دورك ثم الخطة ثم ارفع تفاصيل الإعلان.',
      en: 'Choose your role, plan, then upload listing details.',
      fr: 'Choisissez votre rôle, votre forfait, puis publiez les détails de l’annonce.',
    },
    previewSteps: [
      { ar: 'اختيار الدور', en: 'Choose role', fr: 'Choisir le rôle' },
      { ar: 'اختيار الخطة', en: 'Choose plan', fr: 'Choisir le forfait' },
      { ar: 'مراجعة ونشر', en: 'Review and publish', fr: 'Vérifier et publier' },
    ],
    flow: [
      {
        ar: 'الصفحة الرئيسية تعرض بطاقة واحدة فقط للإضافة.',
        en: 'Landing shows one Add Listing card only.',
        fr: 'La page d’accueil affiche une seule carte «Ajouter une annonce».',
      },
      { ar: 'الأدوار تظهر داخل /sell.', en: 'Roles appear inside /sell.', fr: 'Les rôles apparaissent dans /sell.' },
      {
        ar: 'الدفع والمراجعة قبل فتح لوحة البائع.',
        en: 'Payment and review happen before seller dashboard.',
        fr: 'Paiement et vérification précèdent l’accès au tableau de bord vendeur.',
      },
    ],
  },
  {
    id: 'ride',
    route: '/ride',
    status: 'soon',
    accent: '#19d7ff',
    mark: 'pin',
    title: { ar: 'SYBNB Ride', en: 'SYBNB Ride', fr: 'SYBNB Ride' },
    kicker: { ar: 'رحلات مباشرة', en: 'Live rides', fr: 'Courses en direct' },
    description: {
      ar: 'اطلب رحلة، اختر الفئة، وتابع تعيين السائق.',
      en: 'Request a ride, choose category, and track driver assignment.',
      fr: 'Demandez une course, choisissez la catégorie et suivez l’attribution du chauffeur.',
    },
    previewSteps: [
      { ar: 'موقع العميل', en: 'Client location', fr: 'Position du client' },
      { ar: 'اختيار الفئة', en: 'Select category', fr: 'Choisir la catégorie' },
      { ar: 'تتبع الرحلة', en: 'Track ride', fr: 'Suivre la course' },
    ],
    flow: [
      {
        ar: 'حدد نقطة الانطلاق والوجهة يدوياً أو عبر GPS.',
        en: 'Set pickup and dropoff manually or with GPS.',
        fr: 'Définissez le départ et l’arrivée manuellement ou via GPS.',
      },
      {
        ar: 'اختر الفئة ووضع البيانات المنخفض.',
        en: 'Choose category and low-data mode.',
        fr: 'Choisissez la catégorie et le mode données réduites.',
      },
      {
        ar: 'يتم حفظ الطلب وتعيين السائق من الإدارة.',
        en: 'The request is saved and driver assignment is admin controlled.',
        fr: 'La demande est enregistrée et l’attribution du chauffeur est gérée par l’administration.',
      },
    ],
  },
]

export function findDivisionByRoute(route: string) {
  return DIVISIONS.find((division) => division.route === route)
}

// SYB-008 — client route gate. Returns the gated (non-active) division a path belongs to, matching the
// exact route, any sub-route, and the `-preview` variant, so a direct hash URL into a Soon division is
// caught before its page renders. Returns undefined for active divisions and non-division paths.
export function gatedDivisionForPath(path: string): Division | undefined {
  return DIVISIONS.find(
    (division) =>
      division.status !== 'active' &&
      (path === division.route || path.startsWith(`${division.route}/`) || path === `${division.route}-preview`),
  )
}
