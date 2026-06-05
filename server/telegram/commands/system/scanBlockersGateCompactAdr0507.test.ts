/**
 * @responsibility ADR-0507 ??Gate1 Forensic Collector Wiring + Gate Mode Compact Split ?뚭?.
 *
 * ?ъ슜??紐낆떆 짠L ?뚭? 留ㅽ듃由?뒪 吏곸젒 諛섏쁺:
 *   - parseScanBlockersMode 媛 `gate` ?⑤룆 ??gateSubMode='compact', `gate full`
 *     ??gateSubMode='full' ?뺥솗 ?몄떇.
 *   - formatScanBlockersGateCompactMessage 媛 forensic 遺??/ EMITTED ?묒そ 遺꾧린.
 *   - collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507 SSOT 媛
 *     gate1CandidateTraces 遺??/ minSignalScoreTrace 遺??/ ?뺤긽 ?낅젰 ?뺥솗 泥섎━.
 *   - persistScanResults ?먮룞 ?⑹꽦 ??FORENSIC_INPUTS_MISSING ??EMITTED ?꾪솚 寃利?
 *   - ?뺤쟻 grep 媛?? scanDiagnostics import + scanBlockers.cmd wiring + scope 蹂댁〈.
 *   - ?덉쟾 invariant: requiredScore / threshold / order path / Gate ?먯젙 蹂寃?0.
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

/* ????????? parseScanBlockersMode ??ADR-0507 gate sub-mode ????????? */

describe('ADR-0507 parseScanBlockersMode ??gate sub-mode', () => {
  it('`gate` ?⑤룆 ??gateSubMode=compact (default)', () => {
    const r = parseScanBlockersMode(['gate']);
    expect(r.mode).toBe('gate');
    expect(r.gateSubMode).toBe('compact');
    expect(r.isUnknown).toBe(false);
  });

  it('`gate full` ??gateSubMode=full', () => {
    const r = parseScanBlockersMode(['gate', 'full']);
    expect(r.mode).toBe('gate');
    expect(r.gateSubMode).toBe('full');
  });

  it('`gate FULL` ??뚮Ц??臾닿?', () => {
    const r = parseScanBlockersMode(['gate', 'FULL']);
    expect(r.gateSubMode).toBe('full');
  });

  it('`gate compact` (紐낆떆) ??gateSubMode=compact', () => {
    const r = parseScanBlockersMode(['gate', 'compact']);
    expect(r.gateSubMode).toBe('compact');
  });

  it('`gate xyz` (unknown sub) ??gateSubMode=compact fallback (silent)', () => {
    const r = parseScanBlockersMode(['gate', 'xyz']);
    expect(r.gateSubMode).toBe('compact');
    expect(r.isUnknown).toBe(false); // mode ?먯껜??gate 濡??좏슚
  });

  it('string ?낅젰 `gate full` ???몄떇', () => {
    const r = parseScanBlockersMode('gate full');
    expect(r.mode).toBe('gate');
    expect(r.gateSubMode).toBe('full');
  });

  it('gate ??mode ?먯꽑 gateSubMode ??긽 undefined', () => {
    expect(parseScanBlockersMode(['full']).gateSubMode).toBeUndefined();
    expect(parseScanBlockersMode(['supply']).gateSubMode).toBeUndefined();
    expect(parseScanBlockersMode(['sector']).gateSubMode).toBeUndefined();
    expect(parseScanBlockersMode(['runtime']).gateSubMode).toBeUndefined();
    expect(parseScanBlockersMode([]).gateSubMode).toBeUndefined();
  });

  it('SCAN_BLOCKERS_USAGE_HINT 媛 `gate full` ?듭뀡 ?덈궡 ?ы븿', () => {
    expect(SCAN_BLOCKERS_USAGE_HINT).toContain('gate full');
  });
});

/* ????????? isGate1ForensicCollectorAdr0507Disabled ??ENV gate ????????? */

describe('ADR-0507 isGate1ForensicCollectorAdr0507Disabled ??ENV gate', () => {
  beforeEach(() => {
    delete process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED;
  });

  it('default OFF ??false 諛섑솚', () => {
    expect(isGate1ForensicCollectorAdr0507Disabled()).toBe(false);
  });

  it('=true ?뺥솗 鍮꾧탳 (ADR-0157)', () => {
    process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED = 'true';
    expect(isGate1ForensicCollectorAdr0507Disabled()).toBe(true);
    delete process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED;
  });

  it("'1' / 'TRUE' / 'yes' 嫄곕? (ADR-0157)", () => {
    for (const v of ['1', 'TRUE', 'yes', 'enabled']) {
      process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED = v;
      expect(isGate1ForensicCollectorAdr0507Disabled()).toBe(false);
    }
    delete process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED;
  });
});

