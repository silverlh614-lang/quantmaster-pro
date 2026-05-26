// @responsibility ADR-0514 SELL_ONLY gateSemanticFlatRow carry regression tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSupplyBySymbolPayloadSnapshotsForTest, rememberSupplyBySymbolPayloadSnapshot } from '../../supply/investorFlowBySymbolPayloadSnapshot.js';
import { buildGate1MinimumSignalForensicAuditAdr0505 } from './gate1MinimumSignalForensicAuditAdr0505.js';
import { collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507 } from './gate1ForensicInputsCollectorAdr0507.js';
import type { MinimumSignalScoreTrace } from './minimumSignalScoreTrace.js';

function makeTrace(symbol: string): MinimumSignalScoreTrace {
  return {
    symbol,
    requiredScore: 6,
    actualScore: 0,
    scoreGap: 6,
    passed: false,
    components: [],
    positiveScoreTotal: 0,
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
  };
}

function sellOnlyGateTrace(symbol: string) {
  return {
    symbol,
    regime: 'R2_BULL' as const,
    marketSession: 'SELL_ONLY' as const,
    gate1Passed: false,
    hardFailCount: 0,
    softFailCount: 0,
    diagnosticOnlyCount: 1,
    conditions: [],
    wouldPassIfProviderIssueSoftened: false,
    wouldPassIfSupplySampleIgnored: false,
    wouldPassIfSectorEnergyIgnored: false,
    wouldPassIfTimeWindowIgnored: true,
    minSignalScoreTrace: makeTrace(symbol),
    executionImpact: 'NONE' as const,
  };
}

function sellOnlyCandidateTrace(symbol: string) {
  return {
    symbol,
    stageReached: 'WATCHLIST' as const,
    marketSession: 'SELL_ONLY' as const,
    blockers: [],
    executionImpact: 'NONE' as const,
  };
}

beforeEach(() => {
  clearSupplyBySymbolPayloadSnapshotsForTest();
});

