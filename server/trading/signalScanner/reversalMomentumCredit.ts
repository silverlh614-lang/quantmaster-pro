// @responsibility ADR-0594 Gate1 reversal momentum credit 순수 판정 SSOT — risk-on 국면 한정 종목 오늘 단일일 강세(changePercent)를 PRICE_MOMENTUM 에 bounded 양수 보너스로 산출(default OFF).
/**
 * reversalMomentumCredit.ts — ADR-0594 D1 순수 평가 SSOT.
 *
 * ADR-0593 `riskOnFastUpgrade.ts`(레짐판) 동형 분리. 다일집계(return5d/return20d)
 * 후행으로 묻힌 폭락-다음날 강반등 리더를 risk-on 국면에서만 PRICE_MOMENTUM 점수에
 * bounded 양수 보너스로 차별 가산한다. ADR-0467 양수 컴포넌트 회계 정합 — 가산은
 * 점수를 올리기만 하며 PRICE_MOMENTUM maxScore 20 천장은 소비처(clamp)가 보존한다.
 *
 * 게이트 = ADR-0593 canonical RISK_ON_REGIMES(R1_TURBO/R2_BULL/R3_EARLY) 재사용 (D3).
 * 이 집합으로 게이팅하면 ADR-0593 fast-upgrade(breadth+VKOSPI 통과 시에만 R3 승급)를
 * transitively 상속 — breadth/VKOSPI 재게이팅 불필요(이중게이트 회피).
 *
 * default OFF: ENV GATE1_REVERSAL_MOMENTUM_ENABLED !== 'true' → 항상 0 (byte-equivalent).
 * 데이터 부재(changePercent undefined/비유한) → 보수적 0 (불변식 #6: 결손≠signal, bullish/
 * bearish 로 변환 금지). 순수 함수 — provider/store/now 호출 0.
 */

/** ADR-0593 canonical risk-on 레짐 집합(pipelineHelpers.ts:643 SSOT 재사용). 가산 게이트. */
const RISK_ON_REGIMES: ReadonlyArray<string> = ['R1_TURBO', 'R2_BULL', 'R3_EARLY'];

/** ADR-0594 reversal momentum credit 활성화 여부 — 정확 비교(=== 'true'). default OFF. */
export function isGate1ReversalMomentumEnabled(): boolean {
  return process.env.GATE1_REVERSAL_MOMENTUM_ENABLED === 'true';
}

/** ADR-0594 가산 시작 임계 T_min(%) — ENV GATE1_REVERSAL_MOMENTUM_T_MIN_PCT, default 3.0. noise floor. */
export function gate1ReversalMomentumTMinPct(): number {
  const raw = Number(process.env.GATE1_REVERSAL_MOMENTUM_T_MIN_PCT);
  return Number.isFinite(raw) && raw > 0 ? raw : 3.0;
}

/** ADR-0594 과열 상한 임계 T_cap(%) — ENV GATE1_REVERSAL_MOMENTUM_T_CAP_PCT, default 12.0. 위는 가산 미증가(cap). */
export function gate1ReversalMomentumTCapPct(): number {
  const raw = Number(process.env.GATE1_REVERSAL_MOMENTUM_T_CAP_PCT);
  return Number.isFinite(raw) && raw > 0 ? raw : 12.0;
}

/** ADR-0594 보너스 상한 MAX_BONUS(점수) — ENV GATE1_REVERSAL_MOMENTUM_MAX_BONUS, default 8. PRICE_MOMENTUM maxScore 20 내 일부. */
export function gate1ReversalMomentumMaxBonus(): number {
  const raw = Number(process.env.GATE1_REVERSAL_MOMENTUM_MAX_BONUS);
  return Number.isFinite(raw) && raw > 0 ? raw : 8;
}

export interface ReversalMomentumCreditInput {
  /** 종목의 오늘 단일일 등락률(%). quote.changePercent / prdy_ctrt. 부재/비유한 → 0(보수). */
  todayChangePercent?: number;
  /** 현재 레짐(R1_TURBO/R2_BULL/R3_EARLY/R4_NEUTRAL/...). risk-on 집합 외 → 0. */
  regime?: string;
}

export interface ReversalMomentumCreditResult {
  /** PRICE_MOMENTUM weightedScore 에 더할 bounded 양수 보너스(점수, 0~MAX_BONUS). */
  bonus: number;
  /** 가산 발동 여부(bonus > 0). */
  applied: boolean;
  /** 미발동/발동 사유(진단 가시화, SDS 정책 — silent 금지). */
  reason: string;
}