/* ????????? collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507 ????????? */

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

  it('ENV disabled ??鍮?諛곗뿴', () => {
    process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED = 'true';
    const r = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      gate1CandidateTraces: [makeGate1CandidateTrace('005930', 70)],
    });
    expect(r).toEqual([]);
    delete process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED;
  });

  it('鍮?traces ??鍮?諛곗뿴', () => {
    expect(collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({}).length).toBe(0);
    expect(
      collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({ gate1CandidateTraces: [] }).length,
    ).toBe(0);
  });

  it('?뺤긽 ?낅젰 ??trace 紐⑤몢 propagate + quoteSymbol = candidate.symbol', () => {
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

  it('minSignalScoreTrace 遺??trace ??silent skip', () => {
    const r = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      gate1CandidateTraces: [
        { symbol: '005930', minSignalScoreTrace: undefined } as unknown as Gate1CandidateTrace,
        makeGate1CandidateTrace('000660', 55),
      ],
    });
    expect(r.length).toBe(1);
    expect(r[0]!.quoteSymbol).toBe('000660');
  });

  it('supplyProviderHealth 공통 share — 모든 entry 가 입력 health 필드 보존 (enriched)', () => {
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
    // Patch-VITEST-CAT-A: collector 는 per-symbol 으로 입력 health 를 derived forensic 필드로
    // enrich 한 healthRecord(신규 객체)를 전달한다 — 입력 참조(.toBe(sph)) 동일성이 아니다.
    // (seed 4452bd3 부터 production 이 enrich 했고 본 DOA 테스트만 pre-refactor 참조 동일성을
    // 기대했다.) 공통 share 의도는 모든 entry 가 입력 health 필드를 보존함으로 검증한다
    // (production 런타임 0 변경).
    expect(r[0]!.supplyProviderHealth).toMatchObject({ status: 'VERIFIED', providerName: 'KRX' });
    expect(r[1]!.supplyProviderHealth).toMatchObject({ status: 'VERIFIED', providerName: 'KRX' });
  });



  it('copies router selected candidate actualInvestorFlowRows into kisFlow forensic input', () => {
    const sph = {
      status: 'VERIFIED',
      providerName: 'KIS_API',
      selectedInvestorFlowProvider: 'KIS_API',
      gate1Severity: 'NONE',
      reason: [],
      providerIssue: false,
      marketSignal: false,
      actualInvestorFlowRows: [{ frgn_ntby_qty: '10', orgn_ntby_qty: '20' }],
      actualInvestorFlowRowCount: 1,
      actualInvestorFlowRowSourcePath: 'input.actualInvestorFlowRowCarrier.actualRows',
      actualInvestorFlowFieldKeys: ['frgn_ntby_qty', 'orgn_ntby_qty'],
      actualInvestorFlowNumericKeys: ['frgn_ntby_qty', 'orgn_ntby_qty'],
      actualInvestorFlowCarried: true,
    } as unknown as SupplyProviderHealthTrace;
    const r = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      gate1CandidateTraces: [makeGate1CandidateTrace('005930', 70)],
      supplyProviderHealth: sph,
    });

    expect(r[0]!.kisFlow?.actualInvestorFlowRows).toHaveLength(1);
    expect(r[0]!.kisFlow?.sanitizedInvestorFlowRows).toHaveLength(1);
    expect(r[0]!.kisFlow?.forensicInputCarriesActualInvestorRows).toBe(true);
    expect(r[0]!.kisFlow?.selectedActualRowPath).toBe('input.actualInvestorFlowRowCarrier.actualRows');
    expect(r[0]!.kisFlow?.selectedActualRowFieldKeys).toContain('frgn_ntby_qty');
  });

  it('prefers selectedCandidate.actualInvestorFlowRows when router top-level rows are absent', () => {
    const sph = {
      status: 'VERIFIED',
      providerName: 'KIS_API',
      selectedInvestorFlowProvider: 'KIS_API',
      gate1Severity: 'NONE',
      reason: [],
      providerIssue: false,
      marketSignal: false,
      selectedCandidate: {
        actualInvestorFlowRows: [{ frgn_ntby_qty: '100', orgn_ntby_qty: '200' }],
        actualInvestorFlowRowCount: 1,
        actualInvestorFlowRowSourcePath: 'input.selectedCandidate.actualInvestorFlowRows',
        actualInvestorFlowFieldKeys: ['frgn_ntby_qty', 'orgn_ntby_qty'],
        actualInvestorFlowNumericStringKeys: ['frgn_ntby_qty', 'orgn_ntby_qty'],
        actualInvestorFlowCarried: true,
      },
    } as unknown as SupplyProviderHealthTrace;
    const r = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      gate1CandidateTraces: [makeGate1CandidateTrace('005930', 70)],
      supplyProviderHealth: sph,
    });

    expect(r[0]!.actualInvestorFlowRows).toHaveLength(1);
    expect(r[0]!.actualInvestorFlowRowCount).toBe(1);
    expect(r[0]!.actualInvestorFlowRowSourcePath).toBe('input.selectedCandidate.actualInvestorFlowRows');
    expect(r[0]!.actualInvestorFlowNumericStringKeys).toContain('orgn_ntby_qty');
    expect(r[0]!.selectedCandidate?.actualInvestorFlowRows).toHaveLength(1);
    expect(r[0]!.kisFlow?.actualInvestorFlowRows).toHaveLength(1);
    expect(r[0]!.kisFlow?.actualInvestorFlowRowCount).toBe(1);
    expect(r[0]!.kisFlow?.actualInvestorFlowRowSourcePath).toBe('input.selectedCandidate.actualInvestorFlowRows');
    expect(r[0]!.kisFlow?.actualInvestorFlowNumericStringKeys).toContain('orgn_ntby_qty');
    expect(r[0]!.kisFlow?.forensicInputCarriesActualInvestorRows).toBe(true);
  });



  it('carries singular actual/semantic investor rows from router selectedCandidate into forensic input', () => {
    const semanticInvestorRow = {
      symbol: '005930',
      provider: 'KIS_API',
      providerScope: 'SYMBOL_LEVEL',
      materialized: true,
      foreignNetBuy: -19034,
      institutionalNetBuy: 2500,
      individualNetBuy: 16534,
      netBuyAmount: null,
      netBuyVolume: null,
      sourceFields: { foreign: 'frgn_ntby_tr_pbmn', institutional: 'orgn_ntby_tr_pbmn', individual: 'indv_ntby_tr_pbmn' },
      rawFieldKeys: ['frgn_ntby_tr_pbmn', 'orgn_ntby_tr_pbmn', 'indv_ntby_tr_pbmn'],
      normalizedFieldKeys: ['foreignNetBuy', 'institutionalNetBuy', 'individualNetBuy'],
      rowCount: 1,
      investorTypesDetected: [],
    };
    const sph = {
      status: 'VERIFIED',
      providerName: 'KIS_API',
      selectedInvestorFlowProvider: 'KIS_API',
      gate1Severity: 'NONE',
      reason: [],
      providerIssue: false,
      marketSignal: false,
      actualInvestorRow: { frgn_ntby_tr_pbmn: '-19,034', orgn_ntby_tr_pbmn: '2,500', indv_ntby_tr_pbmn: '16,534' },
      normalizedInvestorRow: { foreignNetBuy: -19034, institutionNetBuy: 2500, individualNetBuy: 16534 },
      semanticInvestorRow,
      supplySemanticRow: semanticInvestorRow,
      selectedCandidate: {
        actualInvestorRow: { frgn_ntby_tr_pbmn: '-19,034', orgn_ntby_tr_pbmn: '2,500', indv_ntby_tr_pbmn: '16,534' },
        normalizedInvestorRow: { foreignNetBuy: -19034, institutionNetBuy: 2500, individualNetBuy: 16534 },
        semanticInvestorRow,
        supplySemanticRow: semanticInvestorRow,
      },
    } as unknown as SupplyProviderHealthTrace;
    const r = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      gate1CandidateTraces: [makeGate1CandidateTrace('005930', 70)],
      supplyProviderHealth: sph,
    });

    expect(r[0]!.actualInvestorRow).toMatchObject({ frgn_ntby_tr_pbmn: '-19,034' });
    expect(r[0]!.normalizedInvestorRow).toMatchObject({ foreignNetBuy: -19034 });
    expect(r[0]!.semanticInvestorRow).toMatchObject({ foreignNetBuy: -19034 });
    expect(r[0]!.supplySemanticRow).toMatchObject({ individualNetBuy: 16534 });
    expect(r[0]!.kisFlow?.actualInvestorRow).toMatchObject({ orgn_ntby_tr_pbmn: '2,500' });
    expect(r[0]!.kisFlow?.semanticInvestorRow).toMatchObject({ institutionalNetBuy: 2500 });
    expect(r[0]!.kisFlow?.forensicInputCarriesSemanticRow).toBe(true);
    expect(r[0]!.kisFlow?.forensicInputCarriesActualInvestorRows).toBe(true);
  });


  it('synthesizes a diagnostic-only supplyProviderHealth (no provider status) when none is provided', () => {
    const r = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      gate1CandidateTraces: [makeGate1CandidateTrace('005930', 70)],
    });
    expect(r.length).toBe(1);
    // Patch-VITEST-CAT-A: collector(mergeActualRowCarryAdr0507)는 입력 health 부재 시에도
    // 진단 전용 health record 를 합성한다 — 더 이상 undefined 가 아니다(seed 4452bd3 부터
    // production 이 합성했고 본 DOA 테스트만 pre-enrichment 의 undefined 를 기대했다).
    // 합성 record 는 실제 provider status/이름을 싣지 않음(diagnostic-only)을 검증한다
    // (production 런타임 0 변경).
    const health = (r[0] as { supplyProviderHealth?: Record<string, unknown> }).supplyProviderHealth;
    expect(health).toBeDefined();
    expect(health?.status).toBeUndefined();
    expect(health?.providerName).toBeUndefined();
  });
});

