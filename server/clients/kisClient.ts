/**
 * @responsibility KIS 클라이언트 SSOT barrel — 외부 import 경로 호환 보존
 *
 * ADR-0135 (PR-Refactor-3) — 본 파일은 분해 후 barrel re-export 만 유지한다.
 * 1382 LoC 분해 결과:
 *   ./kisClient/types.ts        — 도메인 타입 SSOT (8 type/interface)
 *   ./kisClient/constants.ts    — KIS_BASE / TR_ID / KIS_IS_REAL / HAS_REAL_DATA_CLIENT
 *   ./kisClient/auth.ts         — 토큰 캐시 + refresh*Token + invalidateKisToken
 *   ./kisClient/resilience.ts   — 회로차단 + ADR-0014 jitter + __testOnly + _alert*
 *   ./kisClient/overrides.ts    — KisClientOverrides + set/has/getOverrides
 *   ./kisClient/http.ts         — _rawKisGet/_rawKisPost + kisGet/kisPost + realDataKisGet
 *   ./kisClient/query.ts        — fetch{InvestorFlow,MarketSupply,CurrentPrice,PrevClose,StockName}
 *   ./kisClient/holdings.ts     — isKisBalanceQueryAllowed + fetchAccountBalance + fetchKisHoldings
 *   ./kisClient/orders.ts       — place{Market,Sell,StopLoss,TakeProfit}Order + cancelKisOrder
 *   ./kisClient/index.ts        — barrel
 *
 * 외부 importer (51 파일) + 회귀 테스트 경로 변경 0건 — barrel re-export 로 호환.
 * CLAUDE.md 절대 규칙 #2 (kisClient 단일 통로) 보존.
 */

export * from './kisClient/index.js';
