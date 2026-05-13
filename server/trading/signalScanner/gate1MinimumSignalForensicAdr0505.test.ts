/**
 * @responsibility ADR-0505 Gate1 Minimum Signal Forensic Audit 회귀 테스트.
 *
 * 사용자 명시 10 mandatory cases + 핵심 불변식 정적 가드 (executionImpact NONE /
 * liveExecutionAllowed false / SHADOW_ONLY literal type / KIS 주문 import 0).
 */
import { describe, it, expect } from 'vitest';
import {
  buildGate1MinimumSignalForensicAuditAdr0505,
  buildGate1MinimumSignalForensicSummaryAdr0505,
  formatGate1MinimumSignalForensicSection,
  resolveGate1ForensicNextAction,
  isGate1MinimumSignalForensicAuditDisabled,
  type Gate1MinimumSignalForensicAuditAdr0505,
  type Gate1MinimumSignalForensicSummaryAdr0505,
} from './gate1MinimumSignalForensicAuditAdr0505.js';
import type {
  MinimumSignalScoreTrace,
  SignalScoreComponentTrace,
  SignalScoreComponentCode,
} from './minimumSignalScoreTrace.js';
import { projectGateOutputsToConditionResultsTrace, conditionResultsTraceToMap } from './gateConditionResultTrace.js';
import { extractInvestorFlowSemanticFields, evaluateInvestorFlowSemanticAvailabilityV2 } from '../../supply/investorFlowSemanticAvailability.js';

function makeComponent(
  code: SignalScoreComponentCode,
  overrides: Partial<SignalScoreComponentTrace> = {},
): SignalScoreComponentTrace {
  return {
    code,
    rawValue: undefined,
    normalizedScore: 0,
    weight: 1,
    weightedScore: 0,
    maxScore: 10,
    contributionPct: 0,
    confidence: 'VERIFIED',
    providerIssue: false,
    marketSignal: false,
    penaltyApplied: false,
    message: '',
    ...overrides,
  };
}

function makeTrace(overrides: Partial<MinimumSignalScoreTrace> = {}): MinimumSignalScoreTrace {
  return {
    symbol: '005930',
    name: '삼성전자',
    requiredScore: 70,
    actualScore: 22,
    scoreGap: -48,
    passed: false,
    components: [],
    positiveScoreTotal: 22,
    penaltyTotal: 0,
    unknownPenaltyTotal: 0,
    providerIssuePenaltyTotal: 0,
    sessionPenaltyTotal: 0,
    sectorPenaltyTotal: 0,
    riskPenaltyTotal: 0,
    softFailPenaltyTotal: 0,
    topMissingContributors: [],
    topPenaltyContributors: [],
    wouldPassIfUnknownNeutral: false,
    wouldPassIfProviderPenaltyRemoved: false,
    wouldPassIfSessionPenaltyRemoved: false,
    wouldPassIfRiskPenaltyCapped: false,
    wouldPassIfSectorPenaltyRemoved: false,
    wouldPassIfSoftFailPenaltyRemoved: false,
    ...overrides,
  };
}

