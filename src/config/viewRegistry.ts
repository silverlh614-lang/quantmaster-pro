/**
 * View registry — maps each View id to its human-readable label.
 * Used for browser tab titles, breadcrumbs, and anywhere a view name
 * is displayed as text.
 */
import type { View } from '../stores/useSettingsStore';

/** Label shown in the browser tab / header for each view */
export const VIEW_LABELS: Record<View, string> = {
  DISCOVER: '탐색',
  WATCHLIST: '관심 목록',
  SCREENER: '스크리너',
  SUBSCRIPTION: '섹터 구독',
  BACKTEST: '백테스트',
  WALK_FORWARD: '워크포워드',
  MARKET: '시장 대시보드',
  MANUAL_INPUT: '수동 퀀트',
  TRADE_JOURNAL: '매매일지',
  AUTO_TRADE: '자동매매',
};

/** App name used in browser tab title */
export const APP_TITLE = 'QuantMaster Pro';

/** Builds the full browser tab title for a given view */
export function buildPageTitle(view: View): string {
  return `${VIEW_LABELS[view] ?? view} \u00B7 ${APP_TITLE}`;
}
