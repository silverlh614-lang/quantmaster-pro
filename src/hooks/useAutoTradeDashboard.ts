/**
 * useAutoTradeDashboard — thin re-export shim.
 *
 * **Phase 1 리팩토링 (2026-04):** 기존 200+줄 fetch 로직은
 * `src/hooks/autoTrade/` 모듈로 이관되어 TanStack Query 로 재작성되었다.
 * 이 파일은 외부 호출부(AccountSummaryStrip, autoTradingMapper 등) 가
 * 임포트 경로를 그대로 유지할 수 있도록 남겨둔 shim 이다.
 *
 * 신규 개발에서는 `useAutoTradeEngine` (또는 개별 query 훅)을 직접 사용할 것.
 */

export {
  useAutoTradeEngine as useAutoTradeDashboard,
  deriveAccountSummary,
  type AccountSummary,
  type UseAutoTradeEngineReturn as UseAutoTradeDashboardReturn,
} from './autoTrade';
