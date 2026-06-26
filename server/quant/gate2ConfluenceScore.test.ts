// @responsibility ADR-0519 Gate2 confluence promotion policy tests.
import { describe, expect, it } from 'vitest';
import {
  buildGate2ConfluenceSummary,
  buildGate2EvaluationResult,
  formatGate2ConfluenceCompact,
  isGate2ProportionalBullishEnabled,
  proportionalRequiredAxisCount,
  type Gate2EvaluationResult,
} from './gate2ConfluenceScore.js';
import { afterEach } from 'vitest';

function bullishTrace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: '005930',
    name: 'Samsung',
    gate1Passed: true,
    symbolFeatures: {
      rsScore: 100,
      maAlignmentStatus: 'NEUTRAL',
      aboveMA20: true,
      aboveMA60: true,
      return20d: 4,
    },
    gate2ExternalDataCoverage: {
      kisInvestorFlow: {
        status: 'VERIFIED',
        foreignNetBuy: 1200,
        institutionalNetBuy: 900,
      },
      sectorCycle: {
        status: 'VERIFIED',
        values: {
          sectorRelativeReturn20d: 8,
          stockVsSectorReturn20d: 4,
          sectorPercentile20d: 82,
        },
      },
      leaderCycle: {
        isCurrentLeadingSector: true,
        isSectorLeader: true,
        attentionPhase: 'EARLY',
      },
    },
    ...overrides,
  };
}

function status(result: Gate2EvaluationResult): string {
  return result.gate2Status;
}

