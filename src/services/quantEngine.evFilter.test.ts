import { describe, expect, it } from 'vitest';
import { evaluateStock } from './quant/gateEngine';
import type {
  ConditionId,
  MarketRegime,
  SectorRotation,
} from '../types/quant';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/** 27개 조건을 모두 높은 점수(8)로 채운 스톡 데이터 */
function createHighStockData(): Record<ConditionId, number> {
  const data = {} as Record<ConditionId, number>;
  for (let i = 1; i <= 27; i++) data[i as ConditionId] = 8;
  return data;
}

function createBaseRegime(partial: Partial<MarketRegime> = {}): MarketRegime {
  return {
    type: '상승초기',
    weightMultipliers: {} as Record<ConditionId, number>,
    vKospi: 16,
    samsungIri: 1.3,
    ...partial,
  };
}

function createLeadingSector(): SectorRotation {
  return {
    name: '반도체',
    rank: 10,
    strength: 80,
    isLeading: true,
    sectorLeaderNewHigh: false,
    leadingSectors: ['A'],
  };
}

// ─── RRR 기반 EV 필터 — 음수 기댓값 종목 차단 검증 ──────────────────────────

describe('evaluateStock — EV 필터 (RRR < 2.0 차단)', () => {
  it('RRR < 2.0: 고점수 종목이더라도 positionSize = 0', () => {
    const result = evaluateStock({
      rawStockData: createHighStockData(),
      regime: createBaseRegime(),
      profileType: 'A',
      sectorRotation: createLeadingSector(),
      euphoriaSignals: 0,
      emergencyStop: false,
      rrr: 1.5,
    });
    expect(result.positionSize).toBe(0);
  });

  it('RRR < 2.0: recommendation = "관망" (진입 금지)', () => {
    const result = evaluateStock({
      rawStockData: createHighStockData(),
      regime: createBaseRegime(),
      profileType: 'A',
      sectorRotation: createLeadingSector(),
      euphoriaSignals: 0,
      emergencyStop: false,
      rrr: 1.9,
    });
    expect(result.recommendation).toBe('관망');
  });

  it('RRR = 1.0 (손실 기댓값): 완전 차단', () => {
    const result = evaluateStock({
      rawStockData: createHighStockData(),
      regime: createBaseRegime(),
      profileType: 'A',
      sectorRotation: createLeadingSector(),
      euphoriaSignals: 0,
      emergencyStop: false,
      rrr: 1.0,
    });
    expect(result.positionSize).toBe(0);
    expect(result.recommendation).toBe('관망');
  });

  it('RRR = 0 (손절이 없는 경우): 차단', () => {
    const result = evaluateStock({
      rawStockData: createHighStockData(),
      regime: createBaseRegime(),
      profileType: 'A',
      sectorRotation: createLeadingSector(),
      euphoriaSignals: 0,
      emergencyStop: false,
      rrr: 0,
    });
    expect(result.positionSize).toBe(0);
    expect(result.recommendation).toBe('관망');
  });
});

// ─── RRR 기반 EV 필터 — 양수 기댓값 종목 허용 검증 ──────────────────────────

describe('evaluateStock — EV 필터 (RRR ≥ 2.0 허용)', () => {
  it('RRR = 2.0 경계값: positionSize > 0 (진입 허용)', () => {
    const result = evaluateStock({
      rawStockData: createHighStockData(),
      regime: createBaseRegime(),
      profileType: 'A',
      sectorRotation: createLeadingSector(),
      euphoriaSignals: 0,
      emergencyStop: false,
      rrr: 2.0,
    });
    expect(result.positionSize).toBeGreaterThan(0);
  });

  it('RRR = 3.0 (충분한 보상): positionSize > 0', () => {
    const result = evaluateStock({
      rawStockData: createHighStockData(),
      regime: createBaseRegime(),
      profileType: 'A',
      sectorRotation: createLeadingSector(),
      euphoriaSignals: 0,
      emergencyStop: false,
      rrr: 3.0,
    });
    expect(result.positionSize).toBeGreaterThan(0);
  });

  it('RRR = 5.0: 차단되지 않음 (고보상 기회)', () => {
    const result = evaluateStock({
      rawStockData: createHighStockData(),
      regime: createBaseRegime(),
      profileType: 'A',
      sectorRotation: createLeadingSector(),
      euphoriaSignals: 0,
      emergencyStop: false,
      rrr: 5.0,
    });
    expect(result.positionSize).toBeGreaterThan(0);
  });
});

// ─── EV 필터가 Gate 통과 여부에 독립적임을 확인 ──────────────────────────────

describe('evaluateStock — EV 필터는 Gate 통과와 독립', () => {
  it('Gate 1/2/3 모두 통과 + RRR < 2.0 → positionSize = 0 (EV 필터가 최종 차단)', () => {
    const result = evaluateStock({
      rawStockData: createHighStockData(),
      regime: createBaseRegime(),
      profileType: 'A',
      sectorRotation: createLeadingSector(),
      euphoriaSignals: 0,
      emergencyStop: false,
      rrr: 1.8,
    });
    // Gate는 통과했지만 EV 필터에 의해 차단
    expect(result.gate1Passed).toBe(true);
    expect(result.gate2Passed).toBe(true);
    expect(result.gate3Passed).toBe(true);
    expect(result.positionSize).toBe(0);
  });

  it('Gate 1 실패 + RRR = 3.0 → positionSize = 0 (Gate 실패가 우선)', () => {
    // 낮은 점수로 Gate 1 통과 불가
    const zeroData = {} as Record<ConditionId, number>;
    for (let i = 1; i <= 27; i++) zeroData[i as ConditionId] = 0;

    const result = evaluateStock({
      rawStockData: zeroData,
      regime: createBaseRegime(),
      profileType: 'A',
      sectorRotation: createLeadingSector(),
      euphoriaSignals: 0,
      emergencyStop: false,
      rrr: 3.0,
    });
    expect(result.gate1Passed).toBe(false);
    expect(result.positionSize).toBe(0);
  });
});

// ─── RRR 반환값 검증 ─────────────────────────────────────────────────────────

describe('evaluateStock — RRR 반환값', () => {
  it('입력된 RRR이 반환값에 포함됨', () => {
    const result = evaluateStock({
      rawStockData: createHighStockData(),
      regime: createBaseRegime(),
      profileType: 'A',
      sectorRotation: createLeadingSector(),
      euphoriaSignals: 0,
      emergencyStop: false,
      rrr: 2.5,
    });
    expect(result.rrr).toBe(2.5);
  });

  it('RRR < 2.0 시 rrr 반환값도 해당 값을 유지', () => {
    const result = evaluateStock({
      rawStockData: createHighStockData(),
      regime: createBaseRegime(),
      profileType: 'A',
      sectorRotation: createLeadingSector(),
      euphoriaSignals: 0,
      emergencyStop: false,
      rrr: 1.2,
    });
    expect(result.rrr).toBe(1.2);
  });
});
