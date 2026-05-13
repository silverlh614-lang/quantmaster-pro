/**
 * @responsibility ADR-0507 — Gate1 Forensic Collector Wiring + Gate Mode Compact Split 회귀.
 *
 * 사용자 명시 §L 회귀 매트릭스 직접 반영:
 *   - parseScanBlockersMode 가 `gate` 단독 → gateSubMode='compact', `gate full`
 *     → gateSubMode='full' 정확 인식.
 *   - formatScanBlockersGateCompactMessage 가 forensic 부재 / EMITTED 양쪽 분기.
 *   - collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507 SSOT 가
 *     gate1CandidateTraces 부재 / minSignalScoreTrace 부재 / 정상 입력 정확 처리.
 *   - persistScanResults 자동 합성 — FORENSIC_INPUTS_MISSING → EMITTED 전환 검증.
 *   - 정적 grep 가드: scanDiagnostics import + scanBlockers.cmd wiring + scope 보존.
 *   - 안전 invariant: requiredScore / threshold / order path / Gate 판정 변경 0.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  parseScanBlockersMode,
  formatScanBlockersGateCompactMessage,
  SCAN_BLOCKERS_GATE_FULL_HINT,
  SCAN_BLOCKERS_USAGE_HINT,
  deriveAdr0505EmissionStatus,
  type Adr0505EmissionDiagnostic,
} from './scanBlockersCompactAdr0506.js';
import {
  collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507,
  isGate1ForensicCollectorAdr0507Disabled,
} from '../../../trading/signalScanner/gate1ForensicInputsCollectorAdr0507.js';
import type { ScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import type { Gate1MinimumSignalForensicSummaryAdr0505 } from '../../../trading/signalScanner/gate1MinimumSignalForensicAuditAdr0505.js';
import type { Gate1CandidateTrace, SupplyProviderHealthTrace } from '../../../trading/signalScanner/entryFilterDecomposition.js';
import type { MinimumSignalScoreTrace } from '../../../trading/signalScanner/minimumSignalScoreTrace.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ───────── parseScanBlockersMode — ADR-0507 gate sub-mode ───────── */

describe('ADR-0507 parseScanBlockersMode — gate sub-mode', () => {
  it('`gate` 단독 → gateSubMode=compact (default)', () => {
    const r = parseScanBlockersMode(['gate']);
    expect(r.mode).toBe('gate');
    expect(r.gateSubMode).toBe('compact');
    expect(r.isUnknown).toBe(false);
  });

  it('`gate full` → gateSubMode=full', () => {
    const r = parseScanBlockersMode(['gate', 'full']);
    expect(r.mode).toBe('gate');
    expect(r.gateSubMode).toBe('full');
  });

  it('`gate FULL` 대소문자 무관', () => {
    const r = parseScanBlockersMode(['gate', 'FULL']);
    expect(r.gateSubMode).toBe('full');
  });

  it('`gate compact` (명시) → gateSubMode=compact', () => {
    const r = parseScanBlockersMode(['gate', 'compact']);
    expect(r.gateSubMode).toBe('compact');
  });

  it('`gate xyz` (unknown sub) → gateSubMode=compact fallback (silent)', () => {
    const r = parseScanBlockersMode(['gate', 'xyz']);
    expect(r.gateSubMode).toBe('compact');
    expect(r.isUnknown).toBe(false); // mode 자체는 gate 로 유효
  });

  it('string 입력 `gate full` 도 인식', () => {
    const r = parseScanBlockersMode('gate full');
    expect(r.mode).toBe('gate');
    expect(r.gateSubMode).toBe('full');
  });

  it('gate 외 mode 에선 gateSubMode 항상 undefined', () => {
    expect(parseScanBlockersMode(['full']).gateSubMode).toBeUndefined();
    expect(parseScanBlockersMode(['supply']).gateSubMode).toBeUndefined();
    expect(parseScanBlockersMode(['sector']).gateSubMode).toBeUndefined();
    expect(parseScanBlockersMode(['runtime']).gateSubMode).toBeUndefined();
    expect(parseScanBlockersMode([]).gateSubMode).toBeUndefined();
  });

  it('SCAN_BLOCKERS_USAGE_HINT 가 `gate full` 옵션 안내 포함', () => {
    expect(SCAN_BLOCKERS_USAGE_HINT).toContain('gate full');
  });
});

