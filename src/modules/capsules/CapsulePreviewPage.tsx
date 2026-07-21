import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { AccountGateCapsule } from '../../shared/capsules/AccountGateCapsule'
import { SearchCapsule } from '../../shared/capsules/SearchCapsule'
import type { CapsuleActor } from '../../shared/capsules'

// Internal QA page for the new reusable capsules (capsules/SYBNB_REUSABLE_CAPSULES.md) -- lets both
// be exercised end to end without wiring them into any existing, already-working page. Not linked
// from any nav; reachable only by typing the route directly.
type Props = { lang: Lang }

const ACTORS: CapsuleActor[] = ['guest', 'renter', 'buyer', 'seller', 'host', 'admin', 'advertiser']

export function CapsulePreviewPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const [actor, setActor] = useState<CapsuleActor>('guest')
  const [lastSearch, setLastSearch] = useState<string>('')

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <h1 style={styles.title}>{isAr ? 'معاينة الكبسولات' : 'Capsule preview'}</h1>
      <p style={styles.subtitle}>
        {isAr
          ? 'صفحة داخلية للتحقق فقط — لا ترتبط بأي صفحة حالية.'
          : 'Internal QA page only -- not linked from any existing page.'}
      </p>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>{isAr ? 'كبسولة البحث' : 'Search Capsule'}</h2>
        <SearchCapsule
          lang={lang}
          division="STR"
          allowCanada
          showDate
          mainGroupOptions={[
            { key: 'apartment', ar: 'شقة', en: 'Apartment' },
            { key: 'villa', ar: 'فيلا', en: 'Villa' },
          ]}
          onSearch={(state) => setLastSearch(JSON.stringify(state, null, 2))}
        />
        {lastSearch && <pre style={styles.pre}>{lastSearch}</pre>}
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>{isAr ? 'كبسولة بوابة الحساب' : 'Account Gate Capsule'}</h2>
        <div style={styles.actorRow}>
          {ACTORS.map((item) => (
            <button key={item} type="button" style={item === actor ? styles.actorActive : styles.actorButton} onClick={() => setActor(item)}>
              {item}
            </button>
          ))}
        </div>
        <AccountGateCapsule lang={lang} actor={actor} returnPath="/capsule-preview" />
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { background: '#08090e', color: '#fff', display: 'grid', gap: 24, minHeight: '100vh', padding: '32px 20px 90px', maxWidth: 560, margin: '0 auto' },
  title: { margin: 0, fontSize: 26 },
  subtitle: { color: '#9aa6ba', margin: 0 },
  card: { background: '#111118', border: '1px solid #232638', borderRadius: 16, display: 'grid', gap: 14, padding: 18 },
  cardTitle: { margin: 0, fontSize: 18 },
  pre: { background: '#0a0a0f', border: '1px solid #232638', borderRadius: 10, color: '#9fb0ff', fontSize: 12, overflowX: 'auto', padding: 12 },
  actorRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  actorButton: { background: '#0f172a', border: '1px solid #30405f', borderRadius: 999, color: '#9ca3af', fontSize: 12, fontWeight: 800, padding: '6px 12px' },
  actorActive: { background: '#4760ff', border: '1px solid #4760ff', borderRadius: 999, color: '#fff', fontSize: 12, fontWeight: 900, padding: '6px 12px' },
}
