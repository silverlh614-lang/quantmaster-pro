/**
 * @responsibility 종목 단위 진입 검증 — Gate·RRR·liveGate·failure·corr·sizing·cooldown 평가
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 중 종목 단위 평가 단계.
 * 본 단계 (Step 4a) 는 헬퍼 (getPrice, FAILURE_BLOCK_THRESHOLD_PCT,
 * SymbolExitContext, getAdaptiveProfitTargets) 추출만 수행. 메인 루프 본체는
 * 후속 Step 4b/4c 에서 evaluateBuyList / evaluateIntradayList 로 이식 예정.
 */

import { fetchCurrentPrice } from '../../clients/kisClient.js';
import { getRealtimePrice, subscribeStock } from '../../clients/kisStreamClient.js';
import { PROFIT_TARGETS } from '../../../src/services/quant/sellEngine.js';
import type { MacroState } from '../../persistence/macroStateRepo.js';

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

// Step 4b/4c (후속): evaluateBuyList / evaluateIntradayList 본체 이식 예정.
// 본 시점에는 signalScanner.ts 의 runAutoSignalScan 본체가 자체 정의를 사용한다.