describe('ADR-0505 — Gate1 Minimum Signal Forensic Audit', () => {
  describe('필수 case 1 — WATCHLIST_UPSTREAM_SCORE 가 0+MISSING 이면 missingPositiveSources 에 WATCHLIST_UPSTREAM_SCORE_MISSING', () => {
    it('단일 missing → WATCHLIST_SCORE_NOT_IMPORTED dominantFailureReason', () => {
      const trace = makeTrace({
        components: [
          makeComponent('WATCHLIST_UPSTREAM_SCORE', { weightedScore: 0, confidence: 'MISSING' }),
        ],
      });
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({ trace });
      expect(audit.missingPositiveSources).toContain('WATCHLIST_UPSTREAM_SCORE_MISSING');
      expect(audit.dominantFailureReason).toBe('WATCHLIST_SCORE_NOT_IMPORTED');
    });
  });

  describe('필수 case 2 — RELATIVE_STRENGTH 가 0+MISSING 이면 RELATIVE_STRENGTH_MISSING', () => {
    it('단일 missing → RELATIVE_STRENGTH_SOURCE_MISSING dominantFailureReason', () => {
      const trace = makeTrace({
        components: [
          makeComponent('RELATIVE_STRENGTH', { weightedScore: 0, confidence: 'UNKNOWN' }),
        ],
      });
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({ trace });
      expect(audit.missingPositiveSources).toContain('RELATIVE_STRENGTH_MISSING');
      expect(audit.dominantFailureReason).toBe('RELATIVE_STRENGTH_SOURCE_MISSING');
    });
  });

  describe('필수 case 3 — BREAKOUT_STRUCTURE 가 0+MISSING 이면 BREAKOUT_STRUCTURE_MISSING', () => {
    it('단일 missing → BREAKOUT_STRUCTURE_SOURCE_MISSING dominantFailureReason', () => {
      const trace = makeTrace({
        components: [
          makeComponent('BREAKOUT_STRUCTURE', { weightedScore: 0, confidence: 'MISSING' }),
        ],
      });
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({ trace });
      expect(audit.missingPositiveSources).toContain('BREAKOUT_STRUCTURE_MISSING');
      expect(audit.dominantFailureReason).toBe('BREAKOUT_STRUCTURE_SOURCE_MISSING');
    });
  });

  describe('필수 case 4 — 3개 동시 missing → POSITIVE_SCORE_STARVATION', () => {
    it('Watchlist + RS + Breakout 모두 missing → POSITIVE_SCORE_STARVATION', () => {
      const trace = makeTrace({
        components: [
          makeComponent('WATCHLIST_UPSTREAM_SCORE', { weightedScore: 0, confidence: 'MISSING' }),
          makeComponent('RELATIVE_STRENGTH', { weightedScore: 0, confidence: 'MISSING' }),
          makeComponent('BREAKOUT_STRUCTURE', { weightedScore: 0, confidence: 'MISSING' }),
        ],
      });
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({ trace });
      expect(audit.dominantFailureReason).toBe('POSITIVE_SCORE_STARVATION');
      expect(audit.missingPositiveSources).toHaveLength(3);
    });
  });

  describe('필수 case 5 — SUPPLY_CONFLUENCE 음수 penalty → supplyUnknownPenalty count++', () => {
    it('SUPPLY_CONFLUENCE weightedScore<0 → SUPPLY_PROVIDER_UNKNOWN_PENALTY + summary count', () => {
      const trace = makeTrace({
        components: [
          makeComponent('PRICE_MOMENTUM', { weightedScore: 5, confidence: 'VERIFIED' }),
          makeComponent('SUPPLY_CONFLUENCE', { weightedScore: -3, penaltyApplied: true, confidence: 'UNKNOWN' }),
        ],
      });
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({ trace });
      expect(audit.dominantFailureReason).toBe('SUPPLY_PROVIDER_UNKNOWN_PENALTY');
      expect(audit.penaltyComponents['SUPPLY_CONFLUENCE'].weightedScore).toBeLessThan(0);

      const summary = buildGate1MinimumSignalForensicSummaryAdr0505([audit]);
      expect(summary.penaltyCounts.supplyUnknownPenalty).toBe(1);
    });
  });

  describe('필수 case 6 — INVESTOR_FLOW unknown penalty → investorFlowUnknownPenalty count++', () => {
    it('INVESTOR_FLOW weightedScore<0 → INVESTOR_FLOW_UNKNOWN_PENALTY + summary count', () => {
      const trace = makeTrace({
        components: [
          makeComponent('PRICE_MOMENTUM', { weightedScore: 5, confidence: 'VERIFIED' }),
          makeComponent('INVESTOR_FLOW', { weightedScore: -2, penaltyApplied: true, confidence: 'UNKNOWN' }),
        ],
      });
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({ trace });
      expect(audit.dominantFailureReason).toBe('INVESTOR_FLOW_UNKNOWN_PENALTY');

      const summary = buildGate1MinimumSignalForensicSummaryAdr0505([audit]);
      expect(summary.penaltyCounts.investorFlowUnknownPenalty).toBe(1);
    });
  });

  describe('필수 case 7 — SectorEnergy diagnostic/BLOCKED → strongBuyBlockedCount++, hardBlockCount=0', () => {
    it('strongBuyAllowed=false → sectorEnergyStrongBuyBlockedCount=1, hardBlockCount=0 (사용자 명시 불변)', () => {
      const trace = makeTrace({ components: [makeComponent('PRICE_MOMENTUM', { weightedScore: 5 })] });
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({
        trace,
        sectorEnergyImpact: {
          diagnosticStatus: 'BLOCKED',
          scoringImpact: 'ZERO_SECTOR_BOOST',
          executionImpact: 'NO_EXECUTION_BLOCK',
          sectorBoostAllowed: false,
          strongBuyAllowed: false,
          hardBlockAllowed: false,
          reason: 'SectorEnergy diagnostic BLOCKED',
        },
      });
      expect(audit.sectorEnergyAudit.strongBuyAllowed).toBe(false);
      expect(audit.sectorEnergyAudit.directRawGateScoreImpact).toBe(0);

      const summary = buildGate1MinimumSignalForensicSummaryAdr0505([audit]);
      expect(summary.sectorEnergyStrongBuyBlockedCount).toBe(1);
      expect(summary.sectorEnergyHardBlockCount).toBe(0); // 핵심 불변식 — 사용자 명시
    });
  });

  describe('필수 case 8 — kisFlow.symbol ≠ quote.symbol → KIS_FLOW_SYMBOL_MISMATCH', () => {
    it('symbol mismatch 명시', () => {
      const trace = makeTrace({ symbol: '005930' });
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({
        trace,
        quoteSymbol: '005930',
        kisFlow: { symbol: '000660', foreignNetBuy: 1000, institutionalNetBuy: 500, semanticAvailable: true },
      });
      expect(audit.supplyScopeAudit.warning).toBe('KIS_FLOW_SYMBOL_MISMATCH');
      expect(audit.supplyScopeAudit.symbolMatched).toBe(false);
    });
  });

  describe('필수 case 9 — kisFlow.symbol 부재 → KIS_FLOW_SYMBOL_MISSING', () => {
    it('symbol 부재 warning', () => {
      const trace = makeTrace({ symbol: '005930' });
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({
        trace,
        kisFlow: { foreignNetBuy: 1000, institutionalNetBuy: 500, semanticAvailable: true },
      });
      expect(audit.supplyScopeAudit.warning).toBe('KIS_FLOW_SYMBOL_MISSING');
      expect(audit.supplyScopeAudit.kisFlowSymbol).toBeNull();
    });
  });

  describe('필수 case 10 — 모든 forensic 결과 executionImpact=NONE / liveExecutionAllowed=false / SHADOW_ONLY', () => {
    it('literal type 강제 (TypeScript 컴파일 타임 + 런타임 검증)', () => {
      const trace = makeTrace();
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({ trace });
      expect(audit.executionImpact).toBe('NONE');
      expect(audit.liveExecutionAllowed).toBe(false);
      expect(audit.policyPromotionMode).toBe('SHADOW_ONLY');

      const summary = buildGate1MinimumSignalForensicSummaryAdr0505([audit]);
      expect(summary.executionImpact).toBe('NONE');
      expect(summary.liveExecutionAllowed).toBe(false);
      expect(summary.policyPromotionMode).toBe('SHADOW_ONLY');
    });
  });

  describe('ENV gate (ADR-0157 정확 비교 의무)', () => {
    const original = process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED;
    afterEach(() => {
      if (original === undefined) delete process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED;
      else process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED = original;
    });

    it('default OFF', () => {
      delete process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED;
      expect(isGate1MinimumSignalForensicAuditDisabled()).toBe(false);
    });
    it("=== 'true' 만 활성", () => {
      process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED = 'true';
      expect(isGate1MinimumSignalForensicAuditDisabled()).toBe(true);
    });
    it("'1' / 'TRUE' / 'yes' 거부 (ADR-0157 정합)", () => {
      process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED = '1';
      expect(isGate1MinimumSignalForensicAuditDisabled()).toBe(false);
      process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED = 'TRUE';
      expect(isGate1MinimumSignalForensicAuditDisabled()).toBe(false);
      process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED = 'yes';
      expect(isGate1MinimumSignalForensicAuditDisabled()).toBe(false);
    });
  });

  describe('formatter SSOT', () => {
    it('빈 audits → null (잡음 차단)', () => {
      const summary = buildGate1MinimumSignalForensicSummaryAdr0505([]);
      expect(formatGate1MinimumSignalForensicSection(summary)).toBeNull();
    });

    it('사용자 명시 정확 형식 정합 (compact section)', () => {
      const traces: MinimumSignalScoreTrace[] = [];
      for (let i = 0; i < 48; i++) {
        traces.push(
          makeTrace({
            symbol: `00000${i}`,
            actualScore: 22,
            scoreGap: -48,
            components: [
              makeComponent('WATCHLIST_UPSTREAM_SCORE', { weightedScore: 0, confidence: 'MISSING' }),
              makeComponent('RELATIVE_STRENGTH', { weightedScore: 0, confidence: 'MISSING' }),
              makeComponent('BREAKOUT_STRUCTURE', { weightedScore: 0, confidence: 'MISSING' }),
              makeComponent('SUPPLY_CONFLUENCE', { weightedScore: -2, penaltyApplied: true, confidence: 'UNKNOWN' }),
            ],
          }),
        );
      }
      const audits = traces.map((trace) =>
        buildGate1MinimumSignalForensicAuditAdr0505({
          trace,
          sectorEnergyImpact: {
            diagnosticStatus: 'BLOCKED',
            scoringImpact: 'ZERO_SECTOR_BOOST',
            executionImpact: 'NO_EXECUTION_BLOCK',
            sectorBoostAllowed: false,
            strongBuyAllowed: false,
            hardBlockAllowed: false,
            reason: 'BLOCKED',
          },
        }),
      );
      const summary = buildGate1MinimumSignalForensicSummaryAdr0505(audits);
      const out = formatGate1MinimumSignalForensicSection(summary);
      expect(out).toContain('🧬 Gate1 Minimum Signal Forensic (ADR-0505)');
      expect(out).toContain('candidates=48 failed=n/a (not live failure)');
      expect(out).toContain('dominant=POSITIVE_SCORE_STARVATION');
      expect(out).toContain('watchlist=48');
      expect(out).toContain('rs=48');
      expect(out).toContain('breakout=48');
      expect(out).toContain('supplyUnknown=48');
      expect(out).toContain('SectorEnergy: boost=0 strongBuyBlocked=48 hardBlock=0');
      expect(out).toContain('executionImpact=NONE live=false');
    });
  });


  describe('Patch-GATE-FEATURE-WIRING-002 — watchlist/quote/conditionResults trace propagation', () => {
    it('watchlist score fields are imported with source/scale/average diagnostics', () => {
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({
        trace: makeTrace({ symbol: 'A0001' }),
        candidate: {
          symbol: 'A0001',
          stageReached: 'WATCHLIST',
          blockers: [],
          executionImpact: 'NONE',
          stage2Score: 8,
          upstreamCandidateScore: 7,
          watchlistRank: 3,
          totalCandidates: 48,
          watchlistReason: ['relative breakout leader'],
        },
      });
      const summary = buildGate1MinimumSignalForensicSummaryAdr0505([audit]);

      expect(audit.hydrationAuditAdr0509?.watchlist.scoreImported).toBe(true);
      expect(audit.hydrationAuditAdr0509?.watchlist.sourceField).toBe('stage2Score');
      expect(audit.hydrationAuditAdr0509?.watchlist.scoreScale).toBe('0~10');
      expect(summary.watchlistScoreImportedCount).toBe(1);
      expect(summary.watchlistSourceFieldDistribution?.stage2Score).toBe(1);
      expect(summary.watchlistScoreScaleDistribution?.['0~10']).toBe(1);
      expect(summary.watchlistScoreAvg).toBe(80);
    });

    it('quote return fields recover RS trace availability via QUOTE_RETURN', () => {
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({
        trace: makeTrace({ symbol: 'A0002' }),
        candidate: {
          symbol: 'A0002',
          stageReached: 'WATCHLIST',
          blockers: [],
          executionImpact: 'NONE',
          quote: { return20d: 12, return5d: 3, high20d: 110, volume: 1000, avgVolume: 800, ma20: 95, ma60: 90 },
        },
      });
      const summary = buildGate1MinimumSignalForensicSummaryAdr0505([audit]);

      expect(audit.hydrationAuditAdr0509?.rsAvailable).toBe(true);
      expect(audit.hydrationAuditAdr0509?.rsSource).toBe('QUOTE_RETURN');
      expect(summary.traceWithQuoteCount).toBe(1);
      expect(summary.rsTraceAvailableCount).toBe(1);
      expect(summary.quoteFeatureFieldCoverage?.return20d).toBe(1);
    });

    it('conditionResults relative_strength and breakout keys recover trace/source diagnostics', () => {
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({
        trace: makeTrace({ symbol: 'A0003' }),
        candidate: {
          symbol: 'A0003',
          stageReached: 'WATCHLIST',
          blockers: [],
          executionImpact: 'NONE',
          conditionResults: {
            relative_strength: { status: 'FIRED', score: 2, hadRequiredData: true },
            breakout_momentum: { status: 'FIRED', score: 1, hadRequiredData: true },
            turtle_high: { status: 'THRESHOLD_NOT_MET', score: 0, hadRequiredData: true },
          },
        },
      });
      const summary = buildGate1MinimumSignalForensicSummaryAdr0505([audit]);

      expect(audit.hydrationAuditAdr0509?.rsSource).toBe('CONDITION_RESULTS');
      expect(audit.hydrationAuditAdr0509?.rsScoreUsable).toBe(true);
      expect(audit.hydrationAuditAdr0509?.breakoutSource).toBe('CONDITION_RESULTS');
      expect(audit.hydrationAuditAdr0509?.breakoutScoreUsable).toBe(true);
      expect(summary.traceWithConditionResultsCount).toBe(1);
      expect(summary.conditionResultsKeyCoverage?.relative_strength).toBe(1);
      expect(summary.conditionResultStatusDistribution?.FIRED).toBe(2);
      expect(summary.breakoutConditionKeyCoverage?.breakout_momentum).toBe(1);
    });



    it('evaluateServerGate outputs are projected to conditionResultsTrace and key-indexed conditionResults', () => {
      const trace = projectGateOutputsToConditionResultsTrace([
        {
          key: 'relative_strength',
          output: { score: 1.5, status: 'FIRED', detail: 'RS fired' },
          context: { requiredData: ['kospi20dReturn'], availableData: { kospi20dReturn: true }, hadRequiredData: true },
        },
        {
          key: 'breakout_momentum',
          output: { score: 0, status: 'THRESHOLD_NOT_MET', detail: 'not yet' },
          context: { requiredData: ['high20d'], availableData: { high20d: true }, hadRequiredData: true },
        },
      ]);
      const map = conditionResultsTraceToMap(trace);

      expect(trace[0]).toMatchObject({ key: 'relative_strength', score: 1.5, status: 'FIRED', fired: true });
      expect(trace[1]).toMatchObject({ key: 'breakout_momentum', score: 0, status: 'THRESHOLD_NOT_MET', thresholdNotMet: true });
      expect(map?.relative_strength).toMatchObject({ detail: 'RS fired', hadRequiredData: true });
    });

    it('conditionResultsTrace-only candidate input is preserved and recovers RS/breakout diagnostics', () => {
      const conditionResultsTrace = projectGateOutputsToConditionResultsTrace([
        { key: 'relative_strength', output: { score: 1, status: 'FIRED' }, context: { requiredData: [], availableData: {}, hadRequiredData: true } },
        { key: 'vcp', output: { score: 0, status: 'THRESHOLD_NOT_MET' }, context: { requiredData: [], availableData: {}, hadRequiredData: true } },
      ]);
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({
        trace: makeTrace({ symbol: 'A0003T' }),
        candidate: { symbol: 'A0003T', stageReached: 'WATCHLIST', blockers: [], executionImpact: 'NONE', conditionResultsTrace },
      });
      const summary = buildGate1MinimumSignalForensicSummaryAdr0505([audit]);

      expect(audit.hydrationAuditAdr0509?.candidateTraceHasConditionResults).toBe(true);
      expect(audit.hydrationAuditAdr0509?.rsSource).toBe('CONDITION_RESULTS');
      expect(audit.hydrationAuditAdr0509?.rsScoreUsable).toBe(true);
      expect(audit.hydrationAuditAdr0509?.breakoutSource).toBe('CONDITION_RESULTS');
      expect(audit.hydrationAuditAdr0509?.breakoutScoreUsable).toBe(false);
      expect(summary.conditionResultsBreakPointDistribution?.CONDITION_RESULTS_PROJECTED).toBe(1);
      expect(summary.rsConditionStatusDistribution?.FIRED).toBe(1);
      expect(summary.breakoutConditionStatusDistribution?.THRESHOLD_NOT_MET).toBe(1);
    });

    it('THRESHOLD_NOT_MET condition result is traceAvailable=true and scoreUsable=false', () => {
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({
        trace: makeTrace({ symbol: 'A0003N' }),
        candidate: {
          symbol: 'A0003N',
          stageReached: 'WATCHLIST',
          blockers: [],
          executionImpact: 'NONE',
          conditionResults: {
            relative_strength: { status: 'THRESHOLD_NOT_MET', score: 2, hadRequiredData: true },
            turtle_high: { status: 'THRESHOLD_NOT_MET', score: 0, hadRequiredData: true },
          },
        },
      });

      expect(audit.hydrationAuditAdr0509?.rsAvailable).toBe(true);
      expect(audit.hydrationAuditAdr0509?.rsScoreUsable).toBe(false);
      expect(audit.hydrationAuditAdr0509?.breakoutAvailable).toBe(true);
      expect(audit.hydrationAuditAdr0509?.breakoutScoreUsable).toBe(false);
    });

    it('conditionKeys breakout proxy recovers breakout trace availability without score usable', () => {
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({
        trace: makeTrace({ symbol: 'A0004' }),
        candidate: {
          symbol: 'A0004',
          stageReached: 'WATCHLIST',
          blockers: [],
          executionImpact: 'NONE',
          conditionKeys: ['breakout_momentum'],
        },
      });
      expect(audit.hydrationAuditAdr0509?.breakoutAvailable).toBe(true);
      expect(audit.hydrationAuditAdr0509?.breakoutSource).toBe('CONDITION_KEYS');
      expect(audit.hydrationAuditAdr0509?.breakoutScoreUsable).toBe(false);
    });

    it('nextAction priority and ADR-0467/ADR-0505 conflict diagnostics are exposed', () => {
      const imported = buildGate1MinimumSignalForensicAuditAdr0505({
        trace: makeTrace({ symbol: 'A0005' }),
        candidate: { symbol: 'A0005', stageReached: 'WATCHLIST', blockers: [], executionImpact: 'NONE', stage2Score: 8 },
      });
      const missing = buildGate1MinimumSignalForensicAuditAdr0505({
        trace: makeTrace({ symbol: 'A0006' }),
        candidate: { symbol: 'A0006', stageReached: 'WATCHLIST', blockers: [], executionImpact: 'NONE' },
      });
      const summary = buildGate1MinimumSignalForensicSummaryAdr0505([imported, missing]);
      expect(resolveGate1ForensicNextAction(summary)).toBe('WIRE_QUOTE_FEATURES_TO_FORENSIC_TRACE');
      expect(summary.watchlistDiagnosticConflict).toBe(false);
      expect(summary.adr0467WatchlistVerifiedCount).toBe(1);
      expect(summary.adr0505WatchlistImportedCount).toBe(1);

      const conflicted = buildGate1MinimumSignalForensicSummaryAdr0505([
        buildGate1MinimumSignalForensicAuditAdr0505({
          trace: makeTrace({
            symbol: 'A0007',
            components: [makeComponent('WATCHLIST_UPSTREAM_SCORE', { weightedScore: 0, confidence: 'MISSING' })],
          }),
          candidate: { symbol: 'A0007', stageReached: 'WATCHLIST', blockers: [], executionImpact: 'NONE', stage2Score: 8 },
        }),
      ]);
      expect(conflicted.watchlistDiagnosticConflict).toBe(true);
      expect(conflicted.conflictReason).toBe('TRACE_FIELD_MISSING');
    });
  });


  describe('Patch-SUPPLY-SEMANTIC-AVAILABILITY-001 — semantic field materialization audit', () => {
    it('foreignNetBuy 숫자 필드가 있으면 semanticAvailable=true', () => {
      const result = evaluateInvestorFlowSemanticAvailabilityV2({
        flow: { symbol: '005930', foreignNetBuy: '1,234' },
        symbolMatched: true,
        providerScope: 'SYMBOL_LEVEL',
      });
      expect(result.available).toBe(true);
      expect(result.foreignNetBuy).toBe(1234);
      expect(result.reason).toBe('AVAILABLE');
    });

    it('institutionalNetBuy 숫자 필드가 있으면 semanticAvailable=true', () => {
      const result = evaluateInvestorFlowSemanticAvailabilityV2({
        flow: { symbol: '005930', institutionalNetBuy: '-1,234' },
        symbolMatched: true,
        providerScope: 'SYMBOL_LEVEL',
      });
      expect(result.available).toBe(true);
      expect(result.institutionalNetBuy).toBe(-1234);
    });

    it('foreign/institution 값이 0이어도 materialized로 인정하고 ZERO_BUT_MATERIALIZED reason을 출력한다', () => {
      const result = evaluateInvestorFlowSemanticAvailabilityV2({
        flow: { symbol: '005930', foreignNetBuy: 0, institutionalNetBuy: '0' },
        symbolMatched: true,
        providerScope: 'SYMBOL_LEVEL',
      });
      expect(result.available).toBe(true);
      expect(result.materializedCount).toBeGreaterThanOrEqual(2);
      expect(result.reason).toBe('ZERO_BUT_MATERIALIZED');
      expect(result.wouldBeNeutralIfZeroButMaterialized).toBe(true);
    });

    it('investorType row 배열에서 외국인/기관 row를 netBuy로 매핑한다', () => {
      const fields = extractInvestorFlowSemanticFields([
        { investorType: '외국인', netBuyAmount: '2,000' },
        { investorType: '기관', netBuyAmount: '-500' },
        { investorType: '개인', netBuyAmount: 0 },
      ]);
      expect(fields.foreignNetBuy).toBe(2000);
      expect(fields.institutionalNetBuy).toBe(-500);
      expect(fields.individualNetBuy).toBe(0);
      expect(fields.rowCount).toBe(3);
      expect(fields.foreignRowFound).toBe(true);
      expect(fields.institutionalRowFound).toBe(true);
      expect(fields.rowMappingConfidence).toBe('HIGH');
    });



    it('KIS frgn/orgn numeric string 필드를 표준 net-buy로 normalize하고 field-key diagnostic을 남긴다', () => {
      const result = evaluateInvestorFlowSemanticAvailabilityV2({
        flow: { symbol: '005930', frgn_ntby_tr_pbmn: '1,234', orgn_ntby_tr_pbmn: '-2,000', indv_ntby_tr_pbmn: '766' },
        symbolMatched: true,
        providerScope: 'SYMBOL_LEVEL',
      });
      expect(result.available).toBe(true);
      expect(result.reason).toBe('AVAILABLE');
      expect(result.foreignNetBuy).toBe(1234);
      expect(result.institutionalNetBuy).toBe(-2000);
      expect(result.individualNetBuy).toBe(766);
      expect(result.fieldKeyDiagnostics?.kisRawFieldKeysTop).toContain('frgn_ntby_tr_pbmn');
      expect(result.fieldKeyDiagnostics?.kisNormalizedFieldKeysTop).toContain('foreignNetBuy');
      expect(result.fieldKeyDiagnostics?.sampleValueKinds.numericString).toBeGreaterThanOrEqual(3);
      expect(result.fieldKeyDiagnostics?.candidateMappedFields.foreign).toContain('frgn_ntby_tr_pbmn');
      expect(result.fieldKeyDiagnostics?.candidateMappedFields.institution).toContain('orgn_ntby_tr_pbmn');
    });

    it('직접 netBuy가 없고 buy/sell pair가 있으면 foreign/institution/individual netBuy를 계산한다', () => {
      const result = evaluateInvestorFlowSemanticAvailabilityV2({
        flow: {
          symbol: '005930',
          foreignBuy: '2,500',
          foreignSell: '1,000',
          institutionBuy: 700,
          institutionSell: '1,200',
          individualBuy: '0',
          individualSell: '0',
        },
        symbolMatched: true,
        providerScope: 'SYMBOL_LEVEL',
      });
      expect(result.available).toBe(true);
      expect(result.foreignNetBuy).toBe(1500);
      expect(result.institutionalNetBuy).toBe(-500);
      expect(result.individualNetBuy).toBe(0);
      expect(result.sourceFields.foreignNetBuy).toBe('foreignBuy-foreignSell');
    });

    it('row array invrDvsn/trdVolType와 netBuyVolume을 investor type별로 매핑한다', () => {
      const fields = extractInvestorFlowSemanticFields({
        output: [
          { invrDvsn: 'FRGN', netBuyVolume: '+1,000' },
          { trdVolType: 'INSTITUTION', netBuyVolume: '-250' },
        ],
      });
      expect(fields.foreignNetBuy).toBe(1000);
      expect(fields.institutionalNetBuy).toBe(-250);
      expect(fields.rowMappingConfidence).toBe('HIGH');
    });

    it('/scan_blockers supply diagnostic에 raw key top과 mapped field distribution이 표시된다', () => {
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({
        trace: makeTrace({
          components: [makeComponent('SUPPLY_CONFLUENCE', { weightedScore: -2, penaltyApplied: true, confidence: 'UNKNOWN' })],
        }),
        kisFlow: { symbol: '005930', providerScope: 'SYMBOL_LEVEL', selectedProvider: 'KIS_API', frgn_ntby_tr_pbmn: '1', orgn_ntby_tr_pbmn: '2' },
      });
      const summary = buildGate1MinimumSignalForensicSummaryAdr0505([audit]);
      const out = formatGate1MinimumSignalForensicSection(summary)!;
      expect(summary.supplyRouterForensicConflict).toBe(false);
      expect(summary.foreignNetBuyAvailable).toBe(1);
      expect(summary.institutionalNetBuyAvailable).toBe(1);
      expect(summary.semanticReasonDistribution?.NO_FOREIGN_OR_INSTITUTION_FIELD).toBe(0);
      expect(summary.kisRawFieldKeysTop?.frgn_ntby_tr_pbmn).toBe(1);
      expect(summary.mappedFieldDistribution?.foreign.frgn_ntby_tr_pbmn).toBe(1);
      expect(out).toContain('kisRawFieldKeysTop');
      expect(out).toContain('mappedFieldDistribution');
    });



    it('sanitized semanticRow가 forensic input에 있으면 frgn/orgn alias를 보존하고 semanticAvailable=true', () => {
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({
        trace: makeTrace({
          components: [makeComponent('SUPPLY_CONFLUENCE', { weightedScore: -2, penaltyApplied: true, confidence: 'UNKNOWN' })],
        }),
        kisFlow: {
          symbol: '005930',
          providerScope: 'SYMBOL_LEVEL',
          selectedProvider: 'KIS_API',
          semanticRow: {
            symbol: '005930',
            provider: 'KIS_API',
            providerScope: 'SYMBOL_LEVEL',
            materialized: true,
            foreignNetBuy: 1234,
            institutionalNetBuy: -2000,
            individualNetBuy: 766,
            netBuyAmount: null,
            netBuyVolume: null,
            sourceFields: { foreign: 'frgn_ntby_tr_pbmn', institutional: 'orgn_ntby_tr_pbmn', individual: 'indv_ntby_tr_pbmn' },
            rawFieldKeys: ['symbol', 'frgn_ntby_tr_pbmn', 'orgn_ntby_tr_pbmn', 'indv_ntby_tr_pbmn'],
            normalizedFieldKeys: ['foreignNetBuy', 'institutionalNetBuy', 'individualNetBuy'],
          },
          kisRawRowAvailableAtAdapter: true,
          kisSelectedCandidateCarriesSemanticRow: true,
          forensicInputCarriesSemanticRow: true,
        },
      });
      const summary = buildGate1MinimumSignalForensicSummaryAdr0505([audit]);
      expect(audit.supplyScopeAudit.semanticAvailable).toBe(true);
      expect(summary.semanticRowAvailableCount).toBe(1);
      expect(summary.rawInvestorRowAvailableCount).toBe(1);
      expect(summary.selectedCandidateCarriesSemanticRowCount).toBe(1);
      expect(summary.forensicInputCarriesSemanticRowCount).toBe(1);
      expect(summary.kisRawFieldKeysTop?.frgn_ntby_tr_pbmn).toBe(1);
      expect(summary.kisSemanticFieldKeysTop?.foreignNetBuy).toBe(1);
      expect(summary.mappedFieldDistribution?.institution.orgn_ntby_tr_pbmn).toBe(1);
    });

    it('symbolMatched=false면 semanticAvailable=false', () => {
      const result = evaluateInvestorFlowSemanticAvailabilityV2({
        flow: { foreignNetBuy: 10 },
        symbolMatched: false,
        providerScope: 'SYMBOL_LEVEL',
      });
      expect(result.available).toBe(false);
      expect(result.reason).toBe('SYMBOL_NOT_MATCHED');
    });

    it('providerScope=MARKET_LEVEL이면 semanticAvailable=false', () => {
      const result = evaluateInvestorFlowSemanticAvailabilityV2({
        flow: { foreignNetBuy: 10 },
        symbolMatched: true,
        providerScope: 'MARKET_LEVEL',
      });
      expect(result.available).toBe(false);
      expect(result.reason).toBe('ONLY_MARKET_LEVEL_FLOW');
      expect(result.marketSignal).toBe(false);
    });

    it('router VERIFIED but semantic field missing이면 supplyRouterForensicConflict=true + field-level root cause', () => {
      const audit = buildGate1MinimumSignalForensicAuditAdr0505({
        trace: makeTrace({
          components: [makeComponent('SUPPLY_CONFLUENCE', { weightedScore: -2, penaltyApplied: true, confidence: 'UNKNOWN' })],
        }),
        kisFlow: { symbol: '005930', providerScope: 'SYMBOL_LEVEL', selectedProvider: 'KIS_API', materialized: true },
      });
      const summary = buildGate1MinimumSignalForensicSummaryAdr0505([audit]);
      expect(summary.supplyRouterForensicConflict).toBe(true);
      expect(summary.semanticReasonDistribution?.SEMANTIC_ROW_METADATA_ONLY).toBe(1);
      expect(summary.semanticRowMetadataOnlyCount).toBe(1);
      expect(summary.semanticRowBreakPointDistribution?.SELECTED_CANDIDATE_METADATA_ONLY).toBe(1);
      expect(summary.supplyUnknownRootCauseDistribution?.SUPPLY_SEMANTIC_ROW_METADATA_ONLY).toBe(1);
      const out = formatGate1MinimumSignalForensicSection(summary)!;
      expect(out).toContain('supplySemantic: available=0/1 diagnosticAvailable=1/1');
      expect(out).toContain('supplyUnknownRootCause');
      expect(out).toContain('semanticRowMetadataOnly: 1/1');
      expect(out).toContain('nextAction: WIRE_KIS_SELECTED_CANDIDATE_SEMANTIC_ROW');
    });

    it('/scan_blockers supply에 Supply Semantic Audit 섹션 wiring이 존재한다', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'telegram', 'commands', 'system', 'scanBlockers.cmd.ts'),
        'utf-8',
      );
      expect(src).toContain('🔌 Supply Semantic Audit (ADR-0482)');
      expect(src).toContain('marketSignal=false');
      expect(src).toContain('executionImpact=NONE');
      expect(src).toContain('kisRawFieldKeysTop');
      expect(src).toContain('mappedFieldDistribution');
    });
  });


  describe('정적 grep 가드 (사용자 명시 금지 사항 영구 차단)', () => {
    it('SSOT 모듈에 KIS 주문 함수 5종 import 0건', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, 'gate1MinimumSignalForensicAuditAdr0505.ts'),
        'utf-8',
      );
      expect(src).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/);
      expect(src).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor/);
      expect(src).not.toMatch(/setGateThreshold|GATE_RELAX|STRONG_BUY_OVERRIDE/);
      // 외부 fetch / axios / node-fetch import 0건
      expect(src).not.toMatch(/from ['"](node-fetch|axios)['"]/);
      expect(src).not.toMatch(/^\s*await fetch\(/m);
    });

    it('repo 영속 파일에 KIS 주문 함수 import 0건', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'persistence', 'gate1MinimumSignalForensicTraceRepo.ts'),
        'utf-8',
      );
      expect(src).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/);
      expect(src).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor/);
    });
  });

  describe('통합 시나리오 (사용자 명시 운영 로그 패턴)', () => {
    it('candidates=48 / failed=48 / gap=-48 시나리오 종합 검증', () => {
      const traces: MinimumSignalScoreTrace[] = Array.from({ length: 48 }, (_, i) =>
        makeTrace({
          symbol: `S${i.toString().padStart(5, '0')}`,
          actualScore: 22,
          scoreGap: -48,
          components: [
            makeComponent('WATCHLIST_UPSTREAM_SCORE', { weightedScore: 0, confidence: 'MISSING' }),
            i % 2 === 0
              ? makeComponent('RELATIVE_STRENGTH', { weightedScore: 0, confidence: 'MISSING' })
              : makeComponent('RELATIVE_STRENGTH', { weightedScore: 5, confidence: 'VERIFIED' }),
            i < 42
              ? makeComponent('BREAKOUT_STRUCTURE', { weightedScore: 0, confidence: 'MISSING' })
              : makeComponent('BREAKOUT_STRUCTURE', { weightedScore: 3, confidence: 'VERIFIED' }),
            i < 37
              ? makeComponent('SUPPLY_CONFLUENCE', { weightedScore: -2, penaltyApplied: true, confidence: 'UNKNOWN' })
              : makeComponent('SUPPLY_CONFLUENCE', { weightedScore: 4, confidence: 'VERIFIED' }),
            i < 31
              ? makeComponent('INVESTOR_FLOW', { weightedScore: -1, penaltyApplied: true, confidence: 'UNKNOWN' })
              : makeComponent('INVESTOR_FLOW', { weightedScore: 2, confidence: 'VERIFIED' }),
          ],
        }),
      );
      const audits = traces.map((trace) =>
        buildGate1MinimumSignalForensicAuditAdr0505({
          trace,
          kisFlow: { symbol: undefined as unknown as string, semanticAvailable: false },
          sectorEnergyImpact: {
            diagnosticStatus: 'BLOCKED',
            scoringImpact: 'ZERO_SECTOR_BOOST',
            executionImpact: 'NO_EXECUTION_BLOCK',
            sectorBoostAllowed: false,
            strongBuyAllowed: false,
            hardBlockAllowed: false,
            reason: 'BLOCKED',
          },
        }),
      );
      const summary = buildGate1MinimumSignalForensicSummaryAdr0505(audits);

      // 사용자 명시 운영 로그 패턴 — candidates=48 failed=48
      expect(summary.totalCandidates).toBe(48);
      expect(summary.failedCandidates).toBe(48);
      expect(summary.actualScoreAvg).toBe(22);
      expect(summary.avgScoreGap).toBe(-48);

      // missing 분포
      expect(summary.missingPositiveSourceCounts.watchlistUpstreamMissing).toBe(48);
      expect(summary.missingPositiveSourceCounts.relativeStrengthMissing).toBe(24);
      expect(summary.missingPositiveSourceCounts.breakoutStructureMissing).toBe(42);

      // penalty 분포
      expect(summary.penaltyCounts.supplyUnknownPenalty).toBe(37);
      expect(summary.penaltyCounts.investorFlowUnknownPenalty).toBe(31);
      expect(summary.penaltyCounts.sectorEnergyPenaltyOrBlocked).toBe(48);

      // supplyScopeWarnings — kisFlow.symbol undefined → KIS_FLOW_SYMBOL_MISSING
      expect(summary.supplyScopeWarnings.KIS_FLOW_SYMBOL_MISSING).toBe(48);
      expect(summary.supplyScopeWarnings.KIS_FLOW_SYMBOL_MISMATCH).toBe(0);

      // SectorEnergy 핵심 불변식 — hardBlock 절대 0
      expect(summary.sectorEnergyStrongBuyBlockedCount).toBe(48);
      expect(summary.sectorEnergyHardBlockCount).toBe(0);

      // literal 강제
      expect(summary.executionImpact).toBe('NONE');
      expect(summary.liveExecutionAllowed).toBe(false);
      expect(summary.policyPromotionMode).toBe('SHADOW_ONLY');
    });
  });
});

import { afterEach } from 'vitest';
