// @responsibility counterfactual 학습 엔진 모듈
/**
 * counterfactual.ts — Counterfactual Simulator (#3).
 *
 * "만약 다르게 했더라면?" 을 정량화. 매일 누적되면 시스템이 놓친 알파 총량이 드러남.
 *
 * 3개 축:
 *   - Miss         : Watch 중 Gate 미달 보류 종목의 당일 수익 합계 (KRW)
 *   - Early Exit   : 익절 후 추가 상승 금액 합계 (KRW)
 *   - Late Stop    : 손절 기준 도달 후 지연 집행 손실 합계 (KRW)
 *
 * Phase 2 범위:
 *   - Late Stop 은 ServerShadowTrade 의 stopLoss·exitPrice·quantity 만으로 계산.
 *   - Miss / Early Exit 은 당일 EOD 가격이 필요 — 기본 0 KRW + sampleCount 만 집계.
 *     Phase 3 Ghost Portfolio Tracker 와 통합 시 실제 금액 채워짐.
 *
 * 원천: ServerShadowTrade[] (오늘 종료된 거래)
 */

import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import type { CounterfactualBreakdown } from '../reflectionTypes.js';

export interface CounterfactualInputs {
  /** 오늘(KST) 종료된 shadow trades (HIT_TARGET/HIT_STOP) */
  closedToday: ServerShadowTrade[];
  /** 오늘 Watch/BUY 신호났으나 매수 안 한 종목 코드 */
  missedSignalCodes: string[];
  /** EOD 가격 조회 (선택). 없으면 Miss/Early 는 sampleCount 만 추적. */
  eodPriceFor?: (stockCode: string) => Promise<number | null>;
}

export async function computeCounterfactual(
  inputs: CounterfactualInputs,
): Promise<CounterfactualBreakdown> {
  let lateStopKrw = 0;
  let earlyExitKrw = 0;
  let missedOpportunityKrw = 0;
  let sampleCount = 0;

  // ── Late Stop: exitPrice < stopLoss 인 HIT_STOP → 지연 손실 ────────────────
  for (const t of inputs.closedToday) {
    if (t.status !== 'HIT_STOP') continue;
    if (t.exitPrice == null || t.stopLoss == null || t.quantity == null) continue;
    // exitPrice 가 stopLoss 보다 낮다면 손절 기준 아래에서 집행됨 = 지연 손실
    const slipKrw = (t.stopLoss - t.exitPrice) * t.quantity;
    if (slipKrw > 0) {
      lateStopKrw += slipKrw;
      sampleCount++;
    }
  }

  // ── Early Exit: HIT_TARGET 이후 추가 상승 (EOD 필요) ───────────────────────
  for (const t of inputs.closedToday) {
    if (t.status !== 'HIT_TARGET') continue;
    if (t.exitPrice == null || t.quantity == null) continue;
    sampleCount++;
    if (!inputs.eodPriceFor) continue;
    try {
      const eod = await inputs.eodPriceFor(t.stockCode);
      if (eod != null && eod > t.exitPrice) {
        earlyExitKrw += (eod - t.exitPrice) * t.quantity;
      }
    } catch {
      // EOD 실패는 조용히 무시 — sampleCount 는 유지 (집계 대상임을 기록)
    }
  }

  // ── Miss: 놓친 종목의 당일 수익 (Phase 3 Ghost Portfolio 와 통합) ─────────
  // Phase 2: eodPriceFor 가 주입된 경우만 부분 집계.
  //          기본 추정 수량 = 100 주 (보수적). 정확 값은 Phase 3 에서 Gate 시뮬로 치환.
  const ESTIMATED_QTY_PER_MISS = 100;
  if (inputs.eodPriceFor && inputs.missedSignalCodes.length > 0) {
    for (const code of inputs.missedSignalCodes) {
      sampleCount++;
      try {
        const eod = await inputs.eodPriceFor(code);
        if (eod != null && eod > 0) {
          // 당일 수익 0 이하는 보류(Watch 탈락이 정당했음) — 양수만 "놓친 기회".
          // signalPrice 가 없으므로 Phase 2 는 0 처리. Phase 3 ghost 와 조인.
          missedOpportunityKrw += 0;
        }
      } catch {
        // ignored
      }
    }
  } else {
    sampleCount += inputs.missedSignalCodes.length;
  }

  return {
    missedOpportunityKrw: Math.round(missedOpportunityKrw),
    earlyExitKrw:         Math.round(earlyExitKrw),
    lateStopKrw:          Math.round(lateStopKrw),
    sampleCount,
  };
}
