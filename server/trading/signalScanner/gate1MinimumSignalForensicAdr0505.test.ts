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
  isGate1MinimumSignalForensicAuditDisabled,
  type Gate1MinimumSignalForensicAuditAdr0505,
  type Gate1MinimumSignalForensicSummaryAdr0505,
} from './gate1MinimumSignalForensicAuditAdr0505.js';
import type {
  MinimumSignalScoreTrace,
  SignalScoreComponentTrace,
  SignalScoreComponentCode,
} from './minimumSignalScoreTrace.js';

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
      expect(out).toContain('candidates=48 failed=48');
      expect(out).toContain('dominant=POSITIVE_SCORE_STARVATION');
      expect(out).toContain('watchlist=48');
      expect(out).toContain('rs=48');
      expect(out).toContain('breakout=48');
      expect(out).toContain('supplyUnknown=48');
      expect(out).toContain('SectorEnergy: boost=0 strongBuyBlocked=48 hardBlock=0');
      expect(out).toContain('executionImpact=NONE live=false');
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
