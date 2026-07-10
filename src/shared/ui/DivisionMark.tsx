import type { Division } from '../../engines/navigation/divisions'
import type { CSSVars } from '../theme/cssVars'

type Props = {
  mark: Division['mark']
  accent: string
}

const markGlyph: Record<Division['mark'], string> = {
  key: '⌁',
  calendar: '□',
  tag: '◇',
  car: '▱',
  bag: '▣',
  crane: '╋',
  plus: '+',
  pin: '⌖',
}

export function DivisionMark({ mark, accent }: Props) {
  return (
    <span className={`division-mark division-mark-${mark}`} style={{ '--accent': accent } as CSSVars}>
      <span>{markGlyph[mark]}</span>
    </span>
  )
}
