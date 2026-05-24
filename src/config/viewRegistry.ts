// @responsibility viewRegistry 설정 SSOT
/**
 * View registry — maps each View id to its human-readable label.
 * Used for browser tab titles, breadcrumbs, and anywhere a view name
 * is displayed as text.
 */
import type { View } from '../stores/useSettingsStore';

/** Label shown in the browser tab / header for each view */
export const VIEW_LABELS: Record<View, string> = {
  DISCOVER: '후보 판정',
  WATCHLIST: '관심 목록',
  SCREENER: '스크리너',
  SUBSCRIPTION: '섹터 구독',
  BACKTEST: '백테스트',
  WALK_FORWARD: '워크포워드',
  MARKET: '시장 대시보드',
  MANUAL_INPUT: '수동 퀀트',
  TRADE_JOURNAL: '매매일지',
  AUTO_TRADE: '자동매매',
  PORTFOLIO_EXTRACT: '포트폴리오 추출',
  RECOMMENDATION_HISTORY: '판정 이력',
  MACRO_INTEL: '매크로 인텔리전스',
  SHADOW_LEARNING: 'Shadow 학습',
  PUBLIC_REPORT: 'Public Report',
  BLOG_EXPORT: 'Blog Export',
  TELEGRAM_SUMMARY: 'Telegram Summary',
  PAID_PREVIEW: 'Paid Preview',
  DIAGNOSTICS: 'Diagnostics',
  LEARNING_SANITY: 'Learning Diagnostics',
  PROVIDER_HEALTH: 'Provider Health',
  EXECUTION_TRACE: 'Execution Trace',
  RAW_SNAPSHOT: 'Raw Snapshot',
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
  DISCOVER: '시장 Gate와 데이터 신뢰도를 기준으로 시스템 후보를 판정합니다.',
  WATCHLIST: '관심 후보를 추적하고 후보 판정 흐름으로 연결합니다.',
  SCREENER: '조건 기반으로 시스템 후보를 좁혀 봅니다.',
  SUBSCRIPTION: '섹터 로테이션과 관심 섹터 흐름을 확인합니다.',
  BACKTEST: '후보 판정 전략의 과거 구간 검증을 확인합니다.',
  WALK_FORWARD: 'Walk-forward 검증과 과최적화 위험을 확인합니다.',
  MARKET: '오늘의 시장 Gate와 실행 모드를 확인합니다.',
  MANUAL_INPUT: '수동 입력으로 퀀트 판정 조건을 검토합니다.',
  TRADE_JOURNAL: '실거래와 Shadow 결과를 기록합니다.',
  AUTO_TRADE: '실행 권한, Shadow, 보유 관리 상태를 확인합니다.',
  PORTFOLIO_EXTRACT: '시스템 후보 기반 포트폴리오 구성을 검토합니다.',
  RECOMMENDATION_HISTORY: '과거 후보 판정의 사후 성과와 Shadow 결과를 확인합니다.',
  MACRO_INTEL: '운영자용 매크로 진단을 확인합니다.',
  SHADOW_LEARNING: 'Shadow Learning 결과와 후보 사후 검증을 확인합니다.',
  PUBLIC_REPORT: '블로그와 텔레그램으로 내보낼 공개 리포트를 생성합니다.',
  BLOG_EXPORT: 'Public Report Hub에서 블로그 Markdown을 생성합니다.',
  TELEGRAM_SUMMARY: 'Public Report Hub에서 Telegram 요약을 생성합니다.',
  PAID_PREVIEW: 'Public Report Hub에서 유료 미리보기 필드 분리를 확인합니다.',
  DIAGNOSTICS: '운영자 전용 내부 진단을 확인합니다.',
  LEARNING_SANITY: '운영자 전용 학습 진단과 pending wiring 상태를 확인합니다.',
  PROVIDER_HEALTH: '운영자 전용 provider health와 data confidence 상태를 확인합니다.',
  EXECUTION_TRACE: '운영자 전용 실행 trace와 permission 분기를 확인합니다.',
  RAW_SNAPSHOT: '운영자 전용 SourceSnapshot 원자료 진단을 확인합니다.',
};

/** App name used in browser tab title */
export const APP_TITLE = 'QuantMaster Pro';

/** Builds the full browser tab title for a given view */
export function buildPageTitle(view: View): string {
  return `${VIEW_LABELS[view] ?? view} \u00B7 ${APP_TITLE}`;
}