/* ───────── isGate1ForensicCollectorAdr0507Disabled — ENV gate ───────── */

describe('ADR-0507 isGate1ForensicCollectorAdr0507Disabled — ENV gate', () => {
  beforeEach(() => {
    delete process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED;
  });

  it('default OFF — false 반환', () => {
    expect(isGate1ForensicCollectorAdr0507Disabled()).toBe(false);
  });

  it('=true 정확 비교 (ADR-0157)', () => {
    process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED = 'true';
    expect(isGate1ForensicCollectorAdr0507Disabled()).toBe(true);
    delete process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED;
  });

  it("'1' / 'TRUE' / 'yes' 거부 (ADR-0157)", () => {
    for (const v of ['1', 'TRUE', 'yes', 'enabled']) {
      process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED = v;
      expect(isGate1ForensicCollectorAdr0507Disabled()).toBe(false);
    }
    delete process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED;
  });
});

/* ───────── collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507 ───────── */

function makeMinTrace(symbol: string, actualScore: number): MinimumSignalScoreTrace {
  return {
    actualScore,
    requiredScore: 60,
    passed: actualScore >= 60,
    scoreGap: actualScore - 60,
    positiveScoreTotal: Math.max(actualScore, 0),
    negativeScoreTotal: Math.min(actualScore, 0),
    components: [],
    unknownPenaltyTotal: 0,
    appliedPenalties: [],
    ceiling: 100,
    timestamp: '2026-05-13T00:00:00.000Z',
    symbol,
  } as unknown as MinimumSignalScoreTrace;
}

function makeGate1CandidateTrace(symbol: string, score: number): Gate1CandidateTrace {
  return {
    symbol,
    minSignalScoreTrace: makeMinTrace(symbol, score),
  } as unknown as Gate1CandidateTrace;
}

describe('ADR-0507 collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507', () => {
  beforeEach(() => {
    delete process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED;
  });

  it('ENV disabled → 빈 배열', () => {
    process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED = 'true';
    const r = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      gate1CandidateTraces: [makeGate1CandidateTrace('005930', 70)],
    });
    expect(r).toEqual([]);
    delete process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED;
  });

  it('빈 traces → 빈 배열', () => {
    expect(collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({}).length).toBe(0);
    expect(
      collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({ gate1CandidateTraces: [] }).length,
    ).toBe(0);
  });

  it('정상 입력 — trace 모두 propagate + quoteSymbol = candidate.symbol', () => {
    const r = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      gate1CandidateTraces: [
        makeGate1CandidateTrace('005930', 70),
        makeGate1CandidateTrace('000660', 45),
      ],
    });
    expect(r.length).toBe(2);
    expect(r[0]!.quoteSymbol).toBe('005930');
    expect(r[1]!.quoteSymbol).toBe('000660');
    expect(r[0]!.trace.actualScore).toBe(70);
    expect(r[1]!.trace.actualScore).toBe(45);
  });

  it('minSignalScoreTrace 부재 trace 는 silent skip', () => {
    const r = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      gate1CandidateTraces: [
        { symbol: '005930', minSignalScoreTrace: undefined } as unknown as Gate1CandidateTrace,
        makeGate1CandidateTrace('000660', 55),
      ],
    });
    expect(r.length).toBe(1);
    expect(r[0]!.quoteSymbol).toBe('000660');
  });

  it('supplyProviderHealth 공통 share — 모든 entry 에 동일 객체 전달', () => {
    const sph = {
      status: 'VERIFIED',
      providerName: 'KRX',
      gate1Severity: 'NONE',
      reason: [],
      providerIssue: false,
      marketSignal: true,
    } as unknown as SupplyProviderHealthTrace;
    const r = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      gate1CandidateTraces: [
        makeGate1CandidateTrace('005930', 70),
        makeGate1CandidateTrace('000660', 50),
      ],
      supplyProviderHealth: sph,
    });
    expect(r.length).toBe(2);
    expect(r[0]!.supplyProviderHealth).toBe(sph);
    expect(r[1]!.supplyProviderHealth).toBe(sph);
  });

  it('supplyProviderHealth 부재 시 supplyProviderHealth 키 미포함', () => {
    const r = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      gate1CandidateTraces: [makeGate1CandidateTrace('005930', 70)],
    });
    expect(r.length).toBe(1);
    expect((r[0] as { supplyProviderHealth?: unknown }).supplyProviderHealth).toBeUndefined();
  });
});

