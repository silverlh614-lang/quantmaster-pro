/**
 * systemInterferenceChecker.ts — 12개 아이디어 상호간섭 파라미터 충돌 감지기
 *
 * 각 시스템이 독립적으로 올바르게 작동하더라도, 동시에 실행될 때 파라미터가
 * 서로 충돌하여 잘못된 의사결정을 유발할 수 있다.
 *
 * 현재 감지 대상 충돌:
 *
 *   [CRITICAL] BUYING_HALTED_ENTRY_OPEN
 *     — 레짐 분류기: buyingHalted=true (RISK_OFF_CRISIS)
 *       포지션 생애주기: ENTRY 단계 진입 여전히 허용
 *
 *   [HIGH] REGIME_TYPE_MISMATCH
 *     — 레짐 분류기 4단계(MarketRegimeClassification) vs
 *       동적 손절 3단계(DynamicStopRegime) 자동 동기화 없음
 *
 *   [HIGH] LIFECYCLE_BREACH_THRESHOLD_MISMATCH
 *     — 레짐 분류기: gate1BreachThreshold가 레짐에 따라 1~3으로 동적 조정
 *       포지션 생애주기: FULL_EXIT 기준이 항상 고정 3으로 하드코딩
 *
 *   [MEDIUM] POSITION_SIZE_LIMIT_IGNORED
 *     — 레짐 분류기: positionSizeLimitPct=50 (RISK_OFF_CORRECTION)
 *       동적 손절 + 포지션 생애주기: 이 제한값을 수신하거나 반영하지 않음
 */

import type { MarketRegimeClassifierResult } from '../../types/macro';
import type { DynamicStopInput } from '../../types/sell';
import type { ParameterConflict, SystemInterferenceResult } from '../../types/interference';

// ─── 상수 ────────────────────────────────────────────────────────────────────

/** positionLifecycleEngine.ts 하드코딩 값 (변경 시 여기도 갱신 필요) */
const LIFECYCLE_FULL_EXIT_BREACH_COUNT = 3;
const LIFECYCLE_EXIT_PREP_BREACH_COUNT = 2;

/** positionSizeLimitPct 완전 허용 기준 */
const FULL_SIZE_LIMIT_PCT = 100;

// ─── 레짐 매핑 ───────────────────────────────────────────────────────────────

/**
 * MarketRegimeClassification(4단계) → DynamicStopRegime(3단계) 매핑.
 *
 * RISK_ON_BULL       → RISK_ON   (강세: ATR×2.0, 여유 손절)
 * RISK_ON_EARLY      → RISK_ON   (초기 강세: ATR×2.0, 동일 허용)
 * RISK_OFF_CORRECTION → RISK_OFF (조정: ATR×1.5, 타이트 손절)
 * RISK_OFF_CRISIS    → CRISIS    (위기: ATR×1.0, 초타이트 손절)
 */
export function mapClassificationToDynamicRegime(
  classification: MarketRegimeClassifierResult['classification'],
): DynamicStopInput['regime'] {
  switch (classification) {
    case 'RISK_ON_BULL':        return 'RISK_ON';
    case 'RISK_ON_EARLY':       return 'RISK_ON';
    case 'RISK_OFF_CORRECTION': return 'RISK_OFF';
    case 'RISK_OFF_CRISIS':     return 'CRISIS';
  }
}

// ─── 개별 충돌 감지 함수 ─────────────────────────────────────────────────────

/**
 * [CRITICAL] 매수 중단 신호 vs 포지션 생애주기 ENTRY 허용 충돌.
 *
 * 레짐 분류기가 RISK_OFF_CRISIS로 buyingHalted=true를 출력해도
 * positionLifecycleEngine은 이 값을 수신하지 않으므로 여전히 ENTRY를 허용한다.
 */
function detectBuyingHaltedConflict(
  regimeResult: MarketRegimeClassifierResult,
): ParameterConflict | null {
  if (!regimeResult.buyingHalted) return null;

  return {
    id: 'BUYING_HALTED_ENTRY_OPEN',
    severity: 'CRITICAL',
    systems: ['레짐 분류기', '포지션 생애주기'],
    title: '신규 매수 중단 신호 미반영 [CRITICAL]',
    description:
      `레짐 분류기가 ${regimeResult.classification} 레짐으로 신규 매수 전면 중단(buyingHalted=true)을 출력했으나, ` +
      '포지션 생애주기 엔진(positionLifecycleEngine)은 이 신호를 입력받지 않아 ENTRY 단계 진입이 여전히 허용됩니다. ' +
      '동시 실행 시 위기 레짐 중에도 신규 포지션이 개설될 수 있습니다.',
    resolution:
      '포지션 생애주기 엔진에 buyingHalted 파라미터를 주입하고, true인 경우 ENTRY → HOLD 전환을 차단하거나 경보를 발생시키세요. ' +
      '즉각 조치: 레짐 분류기 결과를 확인하고 ENTRY 단계를 수동으로 잠그세요.',
    parameterDetails: {
      expected: 'positionLifecycle.allowEntry = false (buyingHalted 반영)',
      actual:   'positionLifecycle.allowEntry = true (buyingHalted 미수신)',
    },
  };
}