const ZERO = (reason: string): ReversalMomentumCreditResult => ({
  bonus: 0,
  applied: false,
  reason,
});

/**
 * ADR-0594: reversal momentum credit 양수 보너스 산출(순수).
 *
 * flag OFF → 항상 bonus 0(byte-equivalent). risk-on 게이트 + changePercent 충족 시에만 가산.
 * 가산 공식: c < T_min → 0(noise 격리), T_min~T_cap 선형 가산 → MAX_BONUS, c > T_cap →
 * MAX_BONUS cap(과급등 추격은 regime-gate 가 이미 차단 — 역가산 아님). bonus 는 항상 0~MAX_BONUS.
 */
export function computeReversalMomentumCredit(
  input: ReversalMomentumCreditInput,
): ReversalMomentumCreditResult {
  if (!isGate1ReversalMomentumEnabled()) {
    return ZERO('DISABLED');
  }

  // regime 게이트 — risk-on(ADR-0593 RISK_ON_REGIMES) 외 → 0(byte-equivalent for normal/bear).
  const regime = input.regime;
  if (regime === undefined || !RISK_ON_REGIMES.includes(regime)) {
    return ZERO(`REGIME_NOT_RISK_ON:${regime ?? 'UNDEFINED'}`);
  }

  // 오늘 강세 입력 — 부재/비유한 → 0(불변식 #6: 결손≠signal, falling-knife 방지).
  const c = input.todayChangePercent;
  if (c === undefined || !Number.isFinite(c)) {
    return ZERO('TODAY_CHANGE_PERCENT_MISSING');
  }

  const tMin = gate1ReversalMomentumTMinPct();
  const tCap = gate1ReversalMomentumTCapPct();
  const maxBonus = gate1ReversalMomentumMaxBonus();

  // noise floor — 미미한 상승은 미보상.
  if (c < tMin) {
    return ZERO(`BELOW_T_MIN:${c.toFixed(2)}<${tMin}`);
  }

  // T_cap 초과 과급등 → MAX_BONUS cap(가산 미증가). 고립 급등 추격은 regime-gate 가 이미 차단.
  if (c >= tCap) {
    return {
      bonus: maxBonus,
      applied: true,
      reason: `CAP:${c.toFixed(2)}>=${tCap}`,
    };
  }

  // T_min~T_cap 선형 가산 → 0~MAX_BONUS. (tCap > tMin 보장: 둘 다 양수, tCap default 12 > tMin 3;
  // ENV 오설정으로 tCap<=tMin 이면 span<=0 → 위 c>=tCap 분기가 먼저 cap 처리하므로 0분모 도달 불가.)
  const span = tCap - tMin;
  const bonus = (maxBonus * (c - tMin)) / span;
  // bounded 0~MAX_BONUS (방어적 clamp — 위 분기로 이미 범위 내).
  const clamped = Math.max(0, Math.min(maxBonus, bonus));
  return {
    bonus: clamped,
    applied: clamped > 0,
    reason: `LINEAR:${c.toFixed(2)}@[${tMin},${tCap}]`,
  };
}

/** ADR-0594 PRICE_MOMENTUM 진단(behavior-neutral) rawValue 필드 — 표시 전용. */
export interface ReversalMomentumDiagnostic {
  reversalCreditApplied: boolean;
  reversalBonus: number;
  reversalGateReason: string;
  reversalTodayChangePercent?: number;
}

/**
 * ADR-0594 D2 call-site 헬퍼 — credit 산출 + maxScore 20 천장 clamp applier + 진단 필드 묶음.
 * minimumSignalScoreTrace.priceMomentumScore call-site 가 단일 호출로 가산을 적용하도록 SSOT 격리
 * (양수 보너스만, flag OFF → bonus 0 → byte-equivalent).
 */
export function buildPriceMomentumReversalApplier(
  todayChangePercent: number | undefined,
  regime: string | undefined,
): {
  credit: ReversalMomentumCreditResult;
  /** weightedScore 에 양수 보너스 가산 후 0~20 clamp(ADR-0467 양수 회계, maxScore 20 천장 불변). */
  apply: (weightedScore: number) => number;
  diagnostic: ReversalMomentumDiagnostic;
} {
  const credit = computeReversalMomentumCredit({ todayChangePercent, regime });
  return {
    credit,
    apply: (weightedScore: number) =>
      Math.max(0, Math.min(20, weightedScore + credit.bonus)),
    diagnostic: {
      reversalCreditApplied: credit.applied,
      reversalBonus: Math.round(credit.bonus * 10) / 10,
      reversalGateReason: credit.reason,
      reversalTodayChangePercent: todayChangePercent,
    },
  };
}