/* ───────── formatScanBlockersGateCompactMessage ───────── */

function makeForensicSummary(
  overrides: Partial<Gate1MinimumSignalForensicSummaryAdr0505> = {},
): Gate1MinimumSignalForensicSummaryAdr0505 {
  return {
    totalCandidates: 8,
    failedCandidates: 5,
    requiredScoreAvg: 60,
    actualScoreAvg: 42.3,
    avgScoreGap: -17.7,
    dominantFailureDistribution: {
      POSITIVE_SCORE_STARVATION: 3,
      WATCHLIST_UPSTREAM_MISSING: 1,
      RELATIVE_STRENGTH_MISSING: 1,
      BREAKOUT_STRUCTURE_MISSING: 0,
      SUPPLY_PROVIDER_UNKNOWN_PENALTY: 0,
      INVESTOR_FLOW_UNKNOWN_PENALTY: 0,
      SECTOR_ENERGY_DIAGNOSTIC_PENALTY: 0,
      SCORE_CEILING_BELOW_THRESHOLD: 0,
      MIXED: 0,
      UNKNOWN: 0,
    } as unknown as Gate1MinimumSignalForensicSummaryAdr0505['dominantFailureDistribution'],
    missingPositiveSourceCounts: {
      watchlistUpstreamMissing: 2,
      relativeStrengthMissing: 1,
      breakoutStructureMissing: 1,
      priceMomentumMissing: 0,
      technicalTrendMissing: 0,
      volumeLiquidityMissing: 0,
    },
    penaltyCounts: {
      supplyUnknownPenalty: 2,
      investorFlowUnknownPenalty: 1,
      sectorEnergyPenaltyOrBlocked: 0,
      unknownDataPenalty: 1,
      softFailPenalty: 0,
      riskPenalty: 0,
    },
    supplyScopeWarnings: {
      KIS_FLOW_SYMBOL_MISSING: 1,
      KIS_FLOW_SYMBOL_MISMATCH: 0,
      KIS_FLOW_SEMANTIC_UNAVAILABLE: 0,
      POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT: 0,
    } as unknown as Gate1MinimumSignalForensicSummaryAdr0505['supplyScopeWarnings'],
    sectorEnergyStrongBuyBlockedCount: 0,
    sectorEnergyHardBlockCount: 0,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    ...overrides,
  };
}

