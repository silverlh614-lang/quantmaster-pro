/**
 * @responsibility supply_health 데이터 신뢰도 기반 학습 레이어 회귀 테스트
 */

import { describe, expect, it } from 'vitest';
import {
  aggregatePerformanceByCriticalFlag,
  aggregatePerformanceByDataQuality,
  analyzeDowngradeEffectiveness,
  applySupplyHealthToSignal,
  calculateDataConfidence,
  createLearningSampleFromDecision,
  createReplayFrame,
  determineExecutionMode,
  toDataQualityBucket,
  updateLearningSampleFutureReturns,
  type LearningSample,
  type SupplyHealthSnapshot,
} from './supplyHealthLearning.js';

type SnapshotOverrides = Omit<Partial<SupplyHealthSnapshot>, 'summary' | 'coverage' | 'sources' | 'criticalFlags'> & {
  summary?: Partial<SupplyHealthSnapshot['summary']>;
  coverage?: Partial<SupplyHealthSnapshot['coverage']>;
  sources?: Partial<SupplyHealthSnapshot['sources']>;
  criticalFlags?: Partial<SupplyHealthSnapshot['criticalFlags']>;
};

function snapshot(overrides: SnapshotOverrides = {}): SupplyHealthSnapshot {
  const base: SupplyHealthSnapshot = {
    summary: {
      ok: 7,
      neutral: 0,
      degraded: 0,
      missing: 0,
      stale: 0,
      cacheStatus: 'fresh',
      overallStatus: 'OK',
    },
    coverage: {
      totalSources: 7,
      okRatio: 1,
      degradedRatio: 0,
      missingRatio: 0,
      minCriticalCoverage: 1,
    },
    sources: {},
    providerTried: ['KIS_API', 'KRX'],
    providerFailed: [],
    providerUsed: ['KIS_API'],
    criticalFlags: {
      investorFlowDegraded: false,
      programTradingMissing: false,
      foreignerTrendDegraded: false,
      zeroFilledSuspected: false,
      offHoursMode: false,
    },
  };
  return {
    ...base,
    ...overrides,
    summary: { ...base.summary, ...overrides.summary },
    coverage: { ...base.coverage, ...overrides.coverage },
    sources: { ...base.sources, ...overrides.sources },
    criticalFlags: { ...base.criticalFlags, ...overrides.criticalFlags },
  };
}

function sample(overrides: Partial<LearningSample> = {}): LearningSample {
  const s = createLearningSampleFromDecision({
    symbol: '005930',
    name: 'SAMSUNG',
    market: 'KOSPI',
    date: '2026-05-04',
    currentPrice: 10_000,
    rawSignal: 'BUY',
    rawScore: 8,
    positionSize: 1,
    supplyHealthSnapshot: snapshot(),
  });
  return { ...s, ...overrides };
}

describe('calculateDataConfidence', () => {
  it('7/7 OK + cache fresh -> HIGH_CONFIDENCE', () => {
    const confidence = calculateDataConfidence(snapshot());
    expect(confidence).toBe(1);
    expect(toDataQualityBucket(confidence)).toBe('HIGH_CONFIDENCE');
  });

  it('3/7 OK + degraded 다수 -> MID 이하', () => {
    const confidence = calculateDataConfidence(snapshot({
      summary: { ok: 3, degraded: 3, missing: 1, overallStatus: 'DEGRADED', cacheStatus: 'unknown' },
      coverage: { okRatio: 3 / 7, degradedRatio: 3 / 7, missingRatio: 1 / 7, minCriticalCoverage: 0.5 },
    }));
    expect(confidence).toBeLessThanOrEqual(0.6);
    expect(['MID_CONFIDENCE', 'LOW_CONFIDENCE', 'UNSAFE_CONFIDENCE']).toContain(toDataQualityBucket(confidence));
  });

  it('zeroFilledSuspected true -> confidence 크게 감소', () => {
    const clean = calculateDataConfidence(snapshot());
    const dirty = calculateDataConfidence(snapshot({
      summary: { cacheStatus: 'unknown' },
      criticalFlags: { zeroFilledSuspected: true },
    }));
    expect(clean - dirty).toBeGreaterThanOrEqual(0.25);
  });

  it('BROKEN -> 0, UNSAFE cap <= 0.35, DEGRADED cap <= 0.60', () => {
    expect(calculateDataConfidence(snapshot({ summary: { overallStatus: 'BROKEN' } }))).toBe(0);
    expect(calculateDataConfidence(snapshot({ summary: { overallStatus: 'UNSAFE' } }))).toBeLessThanOrEqual(0.35);
    expect(calculateDataConfidence(snapshot({ summary: { overallStatus: 'DEGRADED' } }))).toBeLessThanOrEqual(0.6);
  });
});

