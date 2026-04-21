/**
 * @responsibility 수동 청산 시 기계가 판단하고 있던 맥락(대기 규칙·손절/목표 거리·행동 편향 추정)을 구조화한다.
 *
 * exitRuleTag === 'MANUAL_EXIT' 과 한 쌍으로 Shadow 상태에 부착되어,
 * Nightly Reflection 이 "왜 사용자가 기계를 추월했는가" 를 학습하는 입력이 된다.
 *
 * 편향 추정 휴리스틱 (0~1, 높을수록 해당 편향 강함):
 *   - regretAvoidance   : 수익 중일 때 목표가까지 멀수록 ↑ (이익 확정 서두름)
 *   - endowmentEffect   : 손실 중일 때 손절선까지 여유가 있는데도 닫으면 ↑ (손실 인정 회피 실패)
 *   - panicSelling      : 손실 중이고 손절선에 근접할수록 ↑, 특히 reasonCode==PANIC 시 가중
 */

import type {
  ServerShadowTrade,
  ManualExitContext,
  ExitRuleTag,
} from '../persistence/shadowTradeRepo.js';

export interface BuildManualExitContextInput {
  target: ServerShadowTrade;
  currentPrice: number;
  reasonCode: ManualExitContext['reasonCode'];
  userNote?: string;
  nowIso?: string;
  /** exitEngine 등 자동 경로가 대기 중이던 규칙을 알고 있다면 전달 */
  activeRule?: ExitRuleTag;
}

/** 수치를 [0,1] 로 클램프. NaN/Infinity 은 0 으로 환산. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * 진입가·현재가·손절·목표 기준으로 편향 스코어를 추정한다.
 * 동일 입력 → 동일 출력(순수 함수). 테스트 친화적.
 */
export function estimateBiasAssessment(
  target: ServerShadowTrade,
  currentPrice: number,
  reasonCode: ManualExitContext['reasonCode'],
): ManualExitContext['biasAssessment'] {
  const entry = target.shadowEntryPrice;
  const returnPct = entry > 0 ? ((currentPrice - entry) / entry) * 100 : 0;
  const stop = target.hardStopLoss ?? target.stopLoss;
  const target_ = target.targetPrice;

  // 손절/목표까지의 거리(%)
  const distStop = stop > 0 ? ((currentPrice - stop) / currentPrice) * 100 : 0;
  const distTarget = target_ > 0 ? ((target_ - currentPrice) / currentPrice) * 100 : 0;

  // 수익 중이고 목표가 먼 상태에서 닫으면 regretAvoidance 가중
  const regretRaw = returnPct > 0 ? distTarget / 15 : 0; // 15% 이상 남으면 1.0 수렴
  const regretAvoidance = clamp01(regretRaw);

  // 손실 중이고 손절선에 여유 있는데 닫으면 endowmentEffect 반전 가중(관성 깨짐)
  const endowRaw = returnPct < 0 ? distStop / 10 : 0; // 10% 이상 여유면 1.0
  const endowmentEffect = clamp01(endowRaw);

  // 손실 + 손절 근접 → panicSelling. PANIC 사유면 강하게 부스트.
  const panicBase = returnPct < 0 ? 1 - clamp01(distStop / 10) : 0;
  const panicBoost = reasonCode === 'USER_PANIC' ? 0.3 : 0;
  const panicSelling = clamp01(panicBase + panicBoost);

  return {
    regretAvoidance: Number(regretAvoidance.toFixed(3)),
    endowmentEffect: Number(endowmentEffect.toFixed(3)),
    panicSelling: Number(panicSelling.toFixed(3)),
  };
}

export function buildManualExitContext(input: BuildManualExitContextInput): ManualExitContext {
  const { target, currentPrice, reasonCode, userNote, activeRule } = input;
  const stop = target.hardStopLoss ?? target.stopLoss;
  const target_ = target.targetPrice;
  const distanceToStop = currentPrice > 0 && stop > 0
    ? Number((((currentPrice - stop) / currentPrice) * 100).toFixed(2))
    : 0;
  const distanceToTarget = currentPrice > 0 && target_ > 0
    ? Number((((target_ - currentPrice) / currentPrice) * 100).toFixed(2))
    : 0;

  return {
    triggeredAt: input.nowIso ?? new Date().toISOString(),
    reasonCode,
    currentMachineVerdict: {
      activeRule,
      distanceToStop,
      distanceToTarget,
    },
    biasAssessment: estimateBiasAssessment(target, currentPrice, reasonCode),
    userNote,
  };
}

export const __test = { clamp01 };
