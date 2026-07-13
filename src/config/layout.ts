// @responsibility layout 설정 SSOT
/** Views that show the sector rotation side-panel on desktop */
export const SECTOR_PANEL_VIEWS = ['DISCOVER', 'WATCHLIST'] as const;

/** Page transition animation config (Framer Motion) */
export const PAGE_TRANSITION = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.2, ease: 'easeOut' as const },
} as const;
