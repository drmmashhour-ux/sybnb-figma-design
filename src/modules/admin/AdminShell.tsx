import type { ReactNode } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { getStoredStaffSession } from '../../shared/api/platformApi'
import './admin-console.css'

export type AdminNavKey = 'guests' | 'hosts' | 'accounting' | 'management' | 'hr' | 'operations' | 'reports'

type NavItem = { key: AdminNavKey; hash: string; icon: string; ar: string; en: string }

const WORKSPACE_NAV: NavItem[] = [
  { key: 'guests', hash: '/admin/guests', icon: '⌂', ar: 'العملاء', en: 'Guests' },
  { key: 'hosts', hash: '/admin/hosts', icon: '⌑', ar: 'المضيفون', en: 'Hosts' },
  { key: 'accounting', hash: '/admin/accounting', icon: '◈', ar: 'المحاسبة', en: 'Accounting' },
  { key: 'management', hash: '/admin/management', icon: '◎', ar: 'الإدارة', en: 'Management' },
  { key: 'hr', hash: '/admin/hr', icon: '♙', ar: 'الموارد البشرية', en: 'HR' },
]

const OPS_NAV: NavItem[] = [
  { key: 'operations', hash: '/admin/review', icon: '⌘', ar: 'العمليات', en: 'Operations' },
  { key: 'reports', hash: '/admin/reports', icon: '▤', ar: 'التقارير والنزاعات', en: 'Reports & disputes' },
]

const CHROME = {
  ar: {
    controlCenter: 'مركز التحكم',
    live: 'مباشر',
    workspace: 'مساحة العمل',
    operationsGroup: 'العمليات والرقابة',
    systems: 'الأنظمة تعمل',
    lastCheck: 'مراقبة مباشرة',
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
    systems: 'Systems operational',
    lastCheck: 'Live monitoring',
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
      className={active === item.key ? 'active' : ''}
      aria-current={active === item.key ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault()
        navigate(item.hash)
      }}
    >
      <span aria-hidden="true">{item.icon}</span>
      <b>{isAr ? item.ar : item.en}</b>
      {counts?.[item.key] ? <em>{counts[item.key]}</em> : null}
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
            <button className="language" type="button" onClick={() => onLanguageChange(isAr ? 'en' : 'ar')} aria-label="Switch language">
              {isAr ? 'EN' : 'AR'}
            </button>
          )}
          <button className="icon-button" type="button" aria-label={c.notifications}>⌁<span className="notification-dot" /></button>
          <span className="avatar" aria-label={c.profile}>{initials}</span>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar" aria-label={c.workspace}>
          <p className="eyebrow">{c.workspace}</p>
          <nav>{WORKSPACE_NAV.map(renderNavItem)}</nav>
          <p className="eyebrow second">{c.operationsGroup}</p>
          <nav className="second">{OPS_NAV.map(renderNavItem)}</nav>
          <div className="sidebar-status">
            <span className="status-icon">✓</span>
            <div><strong>{c.systems}</strong><small>{c.lastCheck}</small></div>
          </div>
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
