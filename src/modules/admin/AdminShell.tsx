import type { ReactNode } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { getStoredStaffSession } from '../../shared/api/platformApi'
import './admin-console.css'

export type AdminNavKey = string

type NavItem = { key: string; hash: string; icon: string; ar: string; en: string }
type NavGroup = { key: string; ar: string; en: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'str', ar: '١. الإيجار القصير (STR)', en: '1. Short-Term Rentals (STR)',
    items: [
      { key: 'guests', hash: '/admin/guests', icon: '⌂', ar: 'نظرة STR والعملاء', en: 'STR overview & guests' },
      { key: 'strControl', hash: '/admin/str', icon: '⌁', ar: 'التحكم في STR', en: 'STR control' },
      { key: 'operations', hash: '/admin/review', icon: '⌘', ar: 'الحجوزات والمراجعات', en: 'Bookings & reviews' },
    ],
  },
  {
    key: 'hosts', ar: '٢. إدارة المضيفين', en: '2. Host Control',
    items: [
      { key: 'hosts', hash: '/admin/hosts', icon: '⌑', ar: 'المضيفون والعقارات', en: 'Hosts & properties' },
      { key: 'hostBookings', hash: '/admin/review', icon: '▣', ar: 'حجوزات المضيفين', en: 'Host bookings' },
      { key: 'hostPayouts', hash: '/finance', icon: '◈', ar: 'أرباح وتحويلات المضيفين', en: 'Host earnings & payouts' },
      { key: 'hostAccounts', hash: '/admin/management', icon: '◎', ar: 'حسابات وتحقق المضيفين', en: 'Host accounts & verification' },
    ],
  },
  {
    key: 'realestate', ar: '٣. العقارات', en: '3. Real Estate',
    items: [
      { key: 'realestateControl', hash: '/admin/real-estate', icon: '⌂', ar: 'لوحة العقارات', en: 'Real estate control' },
    ],
  },
  {
    key: 'commerce', ar: '٤. السوق والمركبات والإعلانات', en: '4. Marketplace, Cars & Ads',
    items: [
      { key: 'marketplaceControl', hash: '/admin/marketplace', icon: '◇', ar: 'التحكم في السوق', en: 'Marketplace control' },
      { key: 'carsControl', hash: '/admin/cars', icon: '◉', ar: 'التحكم في السيارات', en: 'Cars & auctions control' },
      { key: 'advertisingControl', hash: '/admin/advertising', icon: '▣', ar: 'التحكم في الإعلانات', en: 'Advertising control' },
    ],
  },
  {
    key: 'transport', ar: '٥. النقل SR', en: '5. SR Transport',
    items: [
      { key: 'srDispatch', hash: '/admin/sr-dispatch', icon: '⊕', ar: 'التوجيه والسائقون', en: 'Dispatch & drivers' },
    ],
  },
  {
    key: 'finance', ar: '٦. المالية والإيرادات', en: '6. Finance & Revenue',
    items: [
      { key: 'accounting', hash: '/admin/accounting', icon: '◈', ar: 'المحاسبة والمدفوعات', en: 'Accounting & payments' },
      { key: 'financeCenter', hash: '/finance', icon: '▤', ar: 'التسوية المالية', en: 'Finance reconciliation' },
      { key: 'dailyIncome', hash: '/finance', icon: '◷', ar: 'دخل يومي / أسبوعي / شهري', en: 'Daily / weekly / monthly income' },
      { key: 'revenueSources', hash: '/finance', icon: '◆', ar: 'مصادر الإيرادات حسب المنصة', en: 'Revenue sources by platform' },
      { key: 'refunds', hash: '/finance', icon: '↶', ar: 'الاستردادات والأموال المحررة', en: 'Refunds & released money' },
      { key: 'reports', hash: '/admin/reports', icon: '⚑', ar: 'التقارير والنزاعات', en: 'Reports & disputes' },
      { key: 'trustControl', hash: '/admin/trust', icon: '✓', ar: 'الثقة والتحقق', en: 'Trust & verification' },
      { key: 'disputes', hash: '/admin/disputes', icon: '!', ar: 'النزاعات', en: 'Disputes' },
    ],
  },
  {
    key: 'ai', ar: '٧. إدارة الذكاء الاصطناعي', en: '7. AI Management',
    items: [
      { key: 'aiBrain', hash: '/ai-brain', icon: '✦', ar: 'تشغيل وإيقاف أقسام AI', en: 'AI section controls' },
      { key: 'aiReport', hash: '/ai-brain', icon: '▤', ar: 'التقرير الصباحي اليومي', en: 'Daily morning report' },
      { key: 'aiApprovals', hash: '/admin/review', icon: '✓', ar: 'قرارات تنتظر موافقتك', en: 'Decisions awaiting approval' },
    ],
  },
  {
    key: 'administration', ar: '٨. الإدارة والتشغيل', en: '8. Administration & Operations',
    items: [
      { key: 'management', hash: '/admin/management', icon: '◎', ar: 'إدارة الحسابات', en: 'Account management' },
      { key: 'hr', hash: '/admin/hr', icon: '♙', ar: 'الموارد البشرية', en: 'Human resources' },
      { key: 'office', hash: '/admin/office', icon: '▦', ar: 'لوحة المكتب', en: 'Office dashboard' },
      { key: 'competitors', hash: '/competitors', icon: '◫', ar: 'تحليل المنافسين', en: 'Competitor analysis' },
      { key: 'status', hash: '/status', icon: '●', ar: 'حالة المنصة', en: 'Platform status' },
    ],
  },
]

