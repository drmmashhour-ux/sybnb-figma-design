import type { CSSProperties } from 'react'
import { getLogoAsset } from './logoRegistry'
import type { LogoKey } from './logoRegistry'

type BrandLogoProps = {
  logo: LogoKey
  size?: 'nav' | 'card' | 'hero'
  className?: string
}

const SIZE_STYLES: Record<NonNullable<BrandLogoProps['size']>, CSSProperties> = {
  nav: { width: 148, height: 48 },
  card: { width: 190, height: 88 },
  hero: { width: 260, height: 128 },
}

export function BrandLogo({ logo, size = 'nav', className }: BrandLogoProps) {
  const asset = getLogoAsset(logo)
  return (
    <span className={className} style={{ ...styles.wrap, ...SIZE_STYLES[size] }}>
      <img src={asset.src} alt={asset.label} style={styles.image} />
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    alignItems: 'center',
    display: 'inline-flex',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    display: 'block',
    height: '100%',
    objectFit: 'contain',
    width: '100%',
  },
}