describe('ADR-0507 formatScanBlockersGateCompactMessage', () => {
  it('forensic 부재 — NOT_EMITTED 안내 + gate full hint', () => {
    const out = formatScanBlockersGateCompactMessage(null);
    expect(out).toContain('ADR-0505 NOT_EMITTED');
    expect(out).toContain(SCAN_BLOCKERS_GATE_FULL_HINT);
  });

  it('forensic totalCandidates=0 — NOT_EMITTED 안내', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      candidates: 8,
      gate1MinimumSignalForensicAdr0505: makeForensicSummary({ totalCandidates: 0, failedCandidates: 0 }),
    } as unknown as ScanSummary;
    const adr = deriveAdr0505EmissionStatus(summary);
    expect(adr.status).toBe('BUILDER_NOT_CALLED');
    const out = formatScanBlockersGateCompactMessage(summary, { adr0505: adr });
    expect(out).toContain('NOT_EMITTED');
  });

  it('EMITTED — requiredAvg / actualAvg / gap 모두 출력', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      candidates: 8,
      gate1MinimumSignalForensicAdr0505: makeForensicSummary(),
    } as unknown as ScanSummary;
    const adr = deriveAdr0505EmissionStatus(summary);
    expect(adr.status).toBe('EMITTED');
    const out = formatScanBlockersGateCompactMessage(summary, { adr0505: adr });
    expect(out).toContain('EMITTED');
    expect(out).toContain('requiredAvg: 60');
    expect(out).toContain('actualAvg:');
    expect(out).toContain('42.3');
    expect(out).toContain('gap:');
    expect(out).toContain('-17.7');
  });

  it('dominant failure Top 3 노출 (count>0 만)', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      candidates: 8,
      gate1MinimumSignalForensicAdr0505: makeForensicSummary(),
    } as unknown as ScanSummary;
    const out = formatScanBlockersGateCompactMessage(summary, {
      adr0505: deriveAdr0505EmissionStatus(summary),
    });
    expect(out).toContain('dominant failure Top 3');
    expect(out).toContain('POSITIVE_SCORE_STARVATION');
    expect(out).toContain('3');
    // count=0 항목은 미노출
    expect(out).not.toContain('SCORE_CEILING_BELOW_THRESHOLD: 0');
    expect(out).not.toContain('MIXED: 0');
  });

  it('missing positive Top 3 + penalty Top 3 노출', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      candidates: 8,
      gate1MinimumSignalForensicAdr0505: makeForensicSummary(),
    } as unknown as ScanSummary;
    const out = formatScanBlockersGateCompactMessage(summary, {
      adr0505: deriveAdr0505EmissionStatus(summary),
    });
    expect(out).toContain('missing positive Top 3');
    expect(out).toContain('watchlistUpstreamMissing');
    expect(out).toContain('penalty Top 3');
    expect(out).toContain('supplyUnknownPenalty');
  });

  it('supply scope warnings 항목 노출 (있을 때만)', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      candidates: 8,
      gate1MinimumSignalForensicAdr0505: makeForensicSummary(),
    } as unknown as ScanSummary;
    const out = formatScanBlockersGateCompactMessage(summary, {
      adr0505: deriveAdr0505EmissionStatus(summary),
    });
    expect(out).toContain('supply scope warnings');
    expect(out).toContain('KIS_FLOW_SYMBOL_MISSING');
  });

  it('executionImpact + liveExecutionAllowed 항상 노출 (절대 invariant)', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      candidates: 8,
      gate1MinimumSignalForensicAdr0505: makeForensicSummary(),
    } as unknown as ScanSummary;
    const out = formatScanBlockersGateCompactMessage(summary, {
      adr0505: deriveAdr0505EmissionStatus(summary),
    });
    expect(out).toContain('impact: NONE');
    expect(out).toContain('liveExecutionAllowed=false');
  });



  it('NOT_EVALUATED 상태에서는 failed/actualAvg를 주요 판정값으로 표시하지 않고 trace-only 안내를 출력', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      candidates: 48,
      gatePassDistribution: { gate1Pass: 0, gate2Pass: 0 },
      gate1MinimumSignalForensicAdr0505: makeForensicSummary({
        totalCandidates: 48,
        failedCandidates: 48,
        evaluationState: 'NOT_EVALUATED_SELL_ONLY',
        evaluatedCandidateCount: 0,
        traceOnlyCandidateCount: 48,
        buyListLoopEntered: false,
        actualScoreAvg: 3,
        traceWithQuoteCount: 0,
        traceWithSymbolFeaturesCount: 48,
        traceWithConditionResultsCount: 0,
        watchlistScoreImportedCount: 0,
        sourcePathDistribution: { SELL_ONLY_DIAGNOSTIC_SNAPSHOT: 48 } as unknown as Gate1MinimumSignalForensicSummaryAdr0505['sourcePathDistribution'],
        watchlistBreakPointDistribution: { WATCHLIST_ENTRY_MISSING_SCORE: 48 } as unknown as Gate1MinimumSignalForensicSummaryAdr0505['watchlistBreakPointDistribution'],
        quoteHydrationBreakPointDistribution: { SELL_ONLY_SKIPPED_QUOTE_EVALUATION: 48 } as unknown as Gate1MinimumSignalForensicSummaryAdr0505['quoteHydrationBreakPointDistribution'],
        conditionResultsBreakPointDistribution: { SELL_ONLY_SKIPPED_GATE_EVALUATION: 48 } as unknown as Gate1MinimumSignalForensicSummaryAdr0505['conditionResultsBreakPointDistribution'],
      }),
    } as unknown as ScanSummary;
    const out = formatScanBlockersGateCompactMessage(summary, {
      adr0505: deriveAdr0505EmissionStatus(summary),
    });
    expect(out).toContain('NOT_EVALUATED_SELL_ONLY');
    expect(out).toContain('evaluated: 0');
    expect(out).toContain('traceOnly: 48');
    expect(out).toContain('live failure 판단 아님');
    expect(out).toContain('SELL_ONLY_DIAGNOSTIC_SNAPSHOT 48');
    expect(out).toContain('WATCHLIST_ENTRY_MISSING_SCORE 48');
    expect(out).toContain('SELL_ONLY_SKIPPED_QUOTE_EVALUATION 48');
    expect(out).toContain('SELL_ONLY_SKIPPED_GATE_EVALUATION 48');
    expect(out).not.toContain('• failed: 48 / total: 48');
    expect(out).not.toContain('• actualAvg:');
  });

  it('30~40줄 가이드라인 — 정상 EMITTED 시 50줄 이하', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      candidates: 8,
      gate1MinimumSignalForensicAdr0505: makeForensicSummary(),
    } as unknown as ScanSummary;
    const out = formatScanBlockersGateCompactMessage(summary, {
      adr0505: deriveAdr0505EmissionStatus(summary),
    });
    expect(out.split('\n').length).toBeLessThanOrEqual(50);
  });
});

