/**
 * @responsibility 종목 단위 진입 평가 공용 헬퍼 — 가격·익절 컨텍스트·적응형 익절 계산
 *
 * ADR-0134 (PR-Refactor-2) — perSymbolEvaluation.ts 분해 시 헬퍼 격리.
 * buyListLoop.ts + intradayLoop.ts 양쪽이 사용한다.
 */

import { fetchCurrentPrice } from '../../../clients/kisClient.js';
import { getRealtimePrice, subscribeStock } from '../../../clients/kisStreamClient.js';
import { PROFIT_TARGETS } from '../../../../src/services/quant/sellEngine.js';
import type { MacroState } from '../../../persistence/macroStateRepo.js';

/**
 * Idea 7 — 진입 차단 유사도 임계값 (0~100). 85% 이상 일치하는 실패 패턴이 존재하면 진입 차단.
 * failurePatternDB 의 SIMILARITY_THRESHOLD (매칭 임계) 보다 엄격하게 운용 가능.
 */
export const FAILURE_BLOCK_THRESHOLD_PCT = Number(
  process.env.FAILURE_BLOCK_THRESHOLD_PCT ?? '85',
);

/**
 * 실시간 가격 맵 우선 조회 → REST fallback.
 * KIS WebSocket H0STCNT0 구독 중이면 인메모리 맵에서 즉시 반환,
 * 미구독/stale 시에만 REST fetchCurrentPrice 호출.
 */
export async function getPrice(stockCode: string): Promise<number | null> {
  const rtPrice = getRealtimePrice(stockCode);
  if (rtPrice !== null) return rtPrice;
  // 미구독 종목은 즉시 구독 등록 (다음 호출부터 실시간)
  subscribeStock(stockCode);
  return fetchCurrentPrice(stockCode).catch(() => null);
}

/**
 * 종목 단위 상태 — getAdaptiveProfitTargets() 의 선택적 컨텍스트.
 *
 *   profileType
 *     'LEADER'      — 주도주 추세 보유 강화 → 익절 라인 약간 상향, 트레일링 넓힘
 *     'CATALYST'    — 단기 촉매 → 1차 익절 비중 확대(보수화)
 *     'OVERHEATED'  — 고점/뉴스 과열 → 1차 익절 조기화 + 트레일링 짧게
 *     'DIVERGENT'   — 거래량/RSI 다이버전스 → 트레일링 짧게
 *
 * 셋 다 미지정이면 macro 만 반영 (기존 동작과 100% 호환).
 */
export interface SymbolExitContext {
  profileType?: 'LEADER' | 'CATALYST' | 'OVERHEATED' | 'DIVERGENT';
  sector?: string;
  watchlistSource?: string;
}

export function getAdaptiveProfitTargets(
  regime: keyof typeof PROFIT_TARGETS,
  macroState: MacroState | null,
  symbolCtx?: SymbolExitContext,
): { targets: typeof PROFIT_TARGETS[typeof regime]; trailPctAdjust: number; reason: string } {
  const vix = macroState?.vix ?? null;
  const mhs = macroState?.mhs ?? null;

  // ── 1) Macro overlay (기존 로직 유지) ────────────────────────────────────
  let macroTriggerAdjust = 0;
  let macroTrailAdjust   = 0;
  let macroReason = 'macro:기본';
  if ((mhs != null && mhs >= 70) || (vix != null && vix <= 18) || regime === 'R1_TURBO' || regime === 'R2_BULL') {
    macroTriggerAdjust = 0.02;
    macroTrailAdjust   = 0.02;
    macroReason = 'macro:risk-on 확장(트레일링 넓힘)';
  } else if ((mhs != null && mhs <= 45) || (vix != null && vix >= 24) || regime === 'R5_CAUTION' || regime === 'R6_DEFENSE') {
    macroTriggerAdjust = -0.02;
    macroTrailAdjust   = -0.02;
    macroReason = 'macro:risk-off 보수화(익절 조기화)';
  }

  // ── 2) Symbol overlay — 주도주 추세 / 과열 / 다이버전스 ──────────────────
  // 의견(사용자 P1-1) 반영: 같은 레짐에서도 종목 상태에 따라 익절 강도를 차등화.
  // 변경량은 macro 와 합산되며, 최종 trigger 는 floor 3% / ceiling 25% 로 클램프.
  let symbolTriggerAdjust = 0;
  let symbolTrailAdjust   = 0;
  let symbolReason: string | null = null;
  switch (symbolCtx?.profileType) {
    case 'LEADER':
      symbolTriggerAdjust = 0.01;
      symbolTrailAdjust   = 0.02;
      symbolReason = 'symbol:LEADER(추세보유 강화)';
      break;
    case 'CATALYST':
      symbolTriggerAdjust = -0.01;
      symbolTrailAdjust   = -0.01;
      symbolReason = 'symbol:CATALYST(1차 익절 조기화)';
      break;
    case 'OVERHEATED':
      symbolTriggerAdjust = -0.02;
      symbolTrailAdjust   = -0.03;
      symbolReason = 'symbol:OVERHEATED(과열 방어)';
      break;
    case 'DIVERGENT':
      symbolTrailAdjust   = -0.02;
      symbolReason = 'symbol:DIVERGENT(트레일링 강화)';
      break;
    default:
      break;
  }

  const triggerAdjust = macroTriggerAdjust + symbolTriggerAdjust;
  const trailPctAdjust = macroTrailAdjust + symbolTrailAdjust;
  const reason = [macroReason, symbolReason].filter(Boolean).join(' + ');

  return {
    targets: PROFIT_TARGETS[regime].map((target) => {
      if (target.type !== 'LIMIT' || target.trigger == null) return target;
      // floor 3% / ceiling 25% — 합성 효과로 양 극단까지 가지 않도록 클램프.
      const adjusted = Math.max(0.03, Math.min(0.25, target.trigger + triggerAdjust));
      return {
        ...target,
        trigger: Number(adjusted.toFixed(3)),
      };
    }),
    trailPctAdjust,
    reason,
  };
}

