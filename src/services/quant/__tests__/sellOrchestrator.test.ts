/**
 * sellOrchestrator.test.ts — Phase 2 Strategy Pattern 검증
 *
 * 1) SELL_LAYER_REGISTRY가 priority 순으로 실행되는지
 * 2) shortCircuit이 정확히 HARD_STOP에서만 작동하는지
 * 3) ROE 판단이 roeEngine.detectROETransition 단일 출처를 거치는지
 *    ([3,3,3,4] 패턴 없이 단순 [3,4]만으로는 발동하지 않아야 함)
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateSellSignals,
  evaluateSellSignalsFromContext,
  SELL_LAYER_REGISTRY,
  SELL_LAYERS,
} from '../sell';
import { evaluatePreMortems } from '../sell/preMortem';
import type {
  ActivePosition,
  PreMortemData,
  SellContext,
  EuphoriaData,
} from '../../../types/sell';

function basePosition(overrides: Partial<ActivePosition> = {}): ActivePosition {
  return {
    id: 'pos_orch_test',
    stockCode: '005930',
    name: 'Samsung',
    profile: 'A',
    entryPrice: 100_000,
    entryDate: '2026-01-01T00:00:00.000Z',
    currentPrice: 100_000,
    quantity: 10,
    entryROEType: 3,
    entryRegime: 'R2_BULL',
    highSinceEntry: 100_000,
    trailingEnabled: false,
    trailingHighWaterMark: 100_000,
    trailPct: 0.10,
    trailingRemainingRatio: 0.40,
    revalidated: false,
    takenProfit: [],
    ...overrides,
  };
}

function basePreMortem(overrides: Partial<PreMortemData> = {}): PreMortemData {
  return {
    currentROEType: 3,
    foreignNetBuy5d: 100,
    ma20: 100_000,
    ma60: 99_000,
    currentRegime: 'R2_BULL',
    ...overrides,
  };
}

function baseEuphoria(overrides: Partial<EuphoriaData> = {}): EuphoriaData {
  return {
    rsi14: 50,
    volumeRatio: 1.0,
    retailRatio: 0.30,
    analystUpgradeCount30d: 0,
    ...overrides,
  };
}

describe('SELL_LAYER_REGISTRY', () => {
  it('priority 오름차순 정렬 상태여야 한다', () => {
    const priorities = SELL_LAYER_REGISTRY.map(l => l.priority);
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(sorted);
  });

  it('각 레이어가 고유한 id를 가진다', () => {
    const ids = SELL_LAYER_REGISTRY.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('L1 HARD_STOP 레이어는 HARD_STOP 신호에 대해서만 shortCircuit=true', () => {
    const hardStop = SELL_LAYERS.L1_HARD_STOP;
    expect(hardStop.shortCircuit([
      { action: 'HARD_STOP', ratio: 1.0, orderType: 'MARKET', reason: 'test' },
    ])).toBe(true);
    expect(hardStop.shortCircuit([
      { action: 'REVALIDATE_GATE1', ratio: 0, orderType: 'MARKET', reason: 'test' },
    ])).toBe(false);
  });
});

describe('evaluateSellSignalsFromContext — Strategy Pattern 실행', () => {
  it('HARD_STOP 발동 시 L2/L3/L4를 평가하지 않는다', () => {
    const ctx: SellContext = {
      position: basePosition({ currentPrice: 85_000 }), // R2_BULL profile A → -12%에서 손절
      regime: 'R2_BULL',
      preMortem: basePreMortem({ foreignNetBuy5d: -500 }), // 발동 조건 존재
      euphoria: baseEuphoria({ rsi14: 85, volumeRatio: 4.0, retailRatio: 0.7, analystUpgradeCount30d: 6 }),
    };
    const signals = evaluateSellSignalsFromContext(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].action).toBe('HARD_STOP');
  });

  it('REVALIDATE_GATE1 경보는 shortCircuit하지 않고 이후 레이어도 실행', () => {
    const ctx: SellContext = {
      position: basePosition({
        currentPrice: 93_000, // -7% — revalidate 경보
        revalidated: false,
        prevMa20: 101_000,
        prevMa60: 100_000,
      }),
      regime: 'R2_BULL',
      // 데드크로스 발동 조건을 동시에 심어둠 → 두 신호 모두 수집되어야 함
      preMortem: basePreMortem({ ma20: 99_000, ma60: 100_000 }),
      euphoria: null,
    };
    const signals = evaluateSellSignalsFromContext(ctx);
    const actions = signals.map(s => s.action);
    expect(actions).toContain('REVALIDATE_GATE1');
    expect(actions).toContain('PRE_MORTEM');
  });

  it('Phase 1 시그니처(evaluateSellSignals)가 Context 기반 구현으로 위임되어도 동일 동작', () => {
    const optResult = evaluateSellSignals({
      position: basePosition({ currentPrice: 112_000 }),
      regime: 'R2_BULL',
      preMortemData: basePreMortem(),
      euphoriaData: null,
    });
    // +12% → R2_BULL 첫 익절 타겟만 발동
    expect(optResult).toHaveLength(1);
    expect(optResult[0].action).toBe('PROFIT_TAKE');
    expect(optResult[0].ratio).toBeCloseTo(0.30, 5);
  });
});

describe('ROE 단일 출처화 (detectROETransition)', () => {
  it('roeTypeHistory=[3,3,3,4] → ROE_DRIFT 발동 (sellRatio=0.50)', () => {
    const triggers = evaluatePreMortems(
      basePosition({ entryROEType: 3 }),
      basePreMortem(),
      { roeTypeHistory: [3, 3, 3, 4] },
    );
    const roe = triggers.find(t => t.type === 'ROE_DRIFT');
    expect(roe).toBeDefined();
    expect(roe?.sellRatio).toBe(0.50);
  });

  it('roeTypeHistory=[3,4]만으로는 발동하지 않는다 (정식 패턴 미충족)', () => {
    // 기존 `entry=3, current=4` 즉시 발동 로직이 제거되어야 함.
    // 단일 출처 규칙은 [3,3,3,4] 또는 총자산회전율 하락 필요.
    const triggers = evaluatePreMortems(
      basePosition({ entryROEType: 3 }),
      basePreMortem({ currentROEType: 4 }),
      { roeTypeHistory: [3, 4] },
    );
    expect(triggers.find(t => t.type === 'ROE_DRIFT')).toBeUndefined();
  });

  it('[3,3,3,4] 패턴 + 총자산회전율 QoQ 10% 하락 → BOTH CRITICAL (sellRatio 0.70)', () => {
    const triggers = evaluatePreMortems(
      basePosition({ entryROEType: 3 }),
      basePreMortem(),
      {
        roeTypeHistory: [3, 3, 3, 4], // 규칙 A
        assetTurnoverHistory: [1.0, 0.90], // 규칙 B — QoQ 10% 하락
      },
    );
    const roe = triggers.find(t => t.type === 'ROE_DRIFT');
    expect(roe).toBeDefined();
    // BOTH = A + B 동시 발동 → severity CRITICAL + sellRatio 0.70
    expect(roe?.sellRatio).toBeCloseTo(0.70, 5);
    expect(roe?.severity).toBe('CRITICAL');
  });

  it('[3,3,4] + 총자산회전율 QoQ 10% 하락 → 규칙 B만 PENALTY (sellRatio 0.50)', () => {
    // 규칙 A는 4원소 필요, 3원소면 B만 성립 → BOTH 아님
    const triggers = evaluatePreMortems(
      basePosition({ entryROEType: 3 }),
      basePreMortem(),
      {
        roeTypeHistory: [3, 3, 4],
        assetTurnoverHistory: [1.0, 0.90],
      },
    );
    const roe = triggers.find(t => t.type === 'ROE_DRIFT');
    expect(roe).toBeDefined();
    expect(roe?.sellRatio).toBeCloseTo(0.50, 5);
    expect(roe?.severity).toBe('HIGH');
  });

  it('roeTypeHistory 미주입 + [entry=3, current=4] fallback은 2원소 히스토리라 발동하지 않는다', () => {
    // Phase 2 의도: 하위 호환 fallback은 히스토리를 합성하되, detectROETransition 규칙을 통과해야만 발동.
    // 즉 [3, 4]만으로는 [3,3,3,4] 패턴이 아니므로 penaltyApplied=false.
    const triggers = evaluatePreMortems(
      basePosition({ entryROEType: 3 }),
      basePreMortem({ currentROEType: 4 }),
    );
    expect(triggers.find(t => t.type === 'ROE_DRIFT')).toBeUndefined();
  });
});
