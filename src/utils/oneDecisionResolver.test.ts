/**
 * @responsibility resolveOneDecision + evaluateVoidConditions + computeVolatilityZScore 회귀 (ADR-0046 PR-Z4)
 */
import { describe, it, expect } from 'vitest';
import {
  resolveOneDecision,
  evaluateVoidConditions,
  computeVolatilityZScore,
  type DecisionCaseId,
  type DecisionTier,
  type OneDecisionInputs,
} from './oneDecisionResolver';
import type { SurvivalSnapshot } from '../api/survivalClient';
import type { DecisionInputs } from '../api/decisionClient';
import type { PositionItem } from '../services/autoTrading/autoTradingTypes';

// ─── Fixtures ───────────────────────────────────────────────────────────

function makeSurvival(overrides: Partial<SurvivalSnapshot> = {}): SurvivalSnapshot {
  return {
    dailyLoss: { currentPct: 1.0, limitPct: 5.0, bufferPct: 80, tier: 'OK' },
    sectorConcentration: { hhi: 2000, topSector: '반도체', topWeight: 0.3, activePositions: 4, tier: 'OK' },
    kellyConcordance: { ratio: 0.9, currentAvgKelly: 0.45, recommendedKelly: 0.5, sampleSize: 30, tier: 'OK' },
    overallTier: 'OK',
    capturedAt: '2026-04-26T13:00:00.000Z',
    ...overrides,
  };
}

function makeInputs(overrides: Partial<DecisionInputs> = {}): DecisionInputs {
  return {
    emergencyStop: false,
    pendingApprovals: [],
    macroSignals: {},
    capturedAt: '2026-04-26T13:00:00.000Z',
    ...overrides,
  };
}

function makePosition(overrides: Partial<PositionItem> = {}): PositionItem {
  return {
    id: 'P1',
    symbol: '005930',
    name: '삼성전자',
    enteredAt: '2026-04-26T00:00:00Z',
    entryReason: 'test',
    avgPrice: 70_000,
    currentPrice: 70_000,
    quantity: 10,
    pnlPct: 0,
    stopLossPrice: 66_500,
    targetPrice1: 77_000,
    targetPrice2: 84_000,
    trailingStopEnabled: false,
    status: 'HOLD',
    stage: 'HOLD',
    ...overrides,
  };
}

const baseInput: OneDecisionInputs = {
  survival: makeSurvival(),
  positions: [],
  inputs: makeInputs(),
};

// ─── Case 0~6 우선순위 ──────────────────────────────────────────────────