/**
 * ADR-0172 — 포지션 사이징 엔진 유동성·섹터 실입력 헬퍼.
 *
 * 기존 dummy 값(1_000_000_000_000_000 / 0) 을 실제 데이터로 교체한다.
 *
 * avgDailyVolume20d: reCheckQuote.vol20dAvg × price (거래량 → 거래대금 환산)
 *   - vol20dAvg 는 YahooQuoteExtended 에 이미 계산된 20일 평균 거래량
 *   - 거래대금(원) = 거래량 × 현재가
 *   - 부재 시 안전 fallback: 큰 수(감쇄 없음) — universe 차단 회피
 *
 * currentSectorWeight: 현재 보유 포트폴리오에서 동일 섹터 비중
 *   - sectorConcentrationGate 와 동일 로직 (shadows + getSectorByCode)
 *   - 총 활성 포지션 수 대비 동일 섹터 수의 비율
 *   - 부재 시 안전 fallback: 0 (감쇄 없음)
 */
import { isOpenShadowStatus } from '../../entryEngine.js';
import { getSectorByCode } from '../../../screener/sectorMap.js';
import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';
import type { YahooQuoteExtended } from '../../../screener/adapters/yahooQuoteAdapter.js';

export interface SizingLiquidityInputs {
  avgDailyVolume20d: number;
  currentSectorWeight: number;
}

/**
 * applyPositionSizingEngine 에 전달할 유동성·섹터 실입력을 계산한다.
 *
 * @param quote       reCheckQuote (YahooQuoteExtended | null)
 * @param stockCode   종목코드
 * @param stockSector stock.sector (WatchlistEntry.sector — 옵셔널)
 * @param shadows     활성 shadow trade 목록
 */
export function computeSizingLiquidityInputs(
  quote: YahooQuoteExtended | null,
  stockCode: string,
  stockSector: string | undefined,
  shadows: ServerShadowTrade[],
): SizingLiquidityInputs {
  // ── 1. 20일 평균 거래대금 (원) ────────────────────────────────────────────
  // vol20dAvg(주) × price(원) = 거래대금(원)
  // vol20dAvg 가 0 이거나 quote 없으면 큰 수 fallback (universe 차단 회피)
  const FALLBACK_VOLUME = 1_000_000_000_000_000;
  let avgDailyVolume20d = FALLBACK_VOLUME;
  if (quote && quote.vol20dAvg > 0 && quote.price > 0) {
    avgDailyVolume20d = Math.round(quote.vol20dAvg * quote.price);
  }

  // ── 2. 현재 포트폴리오 동일 섹터 비중 ────────────────────────────────────
  // sectorConcentrationGate 와 동일 로직: shadows 기준 활성 포지션 수 대비 동일 섹터 수
  const candidateSector =
    stockSector ?? getSectorByCode(stockCode) ?? null;

  let currentSectorWeight = 0;
  if (candidateSector) {
    const activeTrades = shadows.filter(s => isOpenShadowStatus(s.status));
    const total = activeTrades.length;
    if (total > 0) {
      const sameSector = activeTrades.filter(s => {
        // shadowTrade 에는 sector 직접 영속 없음 — getSectorByCode fallback
        const tradeSector = getSectorByCode(s.stockCode) ?? null;
        return tradeSector === candidateSector;
      }).length;
      currentSectorWeight = sameSector / total;
    }
  }

  return { avgDailyVolume20d, currentSectorWeight };
}

/**
 * ADR-0170 §M4 — `applyExposureBudgetCap` 의 macro 입력 헬퍼.
 *
 * macroState 부재 시 undefined 반환 → ADR-0166 기존 매핑 그대로 (회귀 위험 격리).
 * 매크로 신호 부재 시 R5_CAUTION → R2_WEAK 매핑 그대로, 매크로 활성 시 R1_DEFENSIVE 자동 격상.
 *
 * 4 호출자 (buyListLoop 3 + intradayLoop 1) drift 차단 단일 진입점.
 */
export function buildExposureBudgetMacroInput(
  macroState: MacroState | null | undefined,
): { vix?: number; vkospi?: number; bearDefenseMode?: boolean } | undefined {
  if (!macroState) return undefined;
  return {
    vix: macroState.vix,
    vkospi: macroState.vkospi,
    bearDefenseMode: macroState.bearDefenseMode,
  };
}