/**
 * [HIGH] 레짐 분류기(4단계) ↔ 동적 손절(3단계) 레짐 타입 불일치.
 *
 * DynamicStopInput.regime을 수동으로 입력하므로 레짐 분류기 업데이트 후
 * 동적 손절 레짐을 갱신하지 않으면 다른 ATR 배수가 적용된다.
 */
function detectRegimeMismatchConflict(
  regimeResult: MarketRegimeClassifierResult,
  dynamicStopInput: DynamicStopInput,
): ParameterConflict | null {
  const expectedRegime = mapClassificationToDynamicRegime(regimeResult.classification);
  if (dynamicStopInput.regime === expectedRegime) return null;

  return {
    id: 'REGIME_TYPE_MISMATCH',
    severity: 'HIGH',
    systems: ['레짐 분류기', '동적 손절'],
    title: '레짐 타입 불일치: 동적 손절 레짐 미동기화 [HIGH]',
    description:
      `레짐 분류기는 현재 ${regimeResult.classification}로 분류하여 ` +
      `동적 손절 레짐 ${expectedRegime}(ATR×${expectedRegime === 'RISK_ON' ? '2.0' : expectedRegime === 'RISK_OFF' ? '1.5' : '1.0'})이 필요하지만, ` +
      `동적 손절 패널은 ${dynamicStopInput.regime}(ATR×${dynamicStopInput.regime === 'RISK_ON' ? '2.0' : dynamicStopInput.regime === 'RISK_OFF' ? '1.5' : '1.0'})으로 설정되어 있습니다. ` +
      '두 시스템을 동시에 운용하면 실제 시장 상황과 다른 ATR 배수로 손절가가 계산됩니다.',
    resolution:
      `동적 손절 패널에서 레짐을 ${expectedRegime}로 수동 변경하거나, ` +
      '레짐 분류기 결과가 변경될 때 동적 손절 레짐도 자동으로 동기화하는 로직을 추가하세요.',
    parameterDetails: {
      expected: `dynamicStop.regime = ${expectedRegime}`,
      actual:   `dynamicStop.regime = ${dynamicStopInput.regime}`,
    },
  };
}

/**
 * [HIGH] 포지션 생애주기 Gate1 이탈 임계값 vs 레짐 조정 임계값 불일치.
 *
 * positionLifecycleEngine은 FULL_EXIT 기준으로 항상 3개를 사용하지만,
 * RISK_OFF_CRISIS 레짐에서 레짐 분류기는 gate1BreachThreshold=1을 출력한다.
 * 이는 위기 레짐에서 1개 이탈 시에도 전량 청산이 필요함을 의미하므로 충돌이다.
 */
function detectLifecycleBreachThresholdConflict(
  regimeResult: MarketRegimeClassifierResult,
): ParameterConflict | null {
  const regimeThreshold = regimeResult.gate1BreachThreshold;
  // 충돌: 레짐 분류기의 임계값이 생애주기의 고정 기준보다 엄격할 때
  if (regimeThreshold >= LIFECYCLE_FULL_EXIT_BREACH_COUNT) return null;

  const isMoreSevere = regimeThreshold < LIFECYCLE_EXIT_PREP_BREACH_COUNT;
  const severity = isMoreSevere ? 'HIGH' : 'HIGH';

  return {
    id: 'LIFECYCLE_BREACH_THRESHOLD_MISMATCH',
    severity,
    systems: ['레짐 분류기', '포지션 생애주기'],
    title: 'Gate 1 이탈 임계값 불일치: 포지션 생애주기 하드코딩 [HIGH]',
    description:
      `레짐 분류기가 ${regimeResult.classification} 레짐에서 gate1BreachThreshold=${regimeThreshold}을 출력하여 ` +
      `Gate 1 ${regimeThreshold}개 이탈 시 즉각 대응이 필요함을 나타내지만, ` +
      `포지션 생애주기 엔진은 FULL_EXIT 기준이 항상 ${LIFECYCLE_FULL_EXIT_BREACH_COUNT}개로 고정되어 있습니다. ` +
      `${regimeResult.classification} 레짐에서는 ${regimeThreshold}개 이탈만으로도 전량 청산을 고려해야 하나, ` +
      `${LIFECYCLE_FULL_EXIT_BREACH_COUNT}개가 될 때까지 포지션이 유지됩니다.`,
    resolution:
      `positionLifecycleEngine.ts의 FULL_EXIT_BREACH_COUNT를 레짐 분류기의 gate1BreachThreshold 값으로 ` +
      '동적으로 주입받도록 evaluatePositionLifecycle() 함수 시그니처를 변경하세요. ' +
      `현재 레짐(${regimeResult.classification})에서는 Gate 1 이탈 ${regimeThreshold}개 초과 시 즉각 청산을 권고합니다.`,
    parameterDetails: {
      expected: `positionLifecycle.fullExitBreachCount = ${regimeThreshold} (레짐 조정)`,
      actual:   `positionLifecycle.fullExitBreachCount = ${LIFECYCLE_FULL_EXIT_BREACH_COUNT} (하드코딩)`,
    },
  };
}