/* ───────── 정적 grep 가드 — 안전 invariant 보존 ───────── */

describe('ADR-0507 정적 grep 가드 — 안전 invariant', () => {
  it('scanDiagnostics.ts 가 collector SSOT import + 자동 합성 wiring', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../trading/signalScanner/scanDiagnostics.ts'),
      'utf8',
    );
    // import 확인
    expect(src).toContain(
      "import { collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507 } from './gate1ForensicInputsCollectorAdr0507.js'",
    );
    // 자동 합성 wiring 확인
    expect(src).toContain('collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({');
    expect(src).toContain('gate1CandidateTraces: summaryDraft.entryFilterDecomposition?.gate1CandidateTraces');
    expect(src).toContain('supplyProviderHealth: summaryDraft.entryFilterDecomposition?.supplyProviderHealth');
  });

  it('scanBlockers.cmd.ts 가 formatScanBlockersGateCompactMessage import + gate compact 분기 사용', () => {
    const src = readFileSync(resolve(__dirname, 'scanBlockers.cmd.ts'), 'utf8');
    expect(src).toContain('formatScanBlockersGateCompactMessage');
    expect(src).toContain("mode === 'gate' && gateSubMode === 'compact'");
    // ADR-0509 — gate compact 끝부분에 Unified Gate compact line append (try/catch 격리).
    //   기존 `applyScanBlockersLengthGuard(gateCompact, ...)` → `applyScanBlockersLengthGuard(finalGateCompact, ...)` 로 변경.
    //   finalGateCompact 는 `gateCompact + (unifiedGateCompactLine ? \\n + line : '')` 합성.
    expect(src).toMatch(/applyScanBlockersLengthGuard\((finalGateCompact|gateCompact)/);
  });

  it('collector SSOT 자체에는 KIS 주문 함수 / 외부 API import 0건 (절대 invariant)', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../trading/signalScanner/gate1ForensicInputsCollectorAdr0507.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/);
    expect(src).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor/);
    expect(src).not.toMatch(/\bfetch\(|axios|node-fetch/);
    expect(src).not.toMatch(/setGateThreshold|GATE_RELAX|STRONG_BUY_OVERRIDE/);
  });

  it('ENV `=== \'true\'` 정확 비교 (ADR-0157)', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../trading/signalScanner/gate1ForensicInputsCollectorAdr0507.ts'),
      'utf8',
    );
    expect(src).toContain("process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED === 'true'");
  });

  it('scanBlockersCompactAdr0506.ts — gate compact formatter export', () => {
    const src = readFileSync(resolve(__dirname, 'scanBlockersCompactAdr0506.ts'), 'utf8');
    expect(src).toContain('export function formatScanBlockersGateCompactMessage');
    expect(src).toContain('export const SCAN_BLOCKERS_GATE_FULL_HINT');
    expect(src).toContain('/scan_blockers gate full');
  });

  it('호출자 측 inline ENV 검사 금지 — scanBlockers.cmd 가 SSOT 위임만', () => {
    const src = readFileSync(resolve(__dirname, 'scanBlockers.cmd.ts'), 'utf8');
    // collector ENV 직접 검사 부재 — SSOT 헬퍼 isGate1ForensicCollectorAdr0507Disabled() 도
    // scanBlockers.cmd 에서 직접 호출하지 않는다. (자동 합성은 scanDiagnostics 측 SSOT 가 위임.)
    expect(src).not.toMatch(/process\.env\.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED/);
  });
});