describe('ADR-0519 Gate2 confluence score', () => {
  it('classifies RS/supply/sector bullish with technical neutral and fundamental missing as pass via coverage adjusted score', () => {
    const result = buildGate2EvaluationResult({
      trace: bullishTrace(),
      sourceSnapshotId: 'snap:gate2',
    });

    expect(['GATE2_PASS_STRONG', 'GATE2_PASS_WEAK']).toContain(status(result));
    expect(result.usableAxisCount).toBeGreaterThanOrEqual(4);
    expect(result.coverageAdjustedScore).toBeGreaterThanOrEqual(80);
    expect(result.axes.find(axis => axis.axis === 'FUNDAMENTAL_QUALITY')).toMatchObject({
      status: 'MISSING',
      scoreIncluded: false,
      missingReason: 'DART_FINANCIALS_MISSING',
    });
    expect(result.executionImpact).toBe('NONE');
    expect(result.marketSignal).toBe(false);
  });

  it('uses DATA_INCOMPLETE when fewer than three axes are usable', () => {
    const result = buildGate2EvaluationResult({
      sourceSnapshotId: 'snap:gate2',
      trace: {
        symbol: '000660',
        gate1Passed: true,
        symbolFeatures: {
          rsScore: 85,
          maAlignmentStatus: 'BULLISH',
          aboveMA20: true,
          aboveMA60: true,
        },
      },
    });

    expect(result.gate2Status).toBe('DATA_INCOMPLETE');
    expect(result.usableAxisCount).toBe(2);
    expect(result.primaryBlocker).toContain('MISSING_');
  });

  it('excludes AI estimated fundamentals from weighted score', () => {
    const result = buildGate2EvaluationResult({
      sourceSnapshotId: 'snap:gate2',
      trace: bullishTrace({
        gate2ExternalDataCoverage: {
          kisInvestorFlow: { status: 'VERIFIED', foreignNetBuy: 1, institutionalNetBuy: 1 },
          sectorCycle: { status: 'VERIFIED', values: { sectorRelativeReturn20d: 8, stockVsSectorReturn20d: 4 } },
          dartFinancials: { status: 'VERIFIED', source: 'AI_ESTIMATED', confidence: 'AI_ESTIMATED' },
        },
      }),
    });

    const fundamental = result.axes.find(axis => axis.axis === 'FUNDAMENTAL_QUALITY');
    expect(fundamental).toMatchObject({
      confidence: 'AI_ESTIMATED',
      promotionStage: 'OBSERVE',
      scoreIncluded: false,
    });
    expect(result.aiEstimatedAxisCount).toBe(1);
  });

  it('neutralizes NO_ROW_FOUND supply instead of treating it as bearish', () => {
    const result = buildGate2EvaluationResult({
      sourceSnapshotId: 'snap:gate2',
      trace: bullishTrace({
        supplyProviderHealth: {
          semanticRowBreakPoint: 'NO_ROW_FOUND',
        },
        gate2ExternalDataCoverage: {
          kisInvestorFlow: { status: 'MISSING' },
          sectorCycle: { status: 'VERIFIED', values: { sectorRelativeReturn20d: 8, stockVsSectorReturn20d: 4 } },
        },
      }),
    });

    const supply = result.axes.find(axis => axis.axis === 'SUPPLY_CONFLUENCE');
    expect(supply).toMatchObject({
      status: 'MISSING',
      confidence: 'MISSING',
      scoreIncluded: false,
      missingReason: 'SUPPLY_ROW_MISSING_NEUTRALIZED',
    });
    expect(supply?.evidence).toContain('marketSignal=false');
  });

  it('skips Gate2 when Gate1 hard failed', () => {
    const result = buildGate2EvaluationResult({
      sourceSnapshotId: 'snap:gate2',
      trace: {
        ...bullishTrace(),
        gate1Passed: false,
        gate1Trace: { hardFailCount: 1, gate1Passed: false },
      },
    });

    expect(result.gate2Status).toBe('SKIPPED_BY_GATE1');
    expect(result.gate2EvaluationScope).toBe('DIAGNOSTIC_ONLY');
    expect(result.finalGate2).toBe('NOT_EVALUATED_DUE_TO_GATE1_FAIL');
    expect(result.upstreamBlocker).toBe('GATE1_FAIL');
    expect(result.gate2DiagnosticPrimary).toBe('SKIPPED_BY_GATE1_HARD_FAIL');
    expect(result.primaryBlocker).toBeUndefined();
    expect(result.executionImpact).toBe('NONE');
  });

  it('evaluates Gate1 degraded-pass candidates diagnostically', () => {
    const result = buildGate2EvaluationResult({
      sourceSnapshotId: 'snap:gate2',
      trace: {
        ...bullishTrace({ gate1Passed: false }),
        gate1Trace: {
          gate1Passed: false,
          hardFailCount: 1,
          wouldPassIfProviderIssueSoftened: true,
        },
      },
    });

    expect(result.gate1Status).toBe('DEGRADED_PASS');
    expect(result.gate2Status).not.toBe('SKIPPED_BY_GATE1');
    expect(result.shadowLearning).toBe(true);
  });

  it('keeps programTrade ACCEPTED_EMPTY excluded from score and sectorEnergy advisory as non-blocking', () => {
    const result = buildGate2EvaluationResult({
      sourceSnapshotId: 'snap:gate2',
      trace: bullishTrace({
        gate2ExternalDataCoverage: {
          kisInvestorFlow: { status: 'VERIFIED', foreignNetBuy: 100, institutionalNetBuy: 0 },
          programTrade: { stockProgram: { status: 'ACCEPTED_EMPTY' } },
          sectorCycle: { status: 'PARTIAL', values: { sectorRelativeReturn20d: 10, stockVsSectorReturn20d: 5 } },
          leaderCycle: { isCurrentLeadingSector: true, isSectorLeader: true, attentionPhase: 'NORMAL' },
        },
      }),
    });

    expect(result.axes.some(axis => axis.axis === 'SECTOR_LEADERSHIP' && axis.promotionStage === 'ADVISORY')).toBe(true);
    expect(result.primaryBlocker).not.toBe('programTrade');
    expect(result.executionImpact).toBe('NONE');
  });

  it('builds aggregate counters and counterfactual seed payloads from candidate details', () => {
    const summary = buildGate2ConfluenceSummary({
      sourceSnapshotId: 'snap:gate2',
      traces: [
        bullishTrace({ symbol: '005930' }),
        {
          ...bullishTrace({ symbol: '000660' }),
          gate1Passed: false,
          gate1Trace: { hardFailCount: 1, gate1Passed: false },
        },
      ],
    });

    expect(summary.totalCandidates).toBe(2);
    expect(summary.evaluated).toBe(1);
    expect(summary.gate2SkippedByGate1HardFail).toBe(1);
    expect(summary.counterfactualSeeds).toHaveLength(2);
    expect(summary.counterfactualSeeds[0]).toMatchObject({
      sourceSnapshotId: 'snap:gate2',
      executionImpact: 'NONE',
      marketSignal: false,
      shadowLearning: true,
      counterfactualRecorded: true,
    });
    expect(summary.executionImpact).toBe('NONE');
  });
});