/* ????????? formatScanBlockersGateCompactMessage ????????? */

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
  it('forensic 遺????NOT_EMITTED ?덈궡 + gate full hint', () => {
    const out = formatScanBlockersGateCompactMessage(null);
    expect(out).toContain('ADR-0505 NOT_EMITTED');
    expect(out).toContain(SCAN_BLOCKERS_GATE_FULL_HINT);
  });

  it('forensic totalCandidates=0 ??NOT_EMITTED ?덈궡', () => {
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

  it('EMITTED ??requiredAvg / actualAvg / gap 紐⑤몢 異쒕젰', () => {
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

  it('dominant failure Top 3 ?몄텧 (count>0 留?', () => {
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
    // count=0 ??ぉ? 誘몃끂異?
    expect(out).not.toContain('SCORE_CEILING_BELOW_THRESHOLD: 0');
    expect(out).not.toContain('MIXED: 0');
  });

  it('missing positive Top 3 + penalty Top 3 ?몄텧', () => {
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

  it('supply scope warnings ??ぉ ?몄텧 (?덉쓣 ?뚮쭔)', () => {
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

  it('executionImpact + liveExecutionAllowed ??긽 ?몄텧 (?덈? invariant)', () => {
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



  it('NOT_EVALUATED ?곹깭?먯꽌??failed/actualAvg瑜?二쇱슂 ?먯젙媛믪쑝濡??쒖떆?섏? ?딄퀬 trace-only ?덈궡瑜?異쒕젰', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      candidates: 48,
      gatePassDistribution: { gate1Pass: 0, gate2Pass: 0 },
      gate1MinimumSignalForensicAdr0505: makeForensicSummary({
        totalCandidates: 48,
        failedCandidates: 48,
        evaluationState: 'EVALUATED',
        evaluatedCandidateCount: 48,
        traceOnlyCandidateCount: 0,
        buyListLoopEntered: true,
        actualScoreAvg: 3,
        traceWithQuoteCount: 0,
        traceWithSymbolFeaturesCount: 48,
        traceWithConditionResultsCount: 0,
        watchlistScoreImportedCount: 0,
        sourcePathDistribution: {} as unknown as Gate1MinimumSignalForensicSummaryAdr0505['sourcePathDistribution'],
        watchlistBreakPointDistribution: { WATCHLIST_ENTRY_MISSING_SCORE: 48 } as unknown as Gate1MinimumSignalForensicSummaryAdr0505['watchlistBreakPointDistribution'],
        quoteHydrationBreakPointDistribution: {} as unknown as Gate1MinimumSignalForensicSummaryAdr0505['quoteHydrationBreakPointDistribution'],
        conditionResultsBreakPointDistribution: {} as unknown as Gate1MinimumSignalForensicSummaryAdr0505['conditionResultsBreakPointDistribution'],
      }),
    } as unknown as ScanSummary;
    const out = formatScanBlockersGateCompactMessage(summary, {
      adr0505: deriveAdr0505EmissionStatus(summary),
    });
    expect(out).toContain('EVALUATED');
    expect(out).not.toContain('NOT_EVALUATED_SELL_ONLY');
    expect(out).not.toContain('SELL_ONLY_DIAGNOSTIC_SNAPSHOT');
    expect(out).toContain('WATCHLIST_ENTRY_MISSING_SCORE 48');
    expect(out).not.toContain('SELL_ONLY_SKIPPED_QUOTE_EVALUATION');
    expect(out).not.toContain('SELL_ONLY_SKIPPED_GATE_EVALUATION');
  });

  it('30~40以?媛?대뱶?쇱씤 ???뺤긽 EMITTED ??50以??댄븯', () => {
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

/* ????????? ?뺤쟻 grep 媛?????덉쟾 invariant 蹂댁〈 ????????? */

describe('ADR-0507 ?뺤쟻 grep 媛?????덉쟾 invariant', () => {
  it('scanDiagnostics.ts 媛 collector SSOT import + ?먮룞 ?⑹꽦 wiring', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../trading/signalScanner/scanDiagnostics.ts'),
      'utf8',
    );
    // import ?뺤씤
    expect(src).toContain(
      "import { collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507 } from './gate1ForensicInputsCollectorAdr0507.js'",
    );
    // ?먮룞 ?⑹꽦 wiring ?뺤씤
    expect(src).toContain('collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({');
    expect(src).toContain('gate1CandidateTraces: summaryDraft.entryFilterDecomposition?.gate1CandidateTraces');
    expect(src).toContain('supplyProviderHealth: summaryDraft.entryFilterDecomposition?.supplyProviderHealth');
  });

  it('scanBlockers.cmd.ts 媛 formatScanBlockersGateCompactMessage import + gate compact 遺꾧린 ?ъ슜', () => {
    const src = readFileSync(resolve(__dirname, 'scanBlockers.cmd.ts'), 'utf8');
    expect(src).toContain('formatScanBlockersGateCompactMessage');
    expect(src).toContain("mode === 'gate' && gateSubMode === 'compact'");
    // ADR-0509 ??gate compact ?앸?遺꾩뿉 Unified Gate compact line append (try/catch 寃⑸━).
    //   湲곗〈 `applyScanBlockersLengthGuard(gateCompact, ...)` ??`applyScanBlockersLengthGuard(finalGateCompact, ...)` 濡?蹂寃?
    //   finalGateCompact ??`gateCompact + (unifiedGateCompactLine ? \\n + line : '')` ?⑹꽦.
    expect(src).toMatch(/applyScanBlockersLengthGuard\((finalGateCompact|gateCompact)/);
  });

  it('collector SSOT ?먯껜?먮뒗 KIS 二쇰Ц ?⑥닔 / ?몃? API import 0嫄?(?덈? invariant)', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../trading/signalScanner/gate1ForensicInputsCollectorAdr0507.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/);
    expect(src).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor/);
    expect(src).not.toMatch(/\bfetch\(|axios|node-fetch/);
    expect(src).not.toMatch(/setGateThreshold|GATE_RELAX|STRONG_BUY_OVERRIDE/);
  });

  it('ENV `=== \'true\'` ?뺥솗 鍮꾧탳 (ADR-0157)', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../trading/signalScanner/gate1ForensicInputsCollectorAdr0507.ts'),
      'utf8',
    );
    expect(src).toContain("process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED === 'true'");
  });

  it('scanBlockersCompactAdr0506.ts ??gate compact formatter export', () => {
    const src = readFileSync(resolve(__dirname, 'scanBlockersCompactAdr0506.ts'), 'utf8');
    expect(src).toContain('export function formatScanBlockersGateCompactMessage');
    expect(src).toContain('export const SCAN_BLOCKERS_GATE_FULL_HINT');
    expect(src).toContain('/scan_blockers gate full');
  });

  it('keeps inline collector ENV checks out of scanBlockers.cmd', () => {
    const src = readFileSync(resolve(__dirname, 'scanBlockers.cmd.ts'), 'utf8');
    // collector ENV 吏곸젒 寃??遺????SSOT ?ы띁 isGate1ForensicCollectorAdr0507Disabled() ??
    // scanBlockers.cmd ?먯꽌 吏곸젒 ?몄텧?섏? ?딅뒗?? (?먮룞 ?⑹꽦? scanDiagnostics 痢?SSOT 媛 ?꾩엫.)
    expect(src).not.toMatch(/process\.env\.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED/);
  });
});

/* ????????? ADR-0505 emission diagnostic ??SUMMARY vs FORENSIC_INPUTS vs BUILDER 遺꾨━ ????????? */

describe('ADR-0507 ADR-0505 emission diagnostic distinction', () => {
  it('SUMMARY_FIELD_MISSING ??summary ?덉?留?forensic 遺??(Phase 1 wiring 遺??', () => {
    const summary = { time: '2026-05-13T00:00:00.000Z' } as unknown as ScanSummary;
    const r = deriveAdr0505EmissionStatus(summary);
    expect(r.status).toBe('SUMMARY_FIELD_MISSING');
  });

  it('BUILDER_NOT_CALLED ??forensic 議댁옱?섏?留?totalCandidates=0', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      gate1MinimumSignalForensicAdr0505: makeForensicSummary({ totalCandidates: 0, failedCandidates: 0 }),
    } as unknown as ScanSummary;
    const r = deriveAdr0505EmissionStatus(summary);
    expect(r.status).toBe('BUILDER_NOT_CALLED');
  });

  it('EMITTED ??Phase 1 collector wiring ?쒖꽦 寃곌낵 (totalCandidates>0)', () => {
    const summary = {
      time: '2026-05-13T00:00:00.000Z',
      gate1MinimumSignalForensicAdr0505: makeForensicSummary(),
    } as unknown as ScanSummary;
    const r = deriveAdr0505EmissionStatus(summary);
    expect(r.status).toBe('EMITTED');
    expect(r.totalCandidates).toBe(8);
  });

  it('DISABLED_BY_ENV ??process.env ?고쉶 ?곗꽑', () => {
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

/* ????????? ?덉쟾 invariant ??score / threshold / order path 蹂寃?0 ????????? */

describe('ADR-0507 ?덉쟾 invariant ??score / threshold / order path 蹂寃?0', () => {
  it('formatScanBlockersGateCompactMessage ??throw ????(紐⑤뱺 ?듭뀛??fallback)', () => {
    expect(() => formatScanBlockersGateCompactMessage(null)).not.toThrow();
    expect(() => formatScanBlockersGateCompactMessage(undefined)).not.toThrow();
    expect(() => formatScanBlockersGateCompactMessage({} as ScanSummary)).not.toThrow();
  });

  it('collectGate1ForensicInputs SSOT ??throw ????(defensive)', () => {
    expect(() => collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({})).not.toThrow();
    expect(() =>
      collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
        gate1CandidateTraces: undefined,
      }),
    ).not.toThrow();
  });

  it('keeps live trading implementation files untouched', () => {
    // ADR-0507 wiring ? scanDiagnostics (吏꾨떒 layer) + scanBlockers.cmd (?쒖떆 layer) 留?
    // ?곹뼢. LIVE 留ㅻℓ 蹂몄껜 (signalScanner / entryEngine / exitEngine / kisClient / orchestrator
    // / autoTradeEngine / trancheExecutor / buyPipeline) ??蹂?PR ?먯꽌 0以?蹂寃?
    // 蹂꾨룄 ?뺤쟻 grep 媛????蹂??뚯뒪?멸? ?듦낵?쒕떎??寃껋? ADR-0507 collector 媛 LIVE
    // 留ㅻℓ ?⑥닔瑜?import ?섏? ?딅뒗?ㅻ뒗 invariant ???뚭? 媛??
    const collectorSrc = readFileSync(
      resolve(__dirname, '../../../trading/signalScanner/gate1ForensicInputsCollectorAdr0507.ts'),
      'utf8',
    );
    expect(collectorSrc).not.toMatch(/buildBuyTrade|signalScanner\.ts|entryEngine|exitEngine|kisClient|autoTradeEngine|trancheExecutor|buyPipeline/);
  });
});