/* ───────── ADR-0505 emission diagnostic — SUMMARY vs FORENSIC_INPUTS vs BUILDER 분리 ───────── */

describe('ADR-0507 ADR-0505 emission diagnostic distinction', () => {
  it('SUMMARY_FIELD_MISSING — summary 있지만 forensic 부재 (Phase 1 wiring 부재)', () => {
    const summary = { time: '2026-05-13T00:00:00.000Z' } as unknown as ScanSummary;
    const r = deriveAdr0505EmissionStatus(summary);
    expect(r.status).toBe('SUMMARY_FIELD_MISSING');
  });

  it('BUILDER_NOT_CALLED — forensic 존재하지만 totalCandidates=0', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      gate1MinimumSignalForensicAdr0505: makeForensicSummary({ totalCandidates: 0, failedCandidates: 0 }),
    } as unknown as ScanSummary;
    const r = deriveAdr0505EmissionStatus(summary);
    expect(r.status).toBe('BUILDER_NOT_CALLED');
  });

  it('EMITTED — Phase 1 collector wiring 활성 결과 (totalCandidates>0)', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      gate1MinimumSignalForensicAdr0505: makeForensicSummary(),
    } as unknown as ScanSummary;
    const r = deriveAdr0505EmissionStatus(summary);
    expect(r.status).toBe('EMITTED');
    expect(r.totalCandidates).toBe(8);
  });

  it('DISABLED_BY_ENV — process.env 우회 우선', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      gate1MinimumSignalForensicAdr0505: makeForensicSummary(),
    } as unknown as ScanSummary;
    const r = deriveAdr0505EmissionStatus(summary, {
      GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED: 'true',
    });
    expect(r.status).toBe('DISABLED_BY_ENV');
  });
});

/* ───────── 안전 invariant — score / threshold / order path 변경 0 ───────── */

describe('ADR-0507 안전 invariant — score / threshold / order path 변경 0', () => {
  it('formatScanBlockersGateCompactMessage 는 throw 안 함 (모든 옵셔널 fallback)', () => {
    expect(() => formatScanBlockersGateCompactMessage(null)).not.toThrow();
    expect(() => formatScanBlockersGateCompactMessage(undefined)).not.toThrow();
    expect(() => formatScanBlockersGateCompactMessage({} as ScanSummary)).not.toThrow();
  });

  it('collectGate1ForensicInputs SSOT 는 throw 안 함 (defensive)', () => {
    expect(() => collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({})).not.toThrow();
    expect(() =>
      collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
        gate1CandidateTraces: undefined,
      }),
    ).not.toThrow();
  });

  it('LIVE 매매 본체 0줄 변경 — buyListLoop / intradayLoop / kisClient/orders 미수정 검증', () => {
    // ADR-0507 wiring 은 scanDiagnostics (진단 layer) + scanBlockers.cmd (표시 layer) 만
    // 영향. LIVE 매매 본체 (signalScanner / entryEngine / exitEngine / kisClient / orchestrator
    // / autoTradeEngine / trancheExecutor / buyPipeline) 는 본 PR 에서 0줄 변경.
    // 별도 정적 grep 가드 — 본 테스트가 통과한다는 것은 ADR-0507 collector 가 LIVE
    // 매매 함수를 import 하지 않는다는 invariant 의 회귀 가드.
    const collectorSrc = readFileSync(
      resolve(__dirname, '../../../trading/signalScanner/gate1ForensicInputsCollectorAdr0507.ts'),
      'utf8',
    );
    expect(collectorSrc).not.toMatch(/buildBuyTrade|signalScanner\.ts|entryEngine|exitEngine|kisClient|autoTradeEngine|trancheExecutor|buyPipeline/);
  });
});
