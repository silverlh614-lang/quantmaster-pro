/**
 * sellEngine.ts — 매도 로직 4레이어
 *
 * 4개의 독립 레이어가 동시에 작동하며 먼저 발동하는 것이 이긴다.
 *
 * L1 기계적 손절  → 감정 개입 불가, 즉시 시장가 (최우선)
 * L2 펀더멘털 붕괴 → Pre-Mortem 5조건, 조건 도달 즉시 자동 청산
 * L3 분할 익절    → 수익 단계적 확정 + 트레일링 스톱
 * L4 과열 탐지    → 탐욕 차단, 4개 신호 중 3개 이상 시 50% 익절
 *
 * 설계 원칙:
 * - 모든 함수는 순수 함수 (Pure Function) — 비동기 데이터 페칭은 호출자가 담당
 * - autoTradeEngine.ts(서버)가 현재 데이터를 주입하여 호출
 * - L1이 없으면 나머지는 의미 없음 → 구현 우선순위: L1 → L3 → L2 → L4
 */

import type {
  ActivePosition,
  SellSignal,
  PreMortemTrigger,
  PreMortemData,
  EuphoriaData,
  TakeProfitTarget,
} from '../../types/sell';
import type { RegimeLevel } from '../../types/core';
import { REGIME_CONFIGS } from './regimeEngine';

// ─── L3: 분할 익절 타겟 맵 ────────────────────────────────────────────────────

/**
 * 레짐별 분할 익절 타겟 배열.
 * REGIME_CONFIGS.takeProfitPartial과 일관성 유지, 배열 형식으로 재정의.
 * trigger=null → 트레일링 스톱 트랜치.
 */
export const PROFIT_TARGETS: Record<RegimeLevel, TakeProfitTarget[]> = {
  R1_TURBO: [
    { trigger: 0.15, ratio: 0.30, type: 'LIMIT' },
    { trigger: 0.25, ratio: 0.30, type: 'LIMIT' },
    { trigger: null, ratio: 0.40, type: 'TRAILING', trailPct: 0.10 },
  ],
  R2_BULL: [
    { trigger: 0.12, ratio: 0.30, type: 'LIMIT' },
    { trigger: 0.20, ratio: 0.30, type: 'LIMIT' },
    { trigger: null, ratio: 0.40, type: 'TRAILING', trailPct: 0.08 },
  ],
  R3_EARLY: [
    { trigger: 0.10, ratio: 0.25, type: 'LIMIT' },
    { trigger: 0.18, ratio: 0.35, type: 'LIMIT' },
    { trigger: null, ratio: 0.40, type: 'TRAILING', trailPct: 0.07 },
  ],
  R4_NEUTRAL: [
    { trigger: 0.08, ratio: 0.40, type: 'LIMIT' },
    { trigger: 0.12, ratio: 0.40, type: 'LIMIT' },
    { trigger: 0.18, ratio: 0.20, type: 'LIMIT' },  // 트레일링 없음 — 빠른 확정
  ],
  R5_CAUTION: [
    { trigger: 0.06, ratio: 0.50, type: 'LIMIT' },  // 초단기 익절
    { trigger: 0.10, ratio: 0.50, type: 'LIMIT' },
  ],
  R6_DEFENSE: [],  // 신규 매수 없음 → 익절 타겟 없음
};

// ─── 현재 수익률 계산 ────────────────────────────────────────────────────────

export function calcPositionReturn(position: ActivePosition): number {
  return (position.currentPrice - position.entryPrice) / position.entryPrice;
}

// ─── L1: 기계적 손절 (최우선, 인간 개입 금지) ────────────────────────────────

/**
 * 현재 수익률이 레짐·프로파일별 손절 기준에 도달했는지 확인.
 *
 * 반환값:
 *   HARD_STOP        — 전량 즉시 시장가 매도
 *   REVALIDATE_GATE1 — -7% 경보, Gate 1 재검증 요청 (ratio=0, 매도 아님)
 *   null             — 이상 없음
 *
 * R6 레짐: 블랙스완 → 기존 포지션 30% 즉시 청산 (REGIME_CONFIGS.emergencyExit)
 */