describe('resolveOneDecision — 6 case 우선순위 SSOT (ADR-0046 §2.1)', () => {
  it('case 0 — emergencyStop=true → EMERGENCY_STOP (최우선)', () => {
    const r = resolveOneDecision({
      ...baseInput,
      inputs: makeInputs({ emergencyStop: true }),
    });
    expect(r.caseId).toBe<DecisionCaseId>('EMERGENCY_STOP');
    expect(r.tier).toBe<DecisionTier>('EMERGENCY');
  });

  it('case 1 — dailyLoss=EMERGENCY → DAILY_LOSS_EMERGENCY', () => {
    const r = resolveOneDecision({
      ...baseInput,
      survival: makeSurvival({
        dailyLoss: { currentPct: 5.5, limitPct: 5, bufferPct: -10, tier: 'EMERGENCY' },
      }),
    });
    expect(r.caseId).toBe('DAILY_LOSS_EMERGENCY');
    expect(r.tier).toBe('EMERGENCY');
  });

  it('case 2 — InvalidationMeter CRITICAL 포지션 ≥ 1 → INVALIDATED_POSITIONS', () => {
    // CRITICAL 만들기: 손절가 임박 + 손실 -3% 이하 + stage ALERT (3 조건 met)
    const critical = makePosition({
      currentPrice: 67_000, pnlPct: -4.3, stage: 'ALERT', stopLossPrice: 66_500,
    });
    const r = resolveOneDecision({ ...baseInput, positions: [critical] });
    expect(r.caseId).toBe('INVALIDATED_POSITIONS');
    expect(r.tier).toBe('CRITICAL');
    expect(r.headline).toContain('삼성전자');
  });

  it('case 2 — 다중 critical 시 N개 표시', () => {
    const c1 = makePosition({ id: 'P1', name: 'A', currentPrice: 67_000, pnlPct: -4.3, stage: 'ALERT' });
    const c2 = makePosition({ id: 'P2', name: 'B', currentPrice: 67_000, pnlPct: -4.3, stage: 'ALERT' });
    const r = resolveOneDecision({ ...baseInput, positions: [c1, c2] });
    expect(r.headline).toContain('2개');
    expect(r.detail).toContain('A');
  });

  it('case 3 — survival.sector=CRITICAL → ACCOUNT_CRITICAL', () => {
    const r = resolveOneDecision({
      ...baseInput,
      survival: makeSurvival({
        sectorConcentration: { hhi: 5500, topSector: '반도체', topWeight: 0.7, activePositions: 3, tier: 'CRITICAL' },
      }),
    });
    expect(r.caseId).toBe('ACCOUNT_CRITICAL');
    expect(r.detail).toContain('섹터 집중');
  });

  it('case 4 — pendingApprovals.length > 0 → PENDING_APPROVALS', () => {
    const r = resolveOneDecision({
      ...baseInput,
      inputs: makeInputs({
        pendingApprovals: [{ stockCode: '005930', stockName: '삼성전자', ageMs: 60_000 }],
      }),
    });
    expect(r.caseId).toBe('PENDING_APPROVALS');
    expect(r.tier).toBe('WARN');
    expect(r.headline).toContain('삼성전자');
  });

  it('case 5 (VOID) — 4 조건 모두 충족 → VOID', () => {
    const r = resolveOneDecision({
      survival: makeSurvival({
        sectorConcentration: { hhi: 0, topSector: null, topWeight: 0, activePositions: 0, tier: 'NA' },
      }),
      positions: [],
      inputs: makeInputs({
        macroSignals: {
          vixHistory: [15, 16, 17, 18, 28],   // 마지막 28 → z>1.5
          vix: 28,
          bearDefenseMode: true,
        },
      }),
    });
    expect(r.caseId).toBe('VOID');
    expect(r.tier).toBe('VOID');
  });

  it('case 6 — 모든 조건 미해당 → MONITORING', () => {
    const r = resolveOneDecision(baseInput);
    expect(r.caseId).toBe('MONITORING');
    expect(r.tier).toBe('OK');
  });

  // ─── 우선순위 충돌 ────────────────────────────────────────────────────

  it('우선순위 — emergencyStop + dailyLoss=EMERGENCY 동시 → EMERGENCY_STOP 먼저', () => {
    const r = resolveOneDecision({
      ...baseInput,
      survival: makeSurvival({
        dailyLoss: { currentPct: 5.5, limitPct: 5, bufferPct: -10, tier: 'EMERGENCY' },
      }),
      inputs: makeInputs({ emergencyStop: true }),
    });
    expect(r.caseId).toBe('EMERGENCY_STOP');
  });

  it('우선순위 — INVALIDATED_POSITIONS + ACCOUNT_CRITICAL 동시 → INVALIDATED_POSITIONS 먼저', () => {
    const critical = makePosition({ currentPrice: 67_000, pnlPct: -4.3, stage: 'ALERT' });
    const r = resolveOneDecision({
      ...baseInput,
      positions: [critical],
      survival: makeSurvival({
        sectorConcentration: { hhi: 5500, topSector: '반도체', topWeight: 0.7, activePositions: 3, tier: 'CRITICAL' },
      }),
    });
    expect(r.caseId).toBe('INVALIDATED_POSITIONS');
  });

  it('우선순위 — VOID 4 조건 충족 + ACCOUNT_CRITICAL → ACCOUNT_CRITICAL 먼저 (VOID 는 case 5)', () => {
    const r = resolveOneDecision({
      survival: makeSurvival({
        sectorConcentration: { hhi: 5500, topSector: '반도체', topWeight: 0.7, activePositions: 0, tier: 'CRITICAL' },
      }),
      positions: [],
      inputs: makeInputs({
        macroSignals: { vixHistory: [15, 16, 17, 18, 28], vix: 28, bearDefenseMode: true },
      }),
    });
    expect(r.caseId).toBe('ACCOUNT_CRITICAL');
  });

  it('빈 입력 fallback — survival=null + inputs=null → MONITORING', () => {
    const r = resolveOneDecision({ survival: null, positions: [], inputs: null });
    expect(r.caseId).toBe('MONITORING');
    expect(r.tier).toBe('OK');
  });

  it('survival=null + emergencyStop=true → EMERGENCY_STOP (survival 부재 무관)', () => {
    const r = resolveOneDecision({
      survival: null,
      positions: [],
      inputs: makeInputs({ emergencyStop: true }),
    });
    expect(r.caseId).toBe('EMERGENCY_STOP');
  });
});

// ─── VOID 4 조건 ─────────────────────────────────────────────────────────

