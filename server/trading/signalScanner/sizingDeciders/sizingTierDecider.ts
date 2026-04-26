// @responsibility 신뢰도 티어 사이징 + PROBING 슬롯 예산 결정 SizingDecider

import {
  classifySizingTier,
  PROBING_MAX_SLOTS,
  type SizingTier,
  type SizingTierDecision,
} from '../../sizingTier.js';
import {
  canReserveBanditProbingSlot,
  type BanditDecision,
} from '../../../learning/probingBandit.js';
import { getMinGateScore } from '../../entryEngine.js';
import type { MacroState } from '../../../persistence/macroStateRepo.js';
import type { SizingDeciderFail } from './types.js';

export interface SizingTierDeciderInput {
  stockName: string;
  liveGateScore: number;
  reCheckGate: { mtas: number; conditionKeys?: string[] };
  regime: string;
  macroState: MacroState | null;
  banditDecision: BanditDecision;
  probingReservedSlots: number;
}

export interface SizingTierDeciderPass {
  ok: true;
  tierDecision: SizingTierDecision & { tier: SizingTier };
  logMessages: string[];
}

export type SizingTierDeciderResult = SizingTierDeciderPass | SizingDeciderFail;

/**
 * ADR-0031 PR-62 — 라인 776-806 의 신뢰도 티어 사이징 + PROBING 슬롯 가드를 byte-equivalent 추출.
 *
 * 차단 분기:
 *  1. tierDecision.tier === null → "[AutoTrade/SizingTier] {name} 티어 미달 — {reason}"
 *  2. PROBING + 슬롯 포화 → "[AutoTrade/SizingTier] {name} PROBING 슬롯 포화 ({n}/{budget}) — 스킵"
 *
 * 통과 시 logMessages = ["[AutoTrade/SizingTier] {name} → {tier} (×{kellyFactor}) — {reason}"]
 */
export function sizingTierDecider(input: SizingTierDeciderInput): SizingTierDeciderResult {
  const {
    stockName, liveGateScore, reCheckGate, regime, macroState, banditDecision, probingReservedSlots,
  } = input;

  const _gate1Pass = liveGateScore >= getMinGateScore(regime);
  const _rs = macroState?.leadingSectorRS ?? 0;
  const _stage = macroState?.sectorCycleStage;
  const _sectorAligned = _rs >= 60 || _stage === 'EARLY' || _stage === 'MID';
  const _conditionsMatched = reCheckGate.conditionKeys?.length ?? 0;

  const tierDecision = classifySizingTier({
    liveGate: liveGateScore,
    mtas: reCheckGate.mtas,
    gate1Pass: _gate1Pass,
    sectorAligned: _sectorAligned,
    conditionsMatched: _conditionsMatched,
  });

  if (tierDecision.tier === null) {
    return {
      ok: false,
      logMessage: `[AutoTrade/SizingTier] ${stockName} 티어 미달 — ${tierDecision.reason}`,
    };
  }

  // Idea 6: bandit 이 결정한 동적 예산으로 PROBING 슬롯 제어. 최소 = 레거시 PROBING_MAX_SLOTS (1).
  const probingBudget = Math.max(PROBING_MAX_SLOTS, banditDecision.budget);
  if (
    tierDecision.tier === 'PROBING' &&
    !canReserveBanditProbingSlot(probingReservedSlots, probingBudget)
  ) {
    return {
      ok: false,
      logMessage: `[AutoTrade/SizingTier] ${stockName} PROBING 슬롯 포화 (${probingReservedSlots}/${probingBudget}) — 스킵`,
    };
  }

  return {
    ok: true,
    tierDecision: { ...tierDecision, tier: tierDecision.tier },
    logMessages: [
      `[AutoTrade/SizingTier] ${stockName} → ${tierDecision.tier} (×${tierDecision.kellyFactor}) — ${tierDecision.reason}`,
    ],
  };
}