export function checkHardStopLoss(
  position: ActivePosition,
  regime: RegimeLevel,
): SellSignal | null {
  const currentReturn = calcPositionReturn(position);

  // R6 비상 청산 (30% 즉시 시장가)
  if (regime === 'R6_DEFENSE') {
    return {
      action: 'HARD_STOP',
      ratio: 0.30,
      orderType: 'MARKET',
      severity: 'CRITICAL',
      reason: `R6 DEFENSE 비상 청산 (30%). 현재 수익률 ${(currentReturn * 100).toFixed(1)}%`,
    };
  }

  // 프로파일별 손절 비율 조회
  const profileKey = `profile${position.profile}` as keyof typeof REGIME_CONFIGS[typeof regime]['stopLoss'];
  const stopRate = REGIME_CONFIGS[regime].stopLoss[profileKey];

  if (currentReturn <= stopRate) {
    return {
      action: 'HARD_STOP',
      ratio: 1.0,
      orderType: 'MARKET',
      severity: 'CRITICAL',
      reason: `손절 발동: ${(currentReturn * 100).toFixed(1)}% / 기준: ${(stopRate * 100).toFixed(1)}%`,
    };
  }

  // -7% 경보 → Gate 1 재검증 요청 (이미 재검증했으면 skip)
  if (currentReturn <= -0.07 && !position.revalidated) {
    return {
      action: 'REVALIDATE_GATE1',
      ratio: 0,
      orderType: 'MARKET',
      reason: `-7% 도달. Gate 1 재검증 실행 필요.`,
    };
  }

  return null;
}

// ─── L2: 펀더멘털 붕괴 (Pre-Mortem 5조건) ────────────────────────────────────

/**
 * 5가지 Pre-Mortem 조건을 평가, 위반된 트리거 배열을 반환.
 * 호출자(autoTradeEngine)가 최신 시장 데이터를 PreMortemData로 주입.
 *
 * 조건 1. ROE 유형 전이   — 유형 3 → 4 이상 시 50% 청산
 * 조건 2. 외국인 순매도   — 5일 누적 순매도 시 30% 청산
 * 조건 3. 데드크로스       — MA20 < MA60 교차 시 전량 청산
 * 조건 4. R6 레짐 전환    — 30% 즉시 청산
 * 조건 5. 고점 대비 -30% — 추세 붕괴 선언, 전량 청산
 */
export function evaluatePreMortems(
  position: ActivePosition,
  data: PreMortemData,
): PreMortemTrigger[] {
  const triggers: PreMortemTrigger[] = [];

  // 1. ROE 유형 전이
  if (
    position.entryROEType === 3 &&
    data.currentROEType !== undefined &&
    data.currentROEType >= 4
  ) {
    triggers.push({
      type: 'ROE_DRIFT',
      severity: 'HIGH',
      sellRatio: 0.50,
      reason: `ROE 유형 전이: 유형 3 → ${data.currentROEType}. 50% 청산.`,
    });
  }

  // 2. 외국인 5일 순매도
  if (data.foreignNetBuy5d < 0) {
    triggers.push({
      type: 'FOREIGN_SELLOUT',
      severity: 'MEDIUM',
      sellRatio: 0.30,
      reason: `외국인 5일 누적 순매도 ${Math.round(data.foreignNetBuy5d)}억. 30% 청산.`,
    });
  }

  // 3. 데드크로스 (20일선이 60일선 아래로 교차)
  const prevMa20 = position.prevMa20 ?? data.ma20;
  const prevMa60 = position.prevMa60 ?? data.ma60;
  const wasAbove  = prevMa20 >= prevMa60;
  const isBelow   = data.ma20 < data.ma60;
  if (wasAbove && isBelow) {
    triggers.push({
      type: 'MA_DEATH_CROSS',
      severity: 'HIGH',
      sellRatio: 1.0,
      reason: `20일선 데드크로스 (MA20 ${data.ma20.toFixed(0)} < MA60 ${data.ma60.toFixed(0)}). 전량 청산.`,
    });
  }

  // 4. R6 레짐 전환
  if (data.currentRegime === 'R6_DEFENSE') {
    triggers.push({
      type: 'REGIME_DEFENSE',
      severity: 'CRITICAL',
      sellRatio: 0.30,
      reason: 'R6 DEFENSE 레짐 전환. 기존 포지션 30% 즉시 청산.',
    });
  }

  // 5. 고점 대비 -30% 추세 붕괴
  const drawdown = (position.currentPrice - position.highSinceEntry) / position.highSinceEntry;
  if (drawdown <= -0.30) {
    triggers.push({
      type: 'TREND_COLLAPSE',
      severity: 'CRITICAL',
      sellRatio: 1.0,
      reason: `고점 대비 ${(drawdown * 100).toFixed(1)}% 추세 붕괴. 전량 청산.`,
    });
  }

  return triggers;
}