describe('ADR-0514 SELL_ONLY gateSemanticFlatRow carry', () => {
  it('carries gateSemanticFlatRow from SELL_ONLY bySymbol payload into forensic kisFlow', () => {
    const flatRow = {
      foreignNetBuy: 0,
      institutionNetBuy: 250,
      programNetBuy: null,
      _source: 'ROUTER_EXTRACTED' as const,
    };
    const inputs = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      tradeDate: '2026-05-13',
      now: '2026-05-13T01:05:00.000Z',
      maxAgeMinutes: 60,
      gate1CandidateTraces: [sellOnlyGateTrace('123450')],
      candidateTraces: [sellOnlyCandidateTrace('123450')],
      supplyRouterResult: {
        bySymbol: {
          '123450': {
            code: '123450',
            providerScope: 'SYMBOL_LEVEL',
            gateSemanticFlatRow: flatRow,
            actualInvestorFlowCarried: true,
          },
        },
      },
    });

    expect(inputs[0].sellOnlyBySymbolPayloadAvailable).toBe(true);
    expect(inputs[0].sellOnlyBySymbolPayloadMerged).toBe(true);
    expect(inputs[0].sellOnlyCarryBreakPoint).toBe('CARRIED_TO_FORENSIC');
    expect(inputs[0].kisFlow?.gateSemanticFlatRow).toEqual(flatRow);
    expect((inputs[0].supplyProviderHealth as Record<string, unknown> | undefined)?.gateSemanticFlatRow).toEqual(flatRow);
  });

  it('preserves base gateSemanticFlatRow when cached SELL_ONLY bySymbol payload is stale', () => {
    rememberSupplyBySymbolPayloadSnapshot({
      tradeDate: '2026-05-12',
      capturedAt: '2026-05-12T01:00:00.000Z',
      routeResult: {
        selectedProvider: 'KIS_API',
        bySymbol: {
          '000661': {
            code: '000661',
            providerScope: 'SYMBOL_LEVEL',
            actualInvestorFlowRows: [{ frgn_ntby_qty: '10' }],
            actualInvestorFlowCarried: true,
          },
        },
      },
    });
    const baseFlatRow = {
      foreignNetBuy: 10,
      institutionNetBuy: -20,
      programNetBuy: null,
      _source: 'ROUTER_EXTRACTED' as const,
    };
    const supplyProviderHealth = {
      providerName: 'KIS_API',
      selectedInvestorFlowProvider: 'KIS_API',
      providerScope: 'SYMBOL_LEVEL',
      gateSemanticFlatRow: baseFlatRow,
    } as unknown as NonNullable<Parameters<typeof collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507>[0]['supplyProviderHealth']>;
    const inputs = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      tradeDate: '2026-05-13',
      now: '2026-05-13T03:00:00.000Z',
      maxAgeMinutes: 60,
      gate1CandidateTraces: [sellOnlyGateTrace('000661')],
      candidateTraces: [sellOnlyCandidateTrace('000661')],
      supplyProviderHealth,
      supplyRouterResult: { bySymbol: {} },
    });

    expect(inputs[0].sellOnlyBySymbolPayloadAvailable).toBe(true);
    expect(inputs[0].sellOnlyBySymbolPayloadMerged).toBe(false);
    expect(inputs[0].sellOnlyCarryBreakPoint).toBe('BYSYMBOL_PAYLOAD_STALE');
    expect(inputs[0].kisFlow?.gateSemanticFlatRow).toEqual(baseFlatRow);
  });

  it('adds sellOnlyCarryBreakPoint to WRAPPER semantic wire diagnostics without error logging', () => {
    // Patch-009 P1: SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC noise category default-suppressed at
    // LOG_LEVEL=info. 본 테스트는 진단 emission wiring 자체 검증 (forensic builder 가
    // BEFORE_SEMANTIC_EVAL 라인을 inputShape=WRAPPER 형태로 산출하는지) → noise gate
    // 우회 의무. ADR-0157 정확 비교 + try/finally 로 cross-test 격리 보장.
    const prevSuppress = process.env.LOG_SUPPRESS_SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC;
    process.env.LOG_SUPPRESS_SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC = 'false';
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      buildGate1MinimumSignalForensicAuditAdr0505({
        trace: makeTrace('999991'),
        quoteSymbol: '999991',
        sellOnlyCarryBreakPoint: 'BYSYMBOL_PAYLOAD_MISSING',
        kisFlow: {
          symbol: '999991',
          requestSymbol: '999991',
          providerScope: 'SYMBOL_LEVEL',
          selectedProvider: 'KIS_API',
          materialized: true,
        },
      });
      const beforeLog = infoSpy.mock.calls
        .map((call) => String(call[0]))
        .find((line) => line.includes('stage=BEFORE_SEMANTIC_EVAL'));
      expect(beforeLog).toContain('inputShape=WRAPPER');
      expect(beforeLog).toContain('sellOnlyCarryBreakPoint=BYSYMBOL_PAYLOAD_MISSING');
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
      if (prevSuppress === undefined) {
        delete process.env.LOG_SUPPRESS_SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC;
      } else {
        process.env.LOG_SUPPRESS_SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC = prevSuppress;
      }
    }
  });

  it('resolves WATCHLIST pseudo symbol through quote.symbol and carries bySymbol flat row', () => {
    const flatRow = {
      foreignNetBuy: 300,
      institutionNetBuy: 200,
      programNetBuy: null,
      _source: 'ROUTER_EXTRACTED' as const,
    };
    const candidate = {
      ...sellOnlyCandidateTrace('WATCHLIST_1'),
      quote: { symbol: '011210' },
    };
    const inputs = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      gate1CandidateTraces: [sellOnlyGateTrace('WATCHLIST_1')],
      candidateTraces: [candidate],
      supplyRouterResult: {
        bySymbol: {
          '011210': {
            code: '011210',
            providerScope: 'SYMBOL_LEVEL',
            gateSemanticFlatRow: flatRow,
          },
        },
      },
    });

    expect(inputs[0].sellOnlyCarryBreakPoint).toBe('CARRIED_TO_FORENSIC');
    expect(inputs[0].kisFlow?.gateSemanticFlatRow).toEqual(flatRow);
  });

  it('skips unresolved WATCHLIST pseudo symbol instead of evaluating wrapper metadata', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const inputs = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
        gate1CandidateTraces: [sellOnlyGateTrace('WATCHLIST_45')],
        candidateTraces: [sellOnlyCandidateTrace('WATCHLIST_45')],
        supplyProviderHealth: {
          providerName: 'KIS_API',
          selectedInvestorFlowProvider: 'KIS_API',
          providerScope: 'SYMBOL_LEVEL',
        } as unknown as Parameters<typeof collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507>[0]['supplyProviderHealth'],
        supplyRouterResult: { bySymbol: {} },
      });
      expect(inputs[0].sellOnlyBySymbolPayloadAvailable).toBe(false);
      expect(inputs[0].sellOnlyCarryBreakPoint).toBe('PSEUDO_SYMBOL_NOT_RESOLVED');
      expect(inputs[0].supplySemanticSkipReason).toBe('DIAGNOSTIC_SKIPPED_PSEUDO_SYMBOL');

      const audit = buildGate1MinimumSignalForensicAuditAdr0505(inputs[0]);
      expect(audit.supplyScopeAudit.semanticReason).toBe('DIAGNOSTIC_SKIPPED_PSEUDO_SYMBOL');
      expect(audit.supplyScopeAudit.providerIssue).toBe(false);
      expect(audit.supplyScopeAudit.executionImpact).toBe('NONE');
      expect(audit.supplyScopeAudit.scoreUsage).toBe('DIAGNOSTIC_ONLY');
      expect(infoSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

function entryFilterGateTrace(symbol: string) {
  return {
    symbol,
    regime: 'R2_BULL' as const,
    marketSession: 'REGULAR' as const,
    gate1Passed: false,
    hardFailCount: 0,
    softFailCount: 0,
    diagnosticOnlyCount: 1,
    conditions: [],
    wouldPassIfProviderIssueSoftened: false,
    wouldPassIfSupplySampleIgnored: false,
    wouldPassIfSectorEnergyIgnored: false,
    wouldPassIfTimeWindowIgnored: false,
    minSignalScoreTrace: makeTrace(symbol),
    executionImpact: 'NONE' as const,
  };
}

function entryFilterCandidateTrace(symbol: string) {
  return {
    symbol,
    stageReached: 'GATE1' as const,
    marketSession: 'REGULAR' as const,
    blockers: [],
    executionImpact: 'NONE' as const,
  };
}

describe('Patch-GATE1-FORENSIC-PERSYMBOL-ROW-CARRY-RESTORE-001 ENTRY_FILTER per-symbol carry', () => {
  it('carries the per-symbol bySymbol row (not a shared candidate row) for an ENTRY_FILTER candidate', () => {
    const ownRow = {
      foreignNetBuy: 111,
      institutionNetBuy: 222,
      programNetBuy: null,
      _source: 'ROUTER_EXTRACTED' as const,
    };
    const otherRow = {
      foreignNetBuy: -999,
      institutionNetBuy: -999,
      programNetBuy: null,
      _source: 'ROUTER_EXTRACTED' as const,
    };
    const inputs = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
      gate1CandidateTraces: [entryFilterGateTrace('005930')],
      candidateTraces: [entryFilterCandidateTrace('005930')],
      // shared health carries a DIFFERENT candidate's flat row — the old PREFLIGHT-only
      // regression would have leaked this shared row onto 005930. Restored per-symbol carry
      // must override it with 005930's genuine bySymbol row.
      supplyProviderHealth: {
        providerName: 'KIS_API',
        selectedInvestorFlowProvider: 'KIS_API',
        providerScope: 'SYMBOL_LEVEL',
        gateSemanticFlatRow: otherRow,
      } as unknown as Parameters<typeof collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507>[0]['supplyProviderHealth'],
      supplyRouterResult: {
        bySymbol: {
          '005930': {
            code: '005930',
            providerScope: 'SYMBOL_LEVEL',
            gateSemanticFlatRow: ownRow,
            actualInvestorRow: { foreignNetBuy: '111', institutionNetBuy: '222' },
            actualInvestorFlowRows: [{ foreignNetBuy: '111', institutionNetBuy: '222' }],
            actualInvestorFlowCarried: true,
          },
        },
      },
    });

    expect(inputs[0].sourcePath).toBe('ENTRY_FILTER_GATE1_CANDIDATE_TRACE');
    expect(inputs[0].sellOnlyBySymbolPayloadAvailable).toBe(true);
    expect(inputs[0].sellOnlyBySymbolPayloadMerged).toBe(true);
    expect(inputs[0].sellOnlyCarryBreakPoint).toBe('CARRIED_TO_FORENSIC');
    // per-symbol row wins over the shared candidate row.
    expect(inputs[0].kisFlow?.gateSemanticFlatRow).toEqual(ownRow);
    expect(inputs[0].kisFlow?.actualInvestorFlowRows).toEqual([{ foreignNetBuy: '111', institutionNetBuy: '222' }]);
  });

  it('falls back to the shared candidate row (byte-equivalent old behavior) when ENV=false', () => {
    const prev = process.env.GATE1_FORENSIC_PERSYMBOL_ROW_CARRY_ENABLED;
    process.env.GATE1_FORENSIC_PERSYMBOL_ROW_CARRY_ENABLED = 'false';
    try {
      const ownRow = {
        foreignNetBuy: 111,
        institutionNetBuy: 222,
        programNetBuy: null,
        _source: 'ROUTER_EXTRACTED' as const,
      };
      const sharedRow = {
        foreignNetBuy: -999,
        institutionNetBuy: -999,
        programNetBuy: null,
        _source: 'ROUTER_EXTRACTED' as const,
      };
      const inputs = collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
        gate1CandidateTraces: [entryFilterGateTrace('005930')],
        candidateTraces: [entryFilterCandidateTrace('005930')],
        supplyProviderHealth: {
          providerName: 'KIS_API',
          selectedInvestorFlowProvider: 'KIS_API',
          providerScope: 'SYMBOL_LEVEL',
          gateSemanticFlatRow: sharedRow,
        } as unknown as Parameters<typeof collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507>[0]['supplyProviderHealth'],
        supplyRouterResult: {
          bySymbol: {
            '005930': {
              code: '005930',
              providerScope: 'SYMBOL_LEVEL',
              gateSemanticFlatRow: ownRow,
              actualInvestorFlowRows: [{ foreignNetBuy: '111', institutionNetBuy: '222' }],
              actualInvestorFlowCarried: true,
            },
          },
        },
      });

      // ENV=false → per-symbol carry suppressed for ENTRY_FILTER (old PREFLIGHT-only regression).
      expect(inputs[0].sourcePath).toBe('ENTRY_FILTER_GATE1_CANDIDATE_TRACE');
      expect(inputs[0].sellOnlyBySymbolPayloadAvailable).toBeUndefined();
      expect(inputs[0].sellOnlyBySymbolPayloadMerged).toBeUndefined();
      expect(inputs[0].sellOnlyCarryBreakPoint).toBeUndefined();
      // shared row leaks through (no per-symbol override), and the per-symbol rows are NOT carried.
      expect(inputs[0].kisFlow?.gateSemanticFlatRow).toEqual(sharedRow);
      expect(inputs[0].actualInvestorFlowRows).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.GATE1_FORENSIC_PERSYMBOL_ROW_CARRY_ENABLED;
      else process.env.GATE1_FORENSIC_PERSYMBOL_ROW_CARRY_ENABLED = prev;
    }
  });
});
