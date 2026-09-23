import logoLight from '../assets/ecofleet_logo.svg'
import logoDark from '../assets/ecofleet_logo_dark.svg'
import { currentTheme } from '../theme.js'

// The official mark's navy "Eco" disappears on dark surfaces, so dark mode
// uses a variant with light lettering (same colors otherwise).
export default function BrandLogo({ theme = currentTheme(), height = 46 }) {
  return (
    <span className="brand-logo-wrap">
      <img src={theme === 'dark' ? logoDark : logoLight} alt="EcoFleet" style={{ height, width: 'auto', maxWidth: '100%' }} />
    </span>
  )
}