describe('applySupplyHealthToSignal', () => {
  it('OK + STRONG_BUY -> STRONG_BUY 유지', () => {
    const result = applySupplyHealthToSignal({
      rawSignal: 'STRONG_BUY',
      positionSize: 1,
      supplyHealthSnapshot: snapshot(),
    });
    expect(result.finalSignal).toBe('STRONG_BUY');
    expect(result.wasDowngradedBySupplyHealth).toBe(false);
  });

  it('DEGRADED + STRONG_BUY -> BUY 강등', () => {
    const result = applySupplyHealthToSignal({
      rawSignal: 'STRONG_BUY',
      positionSize: 1,
      supplyHealthSnapshot: snapshot({ summary: { overallStatus: 'DEGRADED' } }),
    });
    expect(result.finalSignal).toBe('STRONG_BUY');
    expect(result.wasDowngradedBySupplyHealth).toBe(true);
    expect(result.downgradeReasons).not.toContain('supply_health DEGRADED');
  });

  it('UNSAFE + BUY -> WATCH 강등', () => {
    const result = applySupplyHealthToSignal({
      rawSignal: 'BUY',
      positionSize: 1,
      supplyHealthSnapshot: snapshot({ summary: { overallStatus: 'UNSAFE' } }),
    });
    expect(result.finalSignal).toBe('WATCH');
    expect(result.positionSizeAfterHealth).toBe(0);
  });

  it('BROKEN + STRONG_BUY -> NO_DECISION', () => {
    const result = applySupplyHealthToSignal({
      rawSignal: 'STRONG_BUY',
      positionSize: 1,
      supplyHealthSnapshot: snapshot({ summary: { overallStatus: 'BROKEN' } }),
    });
    expect(result.finalSignal).toBe('NO_DECISION');
    expect(result.positionSizeAfterHealth).toBe(0);
  });

  it('SELL은 supply_health 때문에 HOLD로 바꾸지 않는다', () => {
    const result = applySupplyHealthToSignal({
      rawSignal: 'SELL',
      positionSize: 1,
      supplyHealthSnapshot: snapshot({ summary: { overallStatus: 'UNSAFE' } }),
    });
    expect(result.finalSignal).toBe('SELL');
    expect(result.positionSizeAfterHealth).toBe(1);
  });
});

describe('LearningSample / Replay 생성', () => {
  it('rawSignal/finalSignal, snapshot, bucket, executionMode를 저장한다', () => {
    const health = snapshot({
      summary: { overallStatus: 'DEGRADED' },
      criticalFlags: { investorFlowDegraded: true, foreignerTrendDegraded: true },
    });
    const created = createLearningSampleFromDecision({
      symbol: '000660',
      date: '2026-05-04',
      currentPrice: 100_000,
      rawSignal: 'STRONG_BUY',
      rawScore: 9,
      positionSize: 1,
      supplyHealthSnapshot: health,
    });
    expect(created.rawSignal).toBe('STRONG_BUY');
    expect(created.finalSignal).toBe('STRONG_BUY');
    expect(created.wasDowngradedBySupplyHealth).toBe(true);
    expect(created.supplyHealthSnapshot).toBe(health);
    expect(created.dataQualityBucket).toBe('MID_CONFIDENCE');
    expect(created.executionMode).toBe('SHADOW');
  });

  it('ReplayFrame에 provider diagnostics와 offHoursMode를 포함한다', () => {
    const health = snapshot({
      providerFailed: ['KRX'],
      criticalFlags: { offHoursMode: true },
    });
    const frame = createReplayFrame({
      replayId: 'r1',
      symbol: '005930',
      supplyHealthSnapshot: health,
      rawSignal: 'STRONG_BUY',
      finalSignal: 'BUY',
      downgradeReasons: ['program trading missing'],
      providerSkipped: ['NAVER'],
      cacheKey: 'supply:005930',
      cacheAgeMinutes: 30,
    });
    expect(frame.providerDiagnostics.providerTried).toEqual(['KIS_API', 'KRX']);
    expect(frame.providerDiagnostics.providerFailed).toEqual(['KRX']);
    expect(frame.providerDiagnostics.providerSkipped).toEqual(['NAVER']);
    expect(frame.providerDiagnostics.offHoursMode).toBe(true);
  });
});