/**
 * [MEDIUM] 포지션 사이즈 제한 미반영.
 *
 * 레짐 분류기가 positionSizeLimitPct < 100을 출력해도
 * 동적 손절과 포지션 생애주기는 이 값을 수신하거나 반영하지 않는다.
 */
function detectPositionSizeLimitConflict(
  regimeResult: MarketRegimeClassifierResult,
): ParameterConflict | null {
  if (regimeResult.positionSizeLimitPct >= FULL_SIZE_LIMIT_PCT) return null;

  return {
    id: 'POSITION_SIZE_LIMIT_IGNORED',
    severity: 'MEDIUM',
    systems: ['레짐 분류기', '동적 손절', '포지션 생애주기'],
    title: `포지션 사이즈 ${regimeResult.positionSizeLimitPct}% 제한 미반영 [MEDIUM]`,
    description:
      `레짐 분류기가 ${regimeResult.classification} 레짐에서 positionSizeLimitPct=${regimeResult.positionSizeLimitPct}%를 출력하여 ` +
      `포지션을 최대 ${regimeResult.positionSizeLimitPct}%로 제한해야 하지만, ` +
      '동적 손절 엔진과 포지션 생애주기 엔진 모두 이 제한값을 입력받지 않습니다. ' +
      '실제 포지션 사이즈 결정 시 이 제약이 반영되지 않을 수 있습니다.',
    resolution:
      `주문 실행 단계에서 레짐 분류기의 positionSizeLimitPct(${regimeResult.positionSizeLimitPct}%)를 ` +
      '적용하여 최대 허용 매수 수량을 제한하세요. ' +
      '동적 손절 계산에도 축소된 포지션 사이즈를 기반으로 손절가를 산정해야 합니다.',
    parameterDetails: {
      expected: `positionSizePct ≤ ${regimeResult.positionSizeLimitPct}% (레짐 제한 반영)`,
      actual:   'positionSizePct = 100% (제한 미수신)',
    },
  };
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 레짐 분류기 ↔ 동적 손절 ↔ 포지션 생애주기 간 파라미터 충돌을 전수 검사한다.
 *
 * @param regimeResult   - 시장 레짐 자동 분류기 결과 (null이면 검사 불가)
 * @param dynamicStopInput - 동적 손절 현재 입력값
 * @returns 감지된 충돌 목록과 요약 정보
 */
export function checkSystemInterference(
  regimeResult: MarketRegimeClassifierResult | null,
  dynamicStopInput: DynamicStopInput,
): SystemInterferenceResult {
  const checkedAt = new Date().toISOString();

  if (!regimeResult) {
    return {
      conflicts: [],
      totalConflicts: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      hasBlockingConflict: false,
      summary: '레짐 분류기 결과가 없어 충돌 검사를 수행할 수 없습니다. 시장 레짐 자동 분류기를 먼저 실행하세요.',
      checkedAt,
    };
  }

  const detectors = [
    detectBuyingHaltedConflict(regimeResult),
    detectRegimeMismatchConflict(regimeResult, dynamicStopInput),
    detectLifecycleBreachThresholdConflict(regimeResult),
    detectPositionSizeLimitConflict(regimeResult),
  ];

  const conflicts: ParameterConflict[] = detectors.filter(
    (c): c is ParameterConflict => c !== null,
  );

  const criticalCount = conflicts.filter(c => c.severity === 'CRITICAL').length;
  const highCount     = conflicts.filter(c => c.severity === 'HIGH').length;
  const mediumCount   = conflicts.filter(c => c.severity === 'MEDIUM').length;
  const hasBlockingConflict = criticalCount > 0;

  let summary: string;
  if (conflicts.length === 0) {
    summary = `✅ 정합성 검사 통과 — 레짐 분류기·동적 손절·포지션 생애주기 간 파라미터 충돌 없음 (${regimeResult.classification} 레짐 기준)`;
  } else if (hasBlockingConflict) {
    summary = `🚨 즉각 조치 필요 — ${criticalCount}건 CRITICAL 충돌 감지. 현재 운용을 중단하고 충돌을 해소하세요.`;
  } else {
    summary = `⚠️ ${conflicts.length}건 충돌 감지 (CRITICAL 0 / HIGH ${highCount} / MEDIUM ${mediumCount}) — 파라미터 동기화 후 운용을 계속하세요.`;
  }

  return {
    conflicts,
    totalConflicts: conflicts.length,
    criticalCount,
    highCount,
    mediumCount,
    hasBlockingConflict,
    summary,
    checkedAt,
  };
}
