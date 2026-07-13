// @responsibility View label, group, and description registry.

import type { View } from '../stores/useSettingsStore';

export const VIEW_LABELS: Record<View, string> = {
  DISCOVER: '후보 발굴',
  WATCHLIST: '관심종목',
  SCREENER: '스크리너',
  SUBSCRIPTION: '섹터 로테이션',
  BACKTEST: '백테스트',
  WALK_FORWARD: '워크 포워드',
  MARKET: '마켓 게이트',
  MANUAL_INPUT: '수동 퀀트',
  TRADE_JOURNAL: '매매 일지',
  AUTO_TRADE: '자동매매',
  PORTFOLIO_EXTRACT: '후보 포트폴리오',
  RECOMMENDATION_HISTORY: '판단 히스토리',
  MACRO_INTEL: '매크로 인텔',
  SHADOW_LEARNING: '섀도우 러닝',
  PUBLIC_REPORT: '공개 리포트',
  BLOG_EXPORT: '블로그 내보내기',
  TELEGRAM_SUMMARY: '텔레그램 요약',
  PAID_PREVIEW: '유료 미리보기',
  DIAGNOSTICS: '진단',
  LEARNING_SANITY: '학습 진단',
  PROVIDER_HEALTH: '공급자 상태',
  EXECUTION_TRACE: '실행 추적',
  RAW_SNAPSHOT: '원본 스냅샷',
};
const APP_TITLE = 'QuantMaster Pro';

export function buildPageTitle(view: View): string {
  return `${VIEW_LABELS[view] ?? view} · ${APP_TITLE}`;
}
