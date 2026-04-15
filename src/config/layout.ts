/**
 * Layout constants — mirrors the CSS custom properties in index.css
 * so that JS logic (e.g. responsive checks, inline styles) can reference
 * the same values without magic numbers.
 */

export const LAYOUT = {
  /** Desktop sidebar width in pixels */
  SIDEBAR_WIDTH: 220,
  /** Collapsed sidebar width in pixels */
  SIDEBAR_COLLAPSED_WIDTH: 64,
  /** Mobile bottom navigation height in pixels */
  BOTTOM_NAV_HEIGHT: 64,
  /** Scroll offset (px) before StickyMiniHeader appears */
  STICKY_HEADER_SCROLL_THRESHOLD: 200,
  /** Sector rotation panel width (desktop only) */
  SECTOR_PANEL_WIDTH: 260,
} as const;

/** Views that show the sector rotation side-panel on desktop */
export const SECTOR_PANEL_VIEWS = ['DISCOVER', 'WATCHLIST'] as const;

/** Page transition animation config (Framer Motion) */
export const PAGE_TRANSITION = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.2, ease: 'easeOut' as const },
} as const;