// ─── L3: 분할 익절 체크 ──────────────────────────────────────────────────────

/**
 * 현재 수익률이 미달성 익절 타겟에 도달했는지 확인.
 * 이미 실현된 타겟(position.takenProfit)은 건너뜀.
 * @returns 발동된 PROFIT_TAKE 신호 배열 (동시에 복수 발동 가능)
 */
export function checkProfitTargets(
  position: ActivePosition,
  regime: RegimeLevel,
): SellSignal[] {
  const signals: SellSignal[] = [];
  const targets = PROFIT_TARGETS[regime];
  const currentReturn = calcPositionReturn(position);

  for (const target of targets) {
    if (target.type !== 'LIMIT' || target.trigger === null) continue;
    if (position.takenProfit.includes(target.trigger)) continue;
    if (currentReturn < target.trigger) continue;

    signals.push({
      action: 'PROFIT_TAKE',
      ratio: target.ratio,
      orderType: 'LIMIT',
      price: position.currentPrice,
      reason: `익절 달성: +${(target.trigger * 100).toFixed(0)}%, ${(target.ratio * 100).toFixed(0)}% 매도`,
    });
  }

  return signals;
}

// ─── L3: 트레일링 스톱 ───────────────────────────────────────────────────────

/**
 * 트레일링 스톱 발동 여부 확인.
 * position.trailingHighWaterMark는 호출자가 updateTrailingHighWaterMark()로 매 사이클 갱신.
 */
export function checkTrailingStop(position: ActivePosition): SellSignal | null {
  if (!position.trailingEnabled) return null;

  const trailDrop =
    (position.currentPrice - position.trailingHighWaterMark) /
    position.trailingHighWaterMark;

  if (trailDrop <= -position.trailPct) {
    return {
      action: 'TRAILING_STOP',
      ratio: position.trailingRemainingRatio,
      orderType: 'LIMIT',
      price: position.currentPrice,
      reason: `트레일링 발동: 고점(${position.trailingHighWaterMark.toLocaleString()}원) 대비 ${(trailDrop * 100).toFixed(1)}%`,
    };
  }

  return null;
}

/**
 * 신고가 갱신 시 트레일링 고점을 업데이트.
 * @returns 갱신된 trailingHighWaterMark 값
 */
export function updateTrailingHighWaterMark(position: ActivePosition): number {
  return Math.max(position.trailingHighWaterMark, position.currentPrice);
}

/**
 * 마지막 LIMIT 익절 완료 후 트레일링 스톱 활성화.
 * PROFIT_TARGETS 중 TRAILING 타입 항목을 찾아 trailPct와 trailingRemainingRatio를 반환.
 * @returns 트레일링 설정 (없으면 null)
 */
