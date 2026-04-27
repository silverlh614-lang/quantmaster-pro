// @responsibility 계좌 리스크 예산 + Fractional Kelly 사이징 SizingDecider

import {
  getAccountRiskBudget,
  computeRiskAdjustedSize,
  type AccountRiskBudgetSnapshot,
  type SignalGrade,
} from '../../accountRiskBudget.js';
import { getRealtimePrice } from '../../../clients/kisStreamClient.js';
import { isOpenShadowStatus } from '../../entryEngine.js';
import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';
import type { SizingDeciderFail } from './types.js';

export interface KellyBudgetDeciderInput {
  stockName: string;
  shadowEntryPrice: number;
  stopLoss: number;
  signalGrade: SignalGrade;
  positionPct: number;
  mtas: number;
  totalAssets: number;
  shadows: ServerShadowTrade[];
}

export interface KellyBudgetDeciderPass {
  ok: true;
  budget: AccountRiskBudgetSnapshot;
  sized: ReturnType<typeof computeRiskAdjustedSize>;
  confidenceModifier: number;
  logMessages: string[];
}

export type KellyBudgetDeciderResult = KellyBudgetDeciderPass | SizingDeciderFail;

/**
 * ADR-0031 PR-63 — 라인 879-923 의 계좌 리스크 예산 + Fractional Kelly 게이트를 byte-equivalent 추출.
 *
 * 차단 분기:
 *  1. !budget.canEnterNew → "[AutoTrade/RiskBudget] {name} 진입 차단 — {blockedReasons}"
 *  2. sized.recommendedBudgetKrw <= 0 → "[AutoTrade/RiskBudget] {name} 사이즈 0 — {sized.reason}"
 *
 * 통과 시 logMessages = (kellyWasCapped ? ["[AutoTrade/RiskBudget] {name} Fractional Kelly 캡 적용 — {reason}"] : [])
 *
 * Idea 8: 활성 포지션의 실시간 현재가 수집 (getRealtimePrice) 도 step 내부에서 처리.
 */
export function kellyBudgetDecider(input: KellyBudgetDeciderInput): KellyBudgetDeciderResult {
  const {
    stockName, shadowEntryPrice, stopLoss, signalGrade, positionPct, mtas, totalAssets, shadows,
  } = input;

  // Idea 8: 활성 포지션의 실시간 현재가를 수집하여 getAccountRiskBudget 에 주입.
  const openCurrentPrices = new Map<string, number>();
  for (const s of shadows) {
    if (!isOpenShadowStatus(s.status)) continue;
    const rt = getRealtimePrice(s.stockCode);
    if (rt !== null && Number.isFinite(rt) && rt > 0) {
      openCurrentPrices.set(s.stockCode, rt);
    }
  }

  const budget = getAccountRiskBudget({
    totalAssets,
    trades: shadows,
    currentPrices: openCurrentPrices,
  });

  if (!budget.canEnterNew) {
    return {
      ok: false,
      logMessage: `[AutoTrade/RiskBudget] ${stockName} 진입 차단 — ${budget.blockedReasons.join(' / ')}`,
    };
  }

  const confidenceModifier = Math.min(1.2, 0.6 + 0.05 * (mtas ?? 0));
  const sized = computeRiskAdjustedSize({
    entryPrice: shadowEntryPrice,
    stopLoss,
    signalGrade,
    kellyMultiplier: positionPct, // 누적 Kelly 비율
    confidenceModifier,
    budget,
    totalAssets,
  });

  if (sized.recommendedBudgetKrw <= 0) {
    return {
      ok: false,
      logMessage: `[AutoTrade/RiskBudget] ${stockName} 사이즈 0 — ${sized.reason}`,
    };
  }

  const logMessages: string[] = [];
  if (sized.kellyWasCapped) {
    logMessages.push(`[AutoTrade/RiskBudget] ${stockName} Fractional Kelly 캡 적용 — ${sized.reason}`);
  }

  return { ok: true, budget, sized, confidenceModifier, logMessages };
}