describe('ADR-0599 coverage-proportional confluence requirement', () => {
  afterEach(() => { delete process.env.GATE2_PROPORTIONAL_BULLISH_ENABLED; });

  function threeAxisTrace(): Record<string, unknown> {
    const trace = bullishTrace();
    const external = trace.gate2ExternalDataCoverage as Record<string, unknown>;
    delete external.sectorCycle;
    delete external.leaderCycle;
    return trace;
  }

  it('proportionalRequiredAxisCount — ceil(60%)·1~3 클램프 (5축 가용 시 기존 3 동일)', () => {
    expect(proportionalRequiredAxisCount(1)).toBe(1);
    expect(proportionalRequiredAxisCount(2)).toBe(2);
    expect(proportionalRequiredAxisCount(3)).toBe(2);
    expect(proportionalRequiredAxisCount(4)).toBe(3);
    expect(proportionalRequiredAxisCount(5)).toBe(3);
    expect(isGate2ProportionalBullishEnabled({})).toBe(false);
    expect(isGate2ProportionalBullishEnabled({ GATE2_PROPORTIONAL_BULLISH_ENABLED: 'true' })).toBe(true);
  });

  it('flag OFF: 3축 가용·bullish 2 → 기존 동작(STRONG 미도달) + would-strong dry-run 항상 산출', () => {
    const result = buildGate2EvaluationResult({ trace: threeAxisTrace(), sourceSnapshotId: 'snap:adr0599' });
    expect(result.usableAxisCount).toBe(3);
    expect(result.bullishAxisCount).toBe(2);
    expect(result.gate2Status).toBe('GATE2_PASS_WEAK');
    expect(result.requiredConfluenceAxisCount).toBe(3);
    expect(result.wouldPassStrongProportional).toBe(true);
    expect(result.wouldPassWeakProportional).toBe(true);
  });

  it('flag ON: 동일 입력이 STRONG (요구 ceil(3×0.6)=2) — 결손이 요구를 강화하지 않음', () => {
    process.env.GATE2_PROPORTIONAL_BULLISH_ENABLED = 'true';
    const result = buildGate2EvaluationResult({ trace: threeAxisTrace(), sourceSnapshotId: 'snap:adr0599' });
    expect(result.requiredConfluenceAxisCount).toBe(2);
    expect(result.gate2Status).toBe('GATE2_PASS_STRONG');
  });

  it('summary dry-run 집계 + compact 출력에 proportionalDryRun 1줄', () => {
    const summary = buildGate2ConfluenceSummary({
      sourceSnapshotId: 'snap:adr0599',
      traces: [threeAxisTrace()],
    });
    expect(summary.wouldStrongProportional).toBe(1);
    expect(summary.gate2PassStrong).toBe(0);
    expect(formatGate2ConfluenceCompact(summary)).toContain('proportionalDryRun: strong=1');
  });
});

describe('ADR-0600 Supply/Sector 결손 축 보수 fallback', () => {
  afterEach(() => { delete process.env.GATE2_AXIS_COVERAGE_FALLBACK_ENABLED; });

  function supplyMissingTrace(state?: string): Record<string, unknown> {
    const trace = bullishTrace();
    const external = trace.gate2ExternalDataCoverage as Record<string, unknown>;
    delete external.kisInvestorFlow;
    if (state) trace.supplyConfluenceState = state;
    return trace;
  }

  it('D1: KIS 투자자행 결손 + Gate1 시맨틱 BULLISH → DEGRADED/ADVISORY fallback (78, BULLISH 민팅 금지)', () => {
    const result = buildGate2EvaluationResult({ trace: supplyMissingTrace('BULLISH'), sourceSnapshotId: 'snap:adr0600' });
    const supply = result.axes.find(axis => axis.axis === 'SUPPLY_CONFLUENCE');
    expect(supply).toMatchObject({
      score: 78,
      status: 'ACCUMULATING',
      confidence: 'DEGRADED',
      scoreIncluded: true,
      source: 'GATE1_SUPPLY_SEMANTIC_FALLBACK',
    });
  });

  it('D1: 시맨틱 UNKNOWN/부재 → 기존 missing 유지 (결손 ≠ 신호) · flag=false → fallback 차단', () => {
    const unknown = buildGate2EvaluationResult({ trace: supplyMissingTrace('UNKNOWN'), sourceSnapshotId: 'snap:adr0600' });
    expect(unknown.axes.find(axis => axis.axis === 'SUPPLY_CONFLUENCE')?.status).toBe('MISSING');
    process.env.GATE2_AXIS_COVERAGE_FALLBACK_ENABLED = 'false';
    const off = buildGate2EvaluationResult({ trace: supplyMissingTrace('BULLISH'), sourceSnapshotId: 'snap:adr0600' });
    expect(off.axes.find(axis => axis.axis === 'SUPPLY_CONFLUENCE')?.status).toBe('MISSING');
  });

  it('D2: 업종지수 결손 + 스캔 내 동종군(n>=3) → 상대수익 fallback (최대 62, BULLISH 불가) · n<3 → missing', () => {
    const peerTrace = (symbol: string, return20d: number, sector = '반도체') => {
      const trace = bullishTrace({ symbol });
      const external = trace.gate2ExternalDataCoverage as Record<string, unknown>;
      delete external.sectorCycle;
      delete external.leaderCycle;
      trace.sector = sector;
      (trace.symbolFeatures as Record<string, unknown>).return20d = return20d;
      return trace;
    };
    const summary = buildGate2ConfluenceSummary({
      sourceSnapshotId: 'snap:adr0600',
      traces: [peerTrace('A', 10), peerTrace('B', 2), peerTrace('C', 1), peerTrace('D', -8), peerTrace('E', 5, '단독섹터')],
    });
    const axisOf = (symbol: string) => summary.results.find(r => r.symbol === symbol)?.axes.find(a => a.axis === 'SECTOR_LEADERSHIP');
    expect(axisOf('A')).toMatchObject({ score: 62, scoreIncluded: true, source: 'SCAN_PEER_RELATIVE_FALLBACK' });
    expect(axisOf('D')?.score).toBe(35);
    expect(axisOf('E')?.status).toBe('MISSING');
    for (const symbol of ['A', 'B', 'C', 'D']) {
      expect(axisOf(symbol)?.status).not.toBe('BULLISH');
    }
  });
});

