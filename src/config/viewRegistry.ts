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

export type ViewGroup = 'CORE' | 'DISCOVERY' | 'PERFORMANCE' | 'REPORT' | 'OPERATOR';

export const VIEW_GROUPS: Record<View, ViewGroup> = {
  DISCOVER: 'DISCOVERY',
  WATCHLIST: 'DISCOVERY',
  SCREENER: 'DISCOVERY',
  SUBSCRIPTION: 'DISCOVERY',
  BACKTEST: 'PERFORMANCE',
  WALK_FORWARD: 'PERFORMANCE',
  MARKET: 'CORE',
  MANUAL_INPUT: 'DISCOVERY',
  TRADE_JOURNAL: 'PERFORMANCE',
  AUTO_TRADE: 'CORE',
  PORTFOLIO_EXTRACT: 'PERFORMANCE',
  RECOMMENDATION_HISTORY: 'PERFORMANCE',
  MACRO_INTEL: 'OPERATOR',
  SHADOW_LEARNING: 'CORE',
  PUBLIC_REPORT: 'REPORT',
  BLOG_EXPORT: 'REPORT',
  TELEGRAM_SUMMARY: 'REPORT',
  PAID_PREVIEW: 'REPORT',
  DIAGNOSTICS: 'OPERATOR',
  LEARNING_SANITY: 'OPERATOR',
  PROVIDER_HEALTH: 'OPERATOR',
  EXECUTION_TRACE: 'OPERATOR',
  RAW_SNAPSHOT: 'OPERATOR',
};

export const VIEW_DESCRIPTIONS: Record<View, string> = {
  DISCOVER: 'Review system candidates through Market Gate, data confidence, block reasons, and Shadow tracking.',
  WATCHLIST: 'Track watchlist candidates and connect them to the candidate decision flow.',
  SCREENER: 'Find system candidates with condition-based filters.',
  SUBSCRIPTION: 'Review sector rotation and subscribed sector flows.',
  BACKTEST: 'Validate candidate decision rules on historical windows.',
  WALK_FORWARD: 'Review walk-forward validation and overfitting risk.',
  MARKET: 'Check today\'s Market Gate, regime, and execution mode.',
  MANUAL_INPUT: 'Run manual quant checks from operator-provided inputs.',
  TRADE_JOURNAL: 'Record trade and Shadow outcomes.',
  AUTO_TRADE: 'Review execution permission, Shadow state, and position management.',
  PORTFOLIO_EXTRACT: 'Build a candidate portfolio from system decisions.',
  RECOMMENDATION_HISTORY: 'Review historical candidate decisions and post-outcomes.',
  MACRO_INTEL: 'Operator macro diagnostics.',
  SHADOW_LEARNING: 'Review Shadow Learning and candidate post-outcomes.',
  PUBLIC_REPORT: 'Generate the public report hub for blog and Telegram output.',
  BLOG_EXPORT: 'Open Public Report and focus the blog export section.',
  TELEGRAM_SUMMARY: 'Open Public Report and focus the Telegram summary export.',
  PAID_PREVIEW: 'Open Public Report in paid preview mode.',
  DIAGNOSTICS: 'Operator diagnostics.',
  LEARNING_SANITY: 'Operator learning diagnostics and pending wiring checks.',
  PROVIDER_HEALTH: 'Operator provider health and data confidence diagnostics.',
  EXECUTION_TRACE: 'Operator execution trace and permission diagnostics.',
  RAW_SNAPSHOT: 'Operator SourceSnapshot raw diagnostics.',
};

export const APP_TITLE = 'QuantMaster Pro';

export function buildPageTitle(view: View): string {
  return `${VIEW_LABELS[view] ?? view} · ${APP_TITLE}`;
}
