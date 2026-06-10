/**
 * @responsibility ADR-0119 emptyScanClassifier SSOT 회귀 테스트
 *
 * 7값 분류 + boundary + UNKNOWN fallback + describeEmptyScanReason 라벨 정합 검증.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyEmptyScanReason,
  describeEmptyScanReason,
  EMPTY_SCAN_CLASSIFIER_THRESHOLDS,
  type EmptyScanReason,
} from './emptyScanClassifier.js';
import type { MacroGateState, ScanSummary, WaitDistribution } from './scanDiagnostics.js';

const baseMacro: MacroGateState = {
  emergencyStop: false,
  autoTradeEnabled: true,
  regime: 'R3_EARLY',
  kellyMultiplierFromRegime: 1.0,
  fomcPhase: 'NORMAL',
  fomcKellyMultiplier: 1.0,
  finalKellyMultiplier: 1.0,
  vixGatingActive: false,
  bearDefenseMode: false,
  mhsBelow30: false,
  watchlistEmpty: false,
  sellOnlyMode: false,
};

const baseWait: WaitDistribution = {
  dataHold: 0,
  preBreakout: 0,
  gateFail: 0,
  sizingBlocked: 0,
  driftRemove: 0,
  corpAction: 0,
  volumeDrop: 0,
  other: 0,
};

function makeSummary(overrides: Partial<ScanSummary> & {
  candidates: number;
  entries: number;
}): ScanSummary {
  const { candidates, entries, waitDistribution, macroGateState, ...rest } = overrides;
  return {
    time: '14:30 KST',
    candidates,
    trackB: candidates,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    quoteFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries,
    waitDistribution: waitDistribution ?? { ...baseWait },
    macroGateState: macroGateState ?? { ...baseMacro },
    ...rest,
  };
}

describe('classifyEmptyScanReason — 우선순위 + 7값 분류', () => {
  it('null summary → null 반환', () => {
    expect(classifyEmptyScanReason(null)).toBeNull();
  });

  it('entries > 0 → null (분류 대상 아님)', () => {
    const summary = makeSummary({ candidates: 10, entries: 3 });
    expect(classifyEmptyScanReason(summary)).toBeNull();
  });

  it('1 후보 + 1 진입 → null', () => {
    const summary = makeSummary({ candidates: 1, entries: 1 });
    expect(classifyEmptyScanReason(summary)).toBeNull();
  });
});

describe('PIPELINE_ERROR — candidates 0 + macro 미수집', () => {
  it('candidates=0 + macroGateState 부재 → PIPELINE_ERROR', () => {
    const summary = makeSummary({
      candidates: 0,
      entries: 0,
      macroGateState: undefined,
    });
    expect(classifyEmptyScanReason(summary)).toBe('PIPELINE_ERROR');
  });

  it('candidates=0 + watchlistEmpty=true → ORDER_BLOCKED 우선', () => {
    const summary = makeSummary({
      candidates: 0,
      entries: 0,
      macroGateState: { ...baseMacro, watchlistEmpty: true },
    });
    expect(classifyEmptyScanReason(summary)).toBe('ORDER_BLOCKED');
  });

  it('candidates=0 + macro 정상 + watchlistEmpty=false → PIPELINE_ERROR', () => {
    const summary = makeSummary({ candidates: 0, entries: 0 });
    expect(classifyEmptyScanReason(summary)).toBe('PIPELINE_ERROR');
  });
});

describe('MARKET_WEAK — 거시 차단 5종', () => {
  it('R6_DEFENSE → MARKET_WEAK', () => {
    const summary = makeSummary({
      candidates: 5,
      entries: 0,
      macroGateState: { ...baseMacro, regime: 'R6_DEFENSE' },
    });
    expect(classifyEmptyScanReason(summary)).toBe('MARKET_WEAK');
  });

  it('bearDefenseMode → MARKET_WEAK', () => {
    const summary = makeSummary({
      candidates: 5,
      entries: 0,
      macroGateState: { ...baseMacro, bearDefenseMode: true },
    });
    expect(classifyEmptyScanReason(summary)).toBe('MARKET_WEAK');
  });

  it('mhsBelow30 → MARKET_WEAK', () => {
    const summary = makeSummary({
      candidates: 5,
      entries: 0,
      macroGateState: { ...baseMacro, mhsBelow30: true },
    });
    expect(classifyEmptyScanReason(summary)).toBe('MARKET_WEAK');
  });

  it('vixGatingActive → MARKET_WEAK', () => {
    const summary = makeSummary({
      candidates: 5,
      entries: 0,
      macroGateState: { ...baseMacro, vixGatingActive: true },
    });
    expect(classifyEmptyScanReason(summary)).toBe('MARKET_WEAK');
  });

  it('fomcPhase=DAY → MARKET_WEAK', () => {
    const summary = makeSummary({
      candidates: 5,
      entries: 0,
      macroGateState: { ...baseMacro, fomcPhase: 'DAY' },
    });
    expect(classifyEmptyScanReason(summary)).toBe('MARKET_WEAK');
  });
});

describe('ORDER_BLOCKED — 시스템 차단 5종', () => {
  it('emergencyStop → ORDER_BLOCKED', () => {
    const summary = makeSummary({
      candidates: 5,
      entries: 0,
      macroGateState: { ...baseMacro, emergencyStop: true },
    });
    expect(classifyEmptyScanReason(summary)).toBe('ORDER_BLOCKED');
  });

  it('autoTradeEnabled=false → ORDER_BLOCKED', () => {
    const summary = makeSummary({
      candidates: 5,
      entries: 0,
      macroGateState: { ...baseMacro, autoTradeEnabled: false },
    });
    expect(classifyEmptyScanReason(summary)).toBe('ORDER_BLOCKED');
  });

  // always-on rollback: legacy sellOnlyMode 는 더 이상 시스템 차단(ORDER_BLOCKED) 분류 사유가
  // 아니다 (production emptyScanClassifier.ts §4 sellOnly 분기 제거 + L187 advice "Legacy
  // SELL_ONLY is ignored by rollback"). sellOnly 단독(다른 분류 신호 없음)은 ORDER_BLOCKED 가
  // 아니라 fallback UNKNOWN 으로 분류된다. emptyScanLivenessPolicy 의 always-on 방향과 정합.
  it('sellOnlyMode 단독 → ORDER_BLOCKED 아님 (rollback, UNKNOWN fallback)', () => {
    const summary = makeSummary({
      candidates: 5,
      entries: 0,
      macroGateState: { ...baseMacro, sellOnlyMode: true },
    });
    expect(classifyEmptyScanReason(summary)).not.toBe('ORDER_BLOCKED');
    expect(classifyEmptyScanReason(summary)).toBe('UNKNOWN');
  });

  it('watchlistEmpty + candidates>0 → ORDER_BLOCKED', () => {
    const summary = makeSummary({
      candidates: 5,
      entries: 0,
      macroGateState: { ...baseMacro, watchlistEmpty: true },
    });
    expect(classifyEmptyScanReason(summary)).toBe('ORDER_BLOCKED');
  });

  it('sizingBlocked >= candidates → ORDER_BLOCKED', () => {
    const summary = makeSummary({
      candidates: 5,
      entries: 0,
      waitDistribution: { ...baseWait, sizingBlocked: 5 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('ORDER_BLOCKED');
  });
});

describe('DATA_INVALID — sanity 위반 30%+', () => {
  it('dataHold 30%+ (3/10) → DATA_INVALID', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      waitDistribution: { ...baseWait, dataHold: 3 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('DATA_INVALID');
  });

  it('corpAction 30%+ → DATA_INVALID', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      waitDistribution: { ...baseWait, corpAction: 3 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('DATA_INVALID');
  });

  it('dataHold + corpAction 합산 30%+ → DATA_INVALID', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      waitDistribution: { ...baseWait, dataHold: 2, corpAction: 1 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('DATA_INVALID');
  });

  it('dataHold 29% → DATA_INVALID 미진입 (boundary)', () => {
    const summary = makeSummary({
      candidates: 100,
      entries: 0,
      waitDistribution: { ...baseWait, dataHold: 29 },
    });
    expect(classifyEmptyScanReason(summary)).not.toBe('DATA_INVALID');
  });

  it('dataHold 정확 30% → DATA_INVALID', () => {
    const summary = makeSummary({
      candidates: 100,
      entries: 0,
      waitDistribution: { ...baseWait, dataHold: 30 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('DATA_INVALID');
  });
});

describe('TOO_STRICT — Gate 재검증 미달 50%+', () => {
  it('gateFail 50%+ → TOO_STRICT (사용자 R3 시나리오)', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      waitDistribution: { ...baseWait, gateFail: 6 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('TOO_STRICT');
  });

  it('gateFail 정확 50% → TOO_STRICT', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      waitDistribution: { ...baseWait, gateFail: 5 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('TOO_STRICT');
  });

  it('gateFail 49% → TOO_STRICT 미진입', () => {
    const summary = makeSummary({
      candidates: 100,
      entries: 0,
      waitDistribution: { ...baseWait, gateFail: 49 },
    });
    expect(classifyEmptyScanReason(summary)).not.toBe('TOO_STRICT');
  });

  it('gateFail 50% + dataHold 35% → DATA_INVALID 우선 (DATA_INVALID 가 더 우선순위 높음)', () => {
    const summary = makeSummary({
      candidates: 100,
      entries: 0,
      waitDistribution: { ...baseWait, gateFail: 50, dataHold: 35 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('DATA_INVALID');
  });
});

describe('NO_TIMING — Pre-breakout 미발동 50%+', () => {
  it('preBreakout 50%+ → NO_TIMING', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      waitDistribution: { ...baseWait, preBreakout: 6 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('NO_TIMING');
  });

  it('preBreakout 정확 50% → NO_TIMING', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      waitDistribution: { ...baseWait, preBreakout: 5 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('NO_TIMING');
  });

  it('preBreakout 50% + gateFail 50% → TOO_STRICT 우선', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      waitDistribution: { ...baseWait, preBreakout: 5, gateFail: 5 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('TOO_STRICT');
  });
});

describe('ADR-0120 PR-B: NO_LEADERSHIP / NO_TIMING — GatePassDistribution 활성', () => {
  it('gate1Pass>0 && gate2Pass=0 → NO_LEADERSHIP', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      gatePassDistribution: { gate1Pass: 5, gate2Pass: 0, gate3Pass: 0, lastTriggerPass: 0 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('NO_LEADERSHIP');
  });

  it('gate1Pass>0 && gate2Pass>0 && gate3Pass=0 → NO_TIMING', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      gatePassDistribution: { gate1Pass: 5, gate2Pass: 3, gate3Pass: 0, lastTriggerPass: 0 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('NO_TIMING');
  });

  it('gate3Pass>0 && lastTriggerPass=0 → NO_TIMING', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      gatePassDistribution: { gate1Pass: 5, gate2Pass: 3, gate3Pass: 1, lastTriggerPass: 0 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('NO_TIMING');
  });

  it('gate3Pass>0 && lastTriggerPass>0 (entries=0) → 다른 분기 (UNKNOWN 또는 시장 차단)', () => {
    // lastTrigger 발동했는데 entries=0 → 주문 단계 차단 가능성. 하지만 본 분류기는
    // ORDER_BLOCKED 분기는 이미 macro 단계에서 처리. lastTrigger 통과 후 매수 0건은
    // PR-B scope 외 (orderBlocked 별도 카운터 필요). 현재는 UNKNOWN.
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      gatePassDistribution: { gate1Pass: 5, gate2Pass: 3, gate3Pass: 1, lastTriggerPass: 1 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('UNKNOWN');
  });

  it('GatePassDistribution 부재 → 기존 6값 분류 (NO_LEADERSHIP 미진입)', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      gatePassDistribution: undefined,
      waitDistribution: { ...baseWait, gateFail: 6 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('TOO_STRICT');
  });

  it('R3 사용자 시나리오 — gate1Pass=5 + gate2Pass=0 → NO_LEADERSHIP (TOO_STRICT 보다 우선)', () => {
    // 사용자 진단 의도: Gate 1 통과는 있으나 Gate 2 미달 = 주도주 부재
    // gateFail 50%+ 시나리오와 동시 발생 시 NO_LEADERSHIP 우선 (정밀 분류 우선)
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      gatePassDistribution: { gate1Pass: 5, gate2Pass: 0, gate3Pass: 0, lastTriggerPass: 0 },
      waitDistribution: { ...baseWait, gateFail: 6 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('NO_LEADERSHIP');
  });
});

describe('UNKNOWN — 분류 임계 미충족 fallback', () => {
  it('모든 카운터 0 + macro 정상 + candidates>0 → UNKNOWN', () => {
    const summary = makeSummary({ candidates: 5, entries: 0 });
    expect(classifyEmptyScanReason(summary)).toBe('UNKNOWN');
  });

  it('각 카운터 임계 미충족 (29%/49%/49%) → UNKNOWN', () => {
    const summary = makeSummary({
      candidates: 100,
      entries: 0,
      waitDistribution: { ...baseWait, dataHold: 29, gateFail: 49, preBreakout: 49 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('UNKNOWN');
  });

  it('waitDistribution 미수집 + macro 정상 + candidates>0 → UNKNOWN', () => {
    const summary: ScanSummary = {
      time: '14:30 KST',
      candidates: 5,
      trackB: 5,
      swing: 0,
      catalyst: 0,
      momentum: 0,
      quoteFails: 0,
      gateMisses: 0,
      rrrMisses: 0,
      entries: 0,
      macroGateState: { ...baseMacro },
    };
    expect(classifyEmptyScanReason(summary)).toBe('UNKNOWN');
  });
});

describe('우선순위 충돌 검증', () => {
  it('R6_DEFENSE + emergencyStop 동시 → MARKET_WEAK 우선 (3 > 4)', () => {
    const summary = makeSummary({
      candidates: 5,
      entries: 0,
      macroGateState: { ...baseMacro, regime: 'R6_DEFENSE', emergencyStop: true },
    });
    expect(classifyEmptyScanReason(summary)).toBe('MARKET_WEAK');
  });

  it('candidates=0 + R6_DEFENSE → PIPELINE_ERROR 우선 (2 > 3)', () => {
    const summary = makeSummary({
      candidates: 0,
      entries: 0,
      macroGateState: { ...baseMacro, regime: 'R6_DEFENSE' },
    });
    expect(classifyEmptyScanReason(summary)).toBe('PIPELINE_ERROR');
  });

  it('emergencyStop + DATA_INVALID 다수 → ORDER_BLOCKED 우선 (4 > 5)', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      macroGateState: { ...baseMacro, emergencyStop: true },
      waitDistribution: { ...baseWait, dataHold: 5 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('ORDER_BLOCKED');
  });
});

describe('describeEmptyScanReason — 7값 라벨 + advice', () => {
  const reasons: EmptyScanReason[] = [
    'MARKET_WEAK',
    'NO_LEADERSHIP',
    'NO_TIMING',
    'TOO_STRICT',
    'DATA_INVALID',
    'PIPELINE_ERROR',
    'ORDER_BLOCKED',
    'UNKNOWN',
  ];

  it.each(reasons)('%s 는 label + advice 두 필드 모두 비어있지 않음', (reason) => {
    const result = describeEmptyScanReason(reason);
    expect(result.label).toBeTruthy();
    expect(result.advice).toBeTruthy();
    expect(result.label.length).toBeGreaterThan(2);
    expect(result.advice.length).toBeGreaterThan(10);
  });

  it('TOO_STRICT 는 EXECUTION_RELAXATION_ENABLED 안내 포함 (사용자 R3 시나리오 권장)', () => {
    const result = describeEmptyScanReason('TOO_STRICT');
    expect(result.advice).toContain('EXECUTION_RELAXATION_ENABLED');
  });

  it('DATA_INVALID 는 PR-B 후속 안내 포함', () => {
    const result = describeEmptyScanReason('DATA_INVALID');
    expect(result.advice.toLowerCase()).toContain('pr-b');
  });
});

describe('상수 SSOT 정합', () => {
  it('EMPTY_SCAN_CLASSIFIER_THRESHOLDS — 3 임계 모두 0~1 범위', () => {
    expect(EMPTY_SCAN_CLASSIFIER_THRESHOLDS.DATA_INVALID_RATIO).toBeGreaterThan(0);
    expect(EMPTY_SCAN_CLASSIFIER_THRESHOLDS.DATA_INVALID_RATIO).toBeLessThan(1);
    expect(EMPTY_SCAN_CLASSIFIER_THRESHOLDS.TOO_STRICT_RATIO).toBeGreaterThan(0);
    expect(EMPTY_SCAN_CLASSIFIER_THRESHOLDS.TOO_STRICT_RATIO).toBeLessThan(1);
    expect(EMPTY_SCAN_CLASSIFIER_THRESHOLDS.NO_TIMING_RATIO).toBeGreaterThan(0);
    expect(EMPTY_SCAN_CLASSIFIER_THRESHOLDS.NO_TIMING_RATIO).toBeLessThan(1);
  });

  it('DATA_INVALID 임계 < TOO_STRICT 임계 (sanity 우선 정합)', () => {
    expect(EMPTY_SCAN_CLASSIFIER_THRESHOLDS.DATA_INVALID_RATIO).toBeLessThan(
      EMPTY_SCAN_CLASSIFIER_THRESHOLDS.TOO_STRICT_RATIO,
    );
  });
});