describe('ADR-0655 Gate2 재무 위험 페널티 (buildFundamentalAxis score-cap seam)', () => {
  afterEach(() => {
    delete process.env.GATE2_FINANCIAL_RISK_PENALTY_ENABLED;
  });

  // 검증된(weighted) FUNDAMENTAL_QUALITY 축 + 위험/정상 재무를 trace 에 주입.
  function riskTrace(stability: Record<string, unknown>, dartExtra: Record<string, unknown> = {}): Record<string, unknown> {
    const trace = bullishTrace();
    const external = trace.gate2ExternalDataCoverage as Record<string, unknown>;
    external.dartFinancials = { status: 'VERIFIED', source: 'DART', confidence: 'VERIFIED', ...dartExtra };
    external.stability = { source: 'DART', ...stability };
    return trace;
  }
  const fundamentalOf = (result: Gate2EvaluationResult) =>
    result.axes.find(axis => axis.axis === 'FUNDAMENTAL_QUALITY');

  it('flag OFF(explicit =false kill-switch) → 위험 종목(ICR<1·부채>200)이어도 score byte-identical (cap 미적용)', () => {
    // ADR-0656 default ON flip 이후 OFF byte-identical 의도 보존을 위해 explicit `=false` pin.
    process.env.GATE2_FINANCIAL_RISK_PENALTY_ENABLED = 'false';
    const trace = riskTrace({ icr: 0.3, debtRatio: 300 });
    const off = fundamentalOf(buildGate2EvaluationResult({ trace, sourceSnapshotId: 'snap:off' }));
    // 위험 평가가 ON 됐다면 ≤15(CRITICAL cap)로 눌렸겠으나, OFF 이므로 현행 score 유지(>15).
    expect(off?.score).toBeGreaterThan(15);
    expect(off?.evidence?.some(e => e.startsWith('gate2FinancialRisk='))).toBe(false);
  });

  it('ADR-0656 default(미설정)=ON → 위험 종목(ICR<1·부채>200)이 CRITICAL cap ≤15 로 강등', () => {
    // env 미설정 = default ON (opt-OUT `!== 'false'`). flip 후 위험종목이 cap 적용됨을 확인.
    delete process.env.GATE2_FINANCIAL_RISK_PENALTY_ENABLED;
    const trace = riskTrace({ icr: 0.3, debtRatio: 300 });
    const fundamental = fundamentalOf(buildGate2EvaluationResult({ trace, sourceSnapshotId: 'snap:default-on' }));
    expect(fundamental?.score).toBeLessThanOrEqual(15);
    expect(fundamental?.evidence).toContain('gate2FinancialRisk=CRITICAL');
    expect(fundamental?.evidence).toContain('riskTriggers=[ICR_BELOW_1,DEBT_RATIO_EXCESS]');
  });

  it('ADR-0656 default(미설정)=ON + 위험 0건(정상 재무) → byte-identical (scoreCap=null·NONE graceful)', () => {
    // default ON 이어도 trigger 0개 종목은 byte-identical (불변식 #6 graceful).
    process.env.GATE2_FINANCIAL_RISK_PENALTY_ENABLED = 'false';
    const baseline = fundamentalOf(buildGate2EvaluationResult({ trace: riskTrace({ icr: 3, debtRatio: 50 }), sourceSnapshotId: 'snap:base-off' }))?.score;
    delete process.env.GATE2_FINANCIAL_RISK_PENALTY_ENABLED;
    const on = fundamentalOf(buildGate2EvaluationResult({ trace: riskTrace({ icr: 3, debtRatio: 50 }), sourceSnapshotId: 'snap:default-on-none' }));
    expect(on?.score).toBe(baseline);
    expect(on?.evidence).toContain('gate2FinancialRisk=NONE');
    expect(on?.evidence).toContain('riskScoreCap=null');
  });

  it('flag ON + 위험 trigger 0개(정상 재무) → byte-identical (scoreCap=null, score 동일)', () => {
    const trace = riskTrace({ icr: 3, debtRatio: 50 });
    const off = fundamentalOf(buildGate2EvaluationResult({ trace, sourceSnapshotId: 'snap:base' }))?.score;
    process.env.GATE2_FINANCIAL_RISK_PENALTY_ENABLED = 'true';
    const on = fundamentalOf(buildGate2EvaluationResult({ trace, sourceSnapshotId: 'snap:on' }));
    expect(on?.score).toBe(off);
    // trace 는 노출되나 cap 은 미적용(NONE).
    expect(on?.evidence).toContain('gate2FinancialRisk=NONE');
    expect(on?.evidence).toContain('riskScoreCap=null');
  });

  it('flag ON + ICR<1 단독 → FUNDAMENTAL_QUALITY score ≤30·status WEAK·evidence riskLevel trace', () => {
    process.env.GATE2_FINANCIAL_RISK_PENALTY_ENABLED = 'true';
    const trace = riskTrace({ icr: 0.5, debtRatio: 80 });
    const fundamental = fundamentalOf(buildGate2EvaluationResult({ trace, sourceSnapshotId: 'snap:icr' }));
    expect(fundamental?.score).toBeLessThanOrEqual(30);
    expect(fundamental?.status).toBe('WEAK');
    expect(fundamental?.evidence).toContain('gate2FinancialRisk=ELEVATED');
    expect(fundamental?.evidence).toContain('riskTriggers=[ICR_BELOW_1]');
  });

  it('flag ON + ICR<1 AND 부채>200 → CRITICAL cap ≤15', () => {
    process.env.GATE2_FINANCIAL_RISK_PENALTY_ENABLED = 'true';
    const trace = riskTrace({ icr: 0.2, debtRatio: 350 });
    const fundamental = fundamentalOf(buildGate2EvaluationResult({ trace, sourceSnapshotId: 'snap:crit' }));
    expect(fundamental?.score).toBeLessThanOrEqual(15);
    expect(fundamental?.evidence).toContain('gate2FinancialRisk=CRITICAL');
  });

  it('flag ON + 결손(ICR/debtRatio null) → 페널티 미적용 (현행 score 유지, NONE)', () => {
    const trace = riskTrace({ icr: null, debtRatio: null });
    const off = fundamentalOf(buildGate2EvaluationResult({ trace, sourceSnapshotId: 'snap:gbase' }))?.score;
    process.env.GATE2_FINANCIAL_RISK_PENALTY_ENABLED = 'true';
    const on = fundamentalOf(buildGate2EvaluationResult({ trace, sourceSnapshotId: 'snap:gnull' }));
    expect(on?.score).toBe(off);
    expect(on?.evidence).toContain('gate2FinancialRisk=NONE');
  });

  it('flag ON + 위험 종목도 entryHardBlock 0 — Gate2 status 는 다축 confluence 로 판정 (executionImpact NONE)', () => {
    process.env.GATE2_FINANCIAL_RISK_PENALTY_ENABLED = 'true';
    const trace = riskTrace({ icr: 0.2, debtRatio: 350 });
    const result = buildGate2EvaluationResult({ trace, sourceSnapshotId: 'snap:noblock' });
    // 다축(RS/Supply/Sector bullish)이 살아있어 한 축 cap 만으로 전체 차단되지 않는다.
    expect(result.gate2Status).not.toBe('GATE2_FAIL');
    expect(result.executionImpact).toBe('NONE');
    expect(result.marketSignal).toBe(false);
  });
});
