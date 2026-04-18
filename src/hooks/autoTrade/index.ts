/**
 * src/hooks/autoTrade — 자동매매 데이터 레이어 공용 진입점.
 *
 * 페이지/컴포넌트는 이 디렉토리에서만 임포트한다. 내부 구현(폴링 정책,
 * 쿼리 키, 에러 전파) 은 언제든 변경될 수 있으나 이 파일의 공개 API 는
 * 안정 인터페이스로 유지한다.
 */

export {
  useAutoTradeEngine,
  deriveAccountSummary,
  type AccountSummary,
  type UseAutoTradeEngineReturn,
} from './useAutoTradeEngine';

export { AUTO_TRADE_KEYS, AUTO_TRADE_POLICY } from './queryKeys';

export {
  useEngineStatusQuery,
  useShadowTradesQuery,
  useRecommendationStatsQuery,
  useWatchlistQuery,
  useHoldingsQuery,
  useBuyAuditQuery,
  useGateAuditQuery,
  useConditionWeightsQuery,
  useOcoOrdersQuery,
  useReconcileQuery,
  useBalanceQuery,
  usePositionEventsQuery,
} from './queries';

export {
  useToggleEngineMutation,
  useRunReconcileMutation,
  useSyncShadowTradeMutation,
  useForceUpdateShadowTradeMutation,
} from './mutations';