export function resolveTrailingConfig(
  regime: RegimeLevel,
): { trailPct: number; ratio: number } | null {
  const trailing = PROFIT_TARGETS[regime].find(t => t.type === 'TRAILING');
  if (!trailing || trailing.trailPct === undefined) return null;
  return { trailPct: trailing.trailPct, ratio: trailing.ratio };
}

// ─── L4: 과열 탐지 (탐욕 차단) ──────────────────────────────────────────────

/**
 * 4가지 과열 신호 중 3개 이상 동시 발동 시 50% 익절 신호 반환.
 * 하루 1회 호출 권장 (1일 1회 과열 체크).
 *
 * RSI_OVERBOUGHT    — RSI(14) > 80
 * VOLUME_EXPLOSION  — 거래량 20일 평균 대비 ×3.0 이상
 * RETAIL_DOMINANCE  — 개인 매수 비율 60% 초과
 * ANALYST_FRENZY    — 30일 내 증권사 목표가 상향 5건 이상
 */
export function evaluateEuphoria(
  position: ActivePosition,
  data: EuphoriaData,
): SellSignal | null {
  const signals: string[] = [];

  if (data.rsi14                  > 80)  signals.push('RSI_OVERBOUGHT');
  if (data.volumeRatio            > 3.0) signals.push('VOLUME_EXPLOSION');
  if (data.retailRatio            > 0.60) signals.push('RETAIL_DOMINANCE');
  if (data.analystUpgradeCount30d >= 5)  signals.push('ANALYST_FRENZY');

  if (signals.length < 3) return null;

  return {
    action: 'EUPHORIA_SELL',
    ratio: 0.50,
    orderType: 'LIMIT',
    price: position.currentPrice,
    severity: 'HIGH',
    reason: `과열 탐지 (${signals.length}/4개): ${signals.join(', ')}. 50% 익절.`,
  };
}

// ─── 통합 매도 사이클 실행기 ─────────────────────────────────────────────────

/**
 * 단일 포지션에 대한 완전한 매도 평가 실행 (L1 → L3 → L2 → L4 순).
 *
 * autoTradeEngine.ts(서버)의 runSellCycle()에서 각 포지션에 대해 호출.
 * 비동기 데이터 페칭 후 이 함수에 순수 데이터를 주입한다.
 *
 * @returns 발동된 매도 신호 배열 (빈 배열 = 아무것도 없음)
 */
export function evaluateSellSignals(opts: {
  position: ActivePosition;
  regime: RegimeLevel;
  preMortemData: PreMortemData;
  euphoriaData: EuphoriaData | null;  // null = 오늘 이미 체크했거나 데이터 미수집
}): SellSignal[] {
  const { position, regime, preMortemData, euphoriaData } = opts;
  const results: SellSignal[] = [];

  // L1: 하드 손절 (최우선 — 발동 시 하위 레이어 건너뜀)
  const stopSignal = checkHardStopLoss(position, regime);
  if (stopSignal) {
    results.push(stopSignal);
    // HARD_STOP 발동 시 나머지 레이어 평가 불필요
    if (stopSignal.action === 'HARD_STOP') return results;
  }

  // L3: 분할 익절 (L2보다 먼저 — 수익 확정 우선)
  const profitSignals = checkProfitTargets(position, regime);
  results.push(...profitSignals);

  // L3: 트레일링 스톱
  const trailSignal = checkTrailingStop(position);
  if (trailSignal) results.push(trailSignal);

  // L2: Pre-Mortem 펀더멘털 붕괴
  const preMortems = evaluatePreMortems(position, preMortemData);
  for (const pm of preMortems) {
    results.push({
      action: 'PRE_MORTEM',
      ratio: pm.sellRatio,
      orderType: 'MARKET',
      severity: pm.severity,
      reason: pm.reason,
    });
  }

  // L4: 과열 탐지 (당일 데이터 있을 때만)
  if (euphoriaData) {
    const euphSignal = evaluateEuphoria(position, euphoriaData);
    if (euphSignal) results.push(euphSignal);
  }

  return results;
}
