import type { Division } from '../../engines/navigation/divisions'
import type { Lang } from '../../engines/language/languageEngine'
import { text } from '../../engines/language/languageEngine'
import type { CSSVars } from '../../shared/theme/cssVars'

type Props = {
  division: Division
  lang: Lang
  previewMode?: 'animation' | 'video'
  src?: string
  isVisible?: boolean
}

export function DivisionPreviewAnimation({ division, lang, previewMode = 'animation', src, isVisible = true }: Props) {
  if (previewMode === 'video' && src) {
    return (
      <div className="division-preview" style={{ '--accent': division.accent } as CSSVars}>
        <video className="division-preview-video" src={src} autoPlay={isVisible} loop muted playsInline />
      </div>
    )
  }

  return (
    <div className="division-preview" aria-hidden="true" style={{ '--accent': division.accent } as CSSVars}>
      <div className="preview-screen preview-screen-a">
        <div className="preview-topline" />
        <div className="preview-search">
          <span />
          <strong>{text(division.previewSteps[0], lang)}</strong>
        </div>
        <div className="preview-row" />
        <div className="preview-row short" />
      </div>

      <div className="preview-screen preview-screen-b">
        <div className="preview-photo" />
        <div className="preview-card-lines">
          <span />
          <span />
          <span />
        </div>
        <strong>{text(division.previewSteps[1], lang)}</strong>
      </div>

      <div className="preview-screen preview-screen-c">
        <div className="preview-confirm-ring" />
        <strong>{text(division.previewSteps[2], lang)}</strong>
        <div className="preview-cta" />
      </div>
    </div>
  )
}