describe('성과 업데이트/집계', () => {
  it('future return과 outcome을 계산한다', () => {
    const updated = updateLearningSampleFutureReturns({
      sample: sample(),
      price5d: 10_400,
      price20d: 9_600,
    });
    expect(updated.futureReturn5d).toBe(4);
    expect(updated.outcome5d).toBe('WIN');
    expect(updated.futureReturn20d).toBe(-4);
    expect(updated.outcome20d).toBe('LOSS');
  });

  it('dataConfidence bucket별 BUY 성과를 집계하고 PENDING/BROKEN을 제외한다', () => {
    const rows = [
      sample({ dataQualityBucket: 'HIGH_CONFIDENCE', futureReturn20d: 6, outcome20d: 'WIN' }),
      sample({ dataQualityBucket: 'HIGH_CONFIDENCE', futureReturn20d: -4, outcome20d: 'LOSS' }),
      sample({ dataQualityBucket: 'LOW_CONFIDENCE', futureReturn20d: -5, outcome20d: 'LOSS' }),
      sample({ dataQualityBucket: 'LOW_CONFIDENCE', outcome20d: 'PENDING' }),
      sample({ dataQualityBucket: 'HIGH_CONFIDENCE', includeInPerformanceLearning: false, futureReturn20d: 20, outcome20d: 'WIN' }),
    ];
    const result = aggregatePerformanceByDataQuality(rows);
    const high = result.find((r) => r.bucket === 'HIGH_CONFIDENCE')!;
    const low = result.find((r) => r.bucket === 'LOW_CONFIDENCE')!;
    expect(high.count).toBe(2);
    expect(high.winRate20d).toBe(0.5);
    expect(high.avgReturn20d).toBe(1);
    expect(low.count).toBe(2);
    expect(low.winRate20d).toBe(0);
  });

  it('critical flag별 성과를 집계한다', () => {
    const trueHealth = snapshot({ criticalFlags: { investorFlowDegraded: true } });
    const falseHealth = snapshot();
    const result = aggregatePerformanceByCriticalFlag([
      sample({ supplyHealthSnapshot: trueHealth, futureReturn20d: -6, outcome20d: 'LOSS' }),
      sample({ supplyHealthSnapshot: falseHealth, futureReturn20d: 8, outcome20d: 'WIN' }),
    ]);
    const row = result.find((r) => r.flag === 'investorFlowDegraded')!;
    expect(row.trueCount).toBe(1);
    expect(row.falseCount).toBe(1);
    expect(row.avgReturn20dWhenTrue).toBe(-6);
    expect(row.winRate20dWhenFalse).toBe(1);
  });
});

describe('강등 효과 분석', () => {
  it('avoidedLossCount와 POSITIVE 판정을 계산한다', () => {
    const result = analyzeDowngradeEffectiveness([
      sample({ rawSignal: 'STRONG_BUY', finalSignal: 'BUY', wasDowngradedBySupplyHealth: true, futureReturn20d: -4, outcome20d: 'LOSS' }),
      sample({ rawSignal: 'BUY', finalSignal: 'WATCH', wasDowngradedBySupplyHealth: true, futureReturn20d: -8, outcome20d: 'LOSS' }),
      sample({ rawSignal: 'BUY', finalSignal: 'BUY', wasDowngradedBySupplyHealth: true, futureReturn20d: 6, outcome20d: 'WIN' }),
    ]);
    expect(result.avoidedLossCount).toBe(2);
    expect(result.missedGainCount).toBe(1);
    expect(result.ruleEffectiveness).toBe('POSITIVE');
  });

  it('missedGainCount와 NEGATIVE, 동률 INCONCLUSIVE를 판정한다', () => {
    const negative = analyzeDowngradeEffectiveness([
      sample({ rawSignal: 'BUY', finalSignal: 'WATCH', wasDowngradedBySupplyHealth: true, futureReturn20d: 7, outcome20d: 'WIN' }),
      sample({ rawSignal: 'BUY', finalSignal: 'WATCH', wasDowngradedBySupplyHealth: true, futureReturn20d: 9, outcome20d: 'WIN' }),
      sample({ rawSignal: 'BUY', finalSignal: 'WATCH', wasDowngradedBySupplyHealth: true, futureReturn20d: -4, outcome20d: 'LOSS' }),
    ]);
    expect(negative.ruleEffectiveness).toBe('NEGATIVE');

    const inconclusive = analyzeDowngradeEffectiveness([
      sample({ rawSignal: 'BUY', finalSignal: 'WATCH', wasDowngradedBySupplyHealth: true, futureReturn20d: 6, outcome20d: 'WIN' }),
      sample({ rawSignal: 'BUY', finalSignal: 'WATCH', wasDowngradedBySupplyHealth: true, futureReturn20d: -4, outcome20d: 'LOSS' }),
    ]);
    expect(inconclusive.ruleEffectiveness).toBe('INCONCLUSIVE');
  });
});

describe('execution routing', () => {
  it('BROKEN/UNSAFE/OK 기본 라우팅을 분리한다', () => {
    expect(determineExecutionMode({
      rawSignal: 'STRONG_BUY',
      finalSignal: 'NO_DECISION',
      dataConfidence: 0,
      overallStatus: 'BROKEN',
      wasDowngradedBySupplyHealth: true,
    })).toBe('BLOCKED');
    expect(determineExecutionMode({
      rawSignal: 'BUY',
      finalSignal: 'WATCH',
      dataConfidence: 0.3,
      overallStatus: 'UNSAFE',
      wasDowngradedBySupplyHealth: true,
    })).toBe('SHADOW');
    expect(determineExecutionMode({
      rawSignal: 'STRONG_BUY',
      finalSignal: 'STRONG_BUY',
      dataConfidence: 0.9,
      overallStatus: 'OK',
      wasDowngradedBySupplyHealth: false,
    })).toBe('LIVE');
  });
});