const CHROME = {
  ar: {
    controlCenter: 'مركز التحكم',
    live: 'مباشر',
    workspace: 'مساحة العمل',
    operationsGroup: 'العمليات والرقابة',
    systems: 'حالة المنصة',
    lastCheck: 'افتح فحص الحالة',
    liveOverview: 'نظرة تشغيلية مباشرة',
    refresh: 'تحديث',
    openReview: 'فتح قائمة المراجعة',
    notifications: 'التنبيهات',
    profile: 'ملف المسؤول',
  },
  en: {
    controlCenter: 'Control Center',
    live: 'Live',
    workspace: 'Workspace',
    operationsGroup: 'Operations & oversight',
    systems: 'Platform status',
    lastCheck: 'Open the live status check',
    liveOverview: 'Live operational overview',
    refresh: 'Refresh',
    openReview: 'Open review queue',
    notifications: 'Notifications',
    profile: 'Admin profile',
  },
}

function initialsFrom(nameOrEmail: string | null | undefined): string {
  if (!nameOrEmail) return 'AD'
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail
  const parts = base.replace(/[._-]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (base.slice(0, 2) || 'AD').toUpperCase()
}

type Props = {
  lang: Lang
  active: AdminNavKey
  title: string
  subtitle: string
  children: ReactNode
  /** Optional count badges keyed by nav key. */
  counts?: Partial<Record<AdminNavKey, number>>
  onLanguageChange?: (lang: Lang) => void
  onRefresh?: () => void
  /** Replace the default hero actions (Refresh + Open review) entirely. */
  heroActions?: ReactNode
}

export function AdminShell({ lang, active, title, subtitle, children, counts, onLanguageChange, onRefresh, heroActions }: Props) {
  const isAr = lang === 'ar'
  const c = CHROME[lang]
  const session = getStoredStaffSession()
  const initials = initialsFrom(session?.user?.displayName || session?.user?.email)

  const renderNavItem = (item: NavItem) => (
    <a
      key={item.key}
      href={`#${item.hash}`}
      title={isAr ? item.ar : item.en}
      aria-label={isAr ? item.ar : item.en}
      className={active === item.key ? 'active' : ''}
      aria-current={active === item.key ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault()
        navigate(item.hash)
      }}
    >
      <span aria-hidden="true">{item.icon}</span>
      <b>{isAr ? item.ar : item.en}</b>
      {counts?.[item.key as AdminNavKey] ? <em>{counts[item.key as AdminNavKey]}</em> : null}
    </a>
  )

  return (
    <div className="sybnb-admin" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="topbar">
        <button className="brand" onClick={() => navigate('/admin/guests')} aria-label="SYBNB Control Center">
          <span className="brand-mark">S</span>
          <span><strong>SYBNB</strong><small>{c.controlCenter}</small></span>
        </button>
        <div className="top-actions">
          <span className="environment"><i />{c.live}</span>
          {onLanguageChange && (
            <button className="language" type="button" onClick={() => onLanguageChange(isAr ? 'en' : 'ar')} aria-label={isAr ? 'التبديل إلى الإنجليزية' : 'Switch to Arabic'}>
              {isAr ? 'EN' : 'AR'}
            </button>
          )}
          <button className="icon-button" type="button" aria-label={c.notifications} onClick={() => navigate('/admin/management')}>⌁<span className="notification-dot" /></button>
          <span className="avatar" aria-label={c.profile}>{initials}</span>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar" aria-label={c.workspace}>
          <p className="eyebrow sidebar-title">{c.workspace}</p>
          <div className="sidebar-groups">
            {NAV_GROUPS.map((group) => (
              <section className="nav-group" key={group.key} aria-label={isAr ? group.ar : group.en}>
                <p className="eyebrow">{isAr ? group.ar : group.en}</p>
                <nav>{group.items.map(renderNavItem)}</nav>
              </section>
            ))}
          </div>
          <button className="sidebar-status" type="button" onClick={() => navigate('/status')}>
            <span className="status-icon">✓</span>
            <div><strong>{c.systems}</strong><small>{c.lastCheck}</small></div>
          </button>
        </aside>

        <main>
          <section className="hero">
            <div>
              <p className="eyebrow"><span className="live-dot" />{c.liveOverview}</p>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            <div className="hero-actions">
              {heroActions ?? (
                <>
                  {onRefresh && (
                    <button className="button ghost" type="button" onClick={onRefresh}>↻ {c.refresh}</button>
                  )}
                  <button className="button primary" type="button" onClick={() => navigate('/admin/review')}>
                    <span>＋</span> {c.openReview}
                  </button>
                </>
              )}
            </div>
          </section>
          {children}
        </main>
      </div>
    </div>
  )
}