describe('evaluateVoidConditions — ADR-0046 §2.2', () => {
  it('4 조건 모두 충족 → met=true', () => {
    const r = evaluateVoidConditions(
      makeSurvival({
        sectorConcentration: { hhi: 0, topSector: null, topWeight: 0, activePositions: 0, tier: 'NA' },
      }),
      makeInputs({
        macroSignals: { vixHistory: [15, 16, 17, 18, 28], vix: 28, bearDefenseMode: true },
      }),
    );
    expect(r.met).toBe(true);
    expect(r.checks.every((c) => c.met)).toBe(true);
  });

  it('1 조건 미충족 (활성 포지션 > 0) → met=false', () => {
    const r = evaluateVoidConditions(
      makeSurvival({
        sectorConcentration: { hhi: 2000, topSector: '반도체', topWeight: 0.3, activePositions: 3, tier: 'OK' },
      }),
      makeInputs({
        macroSignals: { vixHistory: [15, 16, 17, 18, 28], vix: 28, bearDefenseMode: true },
      }),
    );
    expect(r.met).toBe(false);
    expect(r.checks.find((c) => c.key === 'ZERO_POSITIONS')?.met).toBe(false);
  });

  it('vixHistory 부재 + vkospiDayChange 큰 값 → 변동성 fallback 으로 met=true 가능', () => {
    const r = evaluateVoidConditions(
      makeSurvival({
        sectorConcentration: { hhi: 0, topSector: null, topWeight: 0, activePositions: 0, tier: 'NA' },
      }),
      makeInputs({
        macroSignals: { vkospiDayChange: 8, fssAlertLevel: 'HIGH_ALERT' },
      }),
    );
    expect(r.checks.find((c) => c.key === 'HIGH_VOLATILITY')?.met).toBe(true);
    expect(r.met).toBe(true);
  });

  it('거시 신호 OR 분기 — regime=RED 만 활성화돼도 MACRO_RISK 충족', () => {
    const r = evaluateVoidConditions(
      makeSurvival(),
      makeInputs({ macroSignals: { regime: 'RED' } }),
    );
    expect(r.checks.find((c) => c.key === 'MACRO_RISK')?.met).toBe(true);
  });

  it('변동성 데이터 모두 부재 → HIGH_VOLATILITY false (보수적 기본값)', () => {
    const r = evaluateVoidConditions(
      makeSurvival(),
      makeInputs({ macroSignals: {} }),
    );
    expect(r.checks.find((c) => c.key === 'HIGH_VOLATILITY')?.met).toBe(false);
    expect(r.met).toBe(false);
  });

  it('survival=null + inputs=null → 활성 포지션·승인 0 충족 (안전 기본값)', () => {
    const r = evaluateVoidConditions(null, null);
    expect(r.checks.find((c) => c.key === 'ZERO_POSITIONS')?.met).toBe(true);
    expect(r.checks.find((c) => c.key === 'ZERO_APPROVALS')?.met).toBe(true);
    // 변동성·거시 데이터 부재 → 미충족
    expect(r.met).toBe(false);
  });
});

// ─── 변동성 z-score ─────────────────────────────────────────────────────

describe('computeVolatilityZScore', () => {
  it('vixHistory 정상 + 마지막 값 spike → z ≥ 1.5', () => {
    const { z, method } = computeVolatilityZScore({ vixHistory: [15, 16, 17, 18, 28], vix: 28 });
    expect(method).toBe('vix');
    expect(z).toBeGreaterThanOrEqual(1.5);
  });

  it('vixHistory < 3개 → fallback', () => {
    const { method } = computeVolatilityZScore({ vixHistory: [15, 16] });
    expect(method).not.toBe('vix');
  });

  it('vkospiDayChange 5 → z ≈ 1.5 (heuristic)', () => {
    const { z, method } = computeVolatilityZScore({ vkospiDayChange: 5 });
    expect(method).toBe('vkospi-change');
    expect(z).toBeCloseTo(1.5, 1);
  });

  it('vkospiDayChange 음수도 절댓값 적용', () => {
    const { z } = computeVolatilityZScore({ vkospiDayChange: -8 });
    expect(z).toBeGreaterThan(1.5);
  });

  it('데이터 모두 부재 → z=0, method=none', () => {
    const r = computeVolatilityZScore({});
    expect(r.z).toBe(0);
    expect(r.method).toBe('none');
  });

  it('vixHistory 모두 동일 값 (stdev=0) → fallback (z 계산 불가)', () => {
    const r = computeVolatilityZScore({ vixHistory: [20, 20, 20], vix: 20 });
    // stdev=0 이라 vix 분기 미진입 → vkospiDayChange 도 없음 → none
    expect(r.method).toBe('none');
  });
});
