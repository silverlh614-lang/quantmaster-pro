import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  __resetIntradayProgramFlowSnapshotRepoForTests,
  buildIntradayProgramFlowSnapshotFromRuntimeContext,
  saveLatestIntradayProgramFlowSnapshot,
} from '../../replay/intradayProgramFlowSnapshotRepo.js';
import {
  __resetNormalSupplyPreviewForTests,
  classifySupplySignal,
  deriveNormalSupplyPreviewEngineMode,
  formatNormalSupplyPreviewFullSections,
  formatNormalSupplyPreviewSection,
  getLastNormalSupplyPreview,
  normalizeProgramFlowValue,
  persistNormalSupplyPreview,
} from './normalSupplyPreview.js';

const snapshotTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'normal-supply-preview-'));

beforeEach(() => {
  process.env.INTRADAY_PROGRAM_FLOW_SNAPSHOT_FILE = path.join(
    snapshotTestDir,
    `latest-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  __resetIntradayProgramFlowSnapshotRepoForTests();
  __resetNormalSupplyPreviewForTests();
});

afterEach(() => {
  __resetIntradayProgramFlowSnapshotRepoForTests();
  delete process.env.INTRADAY_PROGRAM_FLOW_SNAPSHOT_FILE;
  delete process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED;
  delete process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED;
});

describe('normalizeProgramFlowValue', () => {
  it.each([
    [1234, true, 1234, 'PROGRAM_VALUE_PARSE_OK'],
    [0, true, 0, 'PROGRAM_VALUE_ZERO'],
    ['1234', true, 1234, 'PROGRAM_VALUE_NUMERIC_STRING'],
    ['1,234', true, 1234, 'PROGRAM_VALUE_COMMA_NUMERIC_STRING'],
    ['-1,234', true, -1234, 'PROGRAM_VALUE_COMMA_NUMERIC_STRING'],
    ['+1,234', true, 1234, 'PROGRAM_VALUE_COMMA_NUMERIC_STRING'],
    ['N/A', false, undefined, 'PROGRAM_VALUE_NA'],
    ['-', false, undefined, 'PROGRAM_VALUE_PLACEHOLDER'],
    ['', false, undefined, 'PROGRAM_VALUE_EMPTY'],
    [{ value: '1,234' }, true, 1234, 'PROGRAM_VALUE_OBJECT_WRAPPER'],
    [{ netAmount: '-1,234' }, true, -1234, 'PROGRAM_VALUE_OBJECT_WRAPPER'],
    ['매수우위', false, undefined, 'PROGRAM_VALUE_UNSUPPORTED_FORMAT'],
  ])('normalizes %o as diagnostic-only program value', (input, ok, value, reason) => {
    const normalized = normalizeProgramFlowValue(input);
    expect(normalized.ok).toBe(ok);
    expect(normalized.value).toBe(value);
    expect(normalized.reason).toBe(reason);
    expect(normalized.diagnosticOnly).toBe(true);
  });
});

describe('Normal Supply Preview under SELL_ONLY', () => {
  it('persists a diagnostic-only normal supply preview with no execution impact', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'SELL_ONLY',
      source: 'PREFLIGHT_ABORT_DIAGNOSTIC',
      reason: 'ABORT_SELL_ONLY',
      preflightDecision: 'ABORT_SELL_ONLY',
      supplyInjection: {
        totalCandidates: 3,
        requestedSymbols: 3,
        receivedResults: 3,
        injected: 1,
        verified: 1,
        degraded: 1,
        stale: 0,
        missing: 1,
        unknown: 0,
        routerConnected: true,
        gateContextConnected: true,
      },
      candidates: [
        {
          code: '005930',
          name: 'Samsung',
          preflight: {
            supplyContext: {
              symbol: '005930',
              provider: 'KIS_API',
              supplyProviderHealth: 'VERIFIED',
              supplySignal: 'BULLISH',
              providerIssue: false,
              marketSignal: true,
              executionImpact: 'NONE',
              foreignNetBuyAmount: 100,
              institutionNetBuyAmount: 50,
            },
          },
        },
        {
          code: '000660',
          name: 'SK Hynix',
          preflight: {
            supplyContext: {
              symbol: '000660',
              provider: 'KIS_API',
              supplyProviderHealth: 'DEGRADED',
              supplySignal: 'NEUTRAL',
              providerIssue: true,
              marketSignal: false,
              executionImpact: 'NONE',
            },
          },
        },
        { code: '035420', name: 'Naver', preflight: {} },
      ] as any,
    });

    expect(preview.previewMode).toBe('NORMAL_SUPPLY_DIAGNOSTIC');
    expect(preview.liveExecutionAllowed).toBe(false);
    expect(preview.realOrderAllowed).toBe(false);
    expect(preview.shadowObservableAllowed).toBe(true);
    expect(preview.executionImpact).toBe('NONE');
    expect(preview.healthCounts).toEqual({
      VERIFIED: 1,
      DEGRADED: 1,
      STALE: 0,
      MISSING: 1,
      UNKNOWN: 0,
    });
    expect(preview.signalCounts.BULLISH).toBe(1);
    expect(preview.signalCounts.UNUSABLE).toBe(2);
    expect(preview.topCandidates[0]?.symbol).toBe('005930');
    expect(getLastNormalSupplyPreview()).toBe(preview);
  });

  it('classifies the ACCUMULATING tier without weakening the BULLISH threshold', () => {
    expect(classifySupplySignal({
      supplyScore: 77,
      dataStatus: 'VERIFIED',
      providerIssue: false,
      marketSignal: true,
      foreignNetBuy: 100,
      institutionNetBuy: 50,
    })).toBe('ACCUMULATING');
    expect(classifySupplySignal({
      supplyScore: 81,
      dataStatus: 'VERIFIED',
      providerIssue: false,
      marketSignal: true,
      foreignNetBuy: 100,
      institutionNetBuy: 50,
    })).toBe('BULLISH');
    expect(classifySupplySignal({
      supplyScore: 65,
      dataStatus: 'VERIFIED',
      providerIssue: false,
      marketSignal: true,
      foreignNetBuy: 100,
      institutionNetBuy: 50,
    })).toBe('NEUTRAL');
    expect(classifySupplySignal({
      supplyScore: 28,
      dataStatus: 'VERIFIED',
      providerIssue: false,
      marketSignal: true,
      foreignNetBuy: -100,
      institutionNetBuy: -50,
    })).toBe('BEARISH');
    expect(classifySupplySignal({
      supplyScore: 77,
      dataStatus: 'STALE',
      providerIssue: false,
      marketSignal: true,
      foreignNetBuy: 100,
      institutionNetBuy: 50,
    })).toBe('UNUSABLE');
    expect(classifySupplySignal({
      supplyScore: 77,
      dataStatus: 'VERIFIED',
      providerIssue: true,
      marketSignal: true,
      foreignNetBuy: 100,
      institutionNetBuy: 50,
    })).toBe('UNUSABLE');
  });

  it('formats the overlay with UNKNOWN=0 and executionImpact=NONE', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'MACRO_LIVE_BLOCK',
      source: 'RUNTIME_DIAGNOSTIC',
      candidates: [],
    });
    const section = formatNormalSupplyPreviewSection(preview);
    expect(section).toContain('Normal Supply Preview under SELL_ONLY');
    expect(section).toContain('previewMode: NORMAL_SUPPLY_DIAGNOSTIC');
    expect(section).toContain('liveExecutionAllowed: false');
    expect(section).toContain('realOrderAllowed: false');
    expect(section).toContain('executionImpact: NONE');
    expect(section).toContain('UNKNOWN: 0');
    expect(section).not.toContain('NORMAL_SUPPLY_DIAGNOSTIC_FULL');
    expect(section).not.toContain('BEARISH Supply Candidates');
    expect(section).not.toContain('Signal Source Split');
  });

  it('classifies SELL_ONLY and macro live block separately from true hard block', () => {
    expect(deriveNormalSupplyPreviewEngineMode({ preflightDecision: 'ABORT_SELL_ONLY' })).toBe('SELL_ONLY');
    expect(deriveNormalSupplyPreviewEngineMode({ liveEntryBlockedReason: 'R6_DEFENSE,FOMC_BLOCK' })).toBe('MACRO_LIVE_BLOCK');
    expect(deriveNormalSupplyPreviewEngineMode({ liveEntryBlockedReason: 'R5_CAUTION' })).toBe('MACRO_LIVE_BLOCK');
    expect(deriveNormalSupplyPreviewEngineMode({
      macroGateState: { regime: 'R4_NEUTRAL', diagnosticLiveEntryBlocked: true },
    })).toBe('MACRO_LIVE_BLOCK');
    expect(deriveNormalSupplyPreviewEngineMode({ preflightDecision: 'ABORT_HARD_BLOCK' })).toBe('HARD_BLOCK');
    expect(deriveNormalSupplyPreviewEngineMode({ preflightDecision: 'ABORT_POSITION_FULL' })).toBe('POSITION_FULL');
  });

  it('formats full mode summary with safety flags and threshold explanation', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      candidates: [
        {
          code: '003230',
          name: 'Samyang Foods',
          preflight: {
            supplyContext: {
              symbol: '003230',
              provider: 'KIS_API',
              supplyProviderHealth: 'VERIFIED',
              supplySignal: 'NEUTRAL',
              providerIssue: false,
              marketSignal: true,
              executionImpact: 'NONE',
              foreignNetBuyAmount: 100,
              institutionNetBuyAmount: 50,
            },
          },
        },
      ] as any,
    });

    const text = formatNormalSupplyPreviewFullSections(preview).join('\n');
    expect(text).toContain('previewMode: NORMAL_SUPPLY_DIAGNOSTIC_FULL');
    expect(text).toContain('unknownPenaltyApplied=false');
    expect(text).toContain('providerIssueAsBearish=false');
    expect(text).toContain('bullishThreshold: 80');
    expect(text).toContain('accumulatingRange: 70~79');
    expect(text).toContain('topSupplyScore: 77');
    expect(text).toContain('topSignal: ACCUMULATING');
    expect(text).toContain('ACCUMULATING quiet observation candidate');
    expect(text).toContain('quiet accumulation candidate');
    expect(text).toContain('accumulatingUsedForLiveDecision=false');
    expect(text).toContain('accumulatingAllowsStrongBuy=false');
    expect(text).toContain('watchlistPriorityBoost=1');
    expect(text).toContain('shadowTracking=true');
    expect(text).toContain('strongBuyAllowed=false');
    expect(text).toContain('realOrderAllowed=false');
  });

  it('prints bearish per-symbol details with provider and market split', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'SELL_ONLY',
      source: 'COMMAND',
      candidates: [
        {
          code: '111111',
          name: 'Bear One',
          preflight: {
            supplyContext: {
              symbol: '111111',
              provider: 'KIS_API',
              supplyProviderHealth: 'VERIFIED',
              supplySignal: 'BEARISH',
              providerIssue: false,
              marketSignal: true,
              executionImpact: 'NONE',
              foreignNetBuyAmount: -123000000,
              institutionNetBuyAmount: -87000000,
              programNetBuyAmount: -1000,
            },
          },
        },
        {
          code: '222222',
          name: 'Bear Two',
          preflight: {
            supplyContext: {
              symbol: '222222',
              provider: 'KIS_API',
              supplyProviderHealth: 'VERIFIED',
              supplySignal: 'BEARISH',
              providerIssue: false,
              marketSignal: true,
              executionImpact: 'NONE',
              foreignNetBuyAmount: -1,
              institutionNetBuyAmount: -2,
            },
          },
        },
      ] as any,
    });

    const text = formatNormalSupplyPreviewFullSections(preview).join('\n');
    expect(text).toContain('BEARISH Supply Candidates 2');
    expect(text).toContain('111111 Bear One');
    expect(text).toContain('signal=BEARISH');
    expect(text).toContain('foreignNetBuy=-123,000,000');
    expect(text).toContain('institutionNetBuy=-87,000,000');
    expect(text).toContain('providerIssue=false');
    expect(text).toContain('marketSignal=true');
    expect(text).toContain('dataStatus=VERIFIED');
    expect(text).toContain('sourceProvider=KIS_API');
    expect(text).toContain('usedForLiveDecision=false');
    expect(text).toContain('executionImpact=NONE');
    expect(text).toContain('bearishFromProviderIssue: 0');
  });

  it('keeps providerIssue and UNKNOWN rows out of bearish directional counts', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'MACRO_LIVE_BLOCK',
      source: 'COMMAND',
      candidates: [
        {
          code: '333333',
          name: 'Provider Gap',
          preflight: {
            supplyContext: {
              symbol: '333333',
              provider: 'KIS_API',
              supplyProviderHealth: 'DEGRADED',
              supplySignal: 'BEARISH',
              providerIssue: true,
              marketSignal: false,
              executionImpact: 'NONE',
              foreignNetBuyAmount: -10,
              institutionNetBuyAmount: -20,
              rawStatus: 'KIS_TIMEOUT',
            },
          },
        },
        {
          code: '444444',
          name: 'Unknown Row',
          preflight: {
            supplyContext: {
              symbol: '444444',
              provider: 'NONE',
              supplyProviderHealth: 'UNKNOWN',
              supplySignal: 'UNUSABLE',
              providerIssue: true,
              marketSignal: false,
              executionImpact: 'NONE',
              rawStatus: 'UNKNOWN_PROVIDER',
            },
          },
        },
      ] as any,
    });

    const text = formatNormalSupplyPreviewFullSections(preview).join('\n');
    expect(preview.signalCounts.BEARISH).toBe(0);
    expect(preview.signalCounts.UNUSABLE).toBe(2);
    expect(preview.signalSourceSplit.bearishFromProviderIssue).toBe(0);
    expect(text).toContain('UNUSABLE / UNKNOWN Supply Rows');
    expect(text).toContain('Provider Gap');
    expect(text).toContain('penaltyApplied=false');
    expect(text).toContain('unknownPenaltyApplied=false');
    expect(text).toContain('bearishFromProviderIssue: 0');
  });

  it('reports field availability and paginates long full output', () => {
    const candidates = Array.from({ length: 41 }, (_, index) => ({
      code: `${100000 + index}`,
      name: `Candidate ${index}`,
      preflight: {
        supplyContext: {
          symbol: `${100000 + index}`,
          provider: 'KIS_API',
          supplyProviderHealth: 'VERIFIED',
          supplySignal: index % 5 === 0 ? 'BEARISH' : 'NEUTRAL',
          providerIssue: false,
          marketSignal: true,
          executionImpact: 'NONE',
          foreignNetBuyAmount: index % 5 === 0 ? -100 - index : 100 + index,
          institutionNetBuyAmount: index % 5 === 0 ? -200 - index : 200 + index,
        },
      },
    }));
    const preview = persistNormalSupplyPreview({
      engineMode: 'SELL_ONLY',
      source: 'COMMAND',
      candidates: candidates as any,
    });

    const pages = formatNormalSupplyPreviewFullSections(preview, { maxTopCandidates: 41, maxChars: 1200 });
    const text = pages.join('\n');
    expect(pages.length).toBeGreaterThan(1);
    expect(preview.signalCounts.ACCUMULATING).toBe(32);
    expect(preview.signalCounts.BEARISH).toBe(9);
    expect(text).toContain('ACCUMULATING=32');
    expect(text).toContain('foreignNetBuyField: 41/41');
    expect(text).toContain('institutionNetBuyField: 41/41');
    expect(text).toContain('programNetBuyField: 0/41');
    expect(text).toContain('semanticRowAvailable: 41/41');
    expect(text).toContain('rawInvestorRowAvailable: 41/41');
    expect(text).toContain('providerCallsAdded=0');
    expect(pages.every((page) => page.length <= 1300)).toBe(true);
  });


});

describe('Normal Supply Preview program flow diagnostics', () => {
  beforeEach(() => {
    __resetNormalSupplyPreviewForTests();
  });

  const baseCandidate = (overrides: Record<string, unknown> = {}) => ({
    code: '123456',
    name: 'Program Flow Test',
    preflight: {
      supplyContext: {
        symbol: '123456',
        provider: 'KIS_API',
        supplyProviderHealth: 'VERIFIED',
        supplySignal: 'NEUTRAL',
        providerIssue: false,
        marketSignal: true,
        executionImpact: 'NONE',
        foreignNetBuyAmount: 100,
        institutionNetBuyAmount: 50,
        ...overrides,
      },
    },
  });

  it('does not treat missing program flow as bearish or penalized', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'SELL_ONLY',
      source: 'COMMAND',
      candidates: [baseCandidate()] as any,
    });

    expect(preview.candidates[0]?.supplySignal).toBe('ACCUMULATING');
    expect(preview.candidates[0]?.programFlow?.stockLevel.available).toBe(false);
    expect(preview.candidates[0]?.programMissingAsBearish).toBe(false);
    expect(preview.programFlowDiagnostics.programPenaltyApplied).toBe(false);
    expect(preview.fieldAvailability.missingProgramFlowAsBearish).toBe(false);
  });

  it('maps stock program buy and sell amounts into a diagnostic net buy', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      candidates: [baseCandidate({ programBuyAmount: 100, programSellAmount: 40 })] as any,
    });

    expect(preview.candidates[0]?.programFlow?.stockLevel.netBuy).toBe(60);
    expect(preview.candidates[0]?.programFlow?.stockLevel.available).toBe(true);
    expect(preview.candidates[0]?.programFlow?.stockLevel.signal).toBe('BULLISH');
    expect(preview.fieldAvailability.stockProgramAvailable).toBe(1);
  });

  it('maps stock program net amount aliases without changing diagnostic-only safety flags', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      candidates: [baseCandidate({ programNetAmount: -50 })] as any,
    });

    expect(preview.candidates[0]?.programFlow?.stockLevel.netBuy).toBe(-50);
    expect(preview.candidates[0]?.programFlow?.stockLevel.available).toBe(true);
    expect(preview.candidates[0]?.programFlow?.stockLevel.signal).toBe('BEARISH');
    expect(preview.candidates[0]?.programFlowDryRun.appliedToLiveScore).toBe(false);
    expect(preview.executionImpact).toBe('NONE');
  });

  it('computes active/passive confluence labels for buying, selling, and mixed flow', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      candidates: [
        baseCandidate(),
        baseCandidate({ symbol: '123457', foreignNetBuyAmount: 1, institutionNetBuyAmount: 2, programNetBuy: 3 }),
        baseCandidate({ symbol: '123458', foreignNetBuyAmount: -1, institutionNetBuyAmount: -2, programNetBuy: -3, supplySignal: 'BEARISH' }),
        baseCandidate({ symbol: '123459', foreignNetBuyAmount: 1, institutionNetBuyAmount: 2, programNetBuy: -3 }),
      ] as any,
    });

    expect(preview.candidates.map((candidate) => candidate.activePassiveConfluence)).toEqual([
      'ACTIVE_BUYING_ONLY',
      'ACTIVE_PASSIVE_CONFIRMED_BUY',
      'ACTIVE_PASSIVE_CONFIRMED_SELL',
      'MIXED_FLOW',
    ]);
  });

  it('separates provider issue from program market signal', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      marketProgramFlow: { providerIssue: true, reason: 'KIS_TIMEOUT' },
      candidates: [baseCandidate()] as any,
    });

    expect(preview.fieldAvailability.marketProgramSignal).toBe('UNKNOWN');
    expect(preview.candidates[0]?.programFlow?.marketLevel.providerIssue).toBe(true);
    expect(preview.candidates[0]?.programFlow?.marketLevel.marketSignal).toBe(false);
    expect(preview.signalCounts.BEARISH).toBe(0);
  });

  it('prints full diagnostics and confluence in top and bearish rows', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'SELL_ONLY',
      source: 'COMMAND',
      candidates: [
        baseCandidate(),
        baseCandidate({
          symbol: '654321',
          foreignNetBuyAmount: -100,
          institutionNetBuyAmount: -50,
          supplySignal: 'BEARISH',
        }),
      ] as any,
    });

    const text = formatNormalSupplyPreviewFullSections(preview, { maxTopCandidates: 2 }).join('\n');
    expect(text).toContain('Program Flow Availability');
    expect(text).toContain('Active/Passive Confluence');
    expect(text).toContain('Program Flow Diagnostics');
    expect(text).toContain('activeFlow=외인+기관 동반 순매수');
    expect(text).toContain('passiveFlow=PROGRAM_FLOW_UNAVAILABLE');
    expect(text).toContain('confluence=ACTIVE_BUYING_ONLY');
    expect(text).toContain('confluence=ACTIVE_SELLING_ONLY');
    expect(text).toContain('programMissingAsBearish=false');
    expect(text).toContain('programFlowUsedForLiveDecision=false');
    expect(text).toContain('executionImpact=NONE');
  });
  it('parses numeric string stock program flow and passive-only confluence without live score impact', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      candidates: [baseCandidate({ foreignNetBuyAmount: 0, institutionNetBuyAmount: 0, programNetBuy: '1,234' })] as any,
    });

    const candidate = preview.candidates[0]!;
    expect(candidate.programFlow?.stockLevel.netBuy).toBe(1234);
    expect(candidate.programFlow?.stockLevel.available).toBe(true);
    expect(candidate.activePassiveConfluence).toBe('PASSIVE_BUYING_ONLY');
    expect(candidate.supplyScore).toBe(candidate.programFlowDryRun.currentSupplyScore);
    expect(candidate.programFlowDryRun.appliedToLiveScore).toBe(false);
  });

  it('maps market-level program flow aliases as diagnostic-only passive proxy', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      marketProgramFlow: { marketProgramNetBuy: 1000, sourceProvider: 'CACHE' },
      candidates: [baseCandidate()] as any,
    });

    expect(preview.fieldAvailability.marketProgramAvailable).toBe(true);
    expect(preview.fieldAvailability.marketProgramSignal).toBe('BULLISH');
    expect(preview.fieldAvailability.marketProgramSource).toBe('CACHE');
    expect(preview.fieldAvailability.passiveProxyUsedForLiveDecision).toBe(false);
    expect(preview.candidates[0]?.activePassiveConfluence).toBe('ACTIVE_PASSIVE_CONFIRMED_BUY');
    expect(preview.programFlowDiagnostics.reason).toBe('PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY');
    expect(preview.programFlowDiagnostics.nextAction).toBe('OBSERVE_DIAGNOSTIC_ONLY');
  });

  it('treats zero and snake-case/abbreviated stock program aliases as available neutral evidence', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      candidates: [
        baseCandidate({ prgm_buy_amt: '40', prgm_sell_amt: '40' }),
        baseCandidate({ symbol: '123457', stockPrgmNetBuy: 0, foreignNetBuyAmount: 0, institutionNetBuyAmount: 0 }),
      ] as any,
    });

    expect(preview.candidates[0]?.programFlow?.stockLevel.netBuy).toBe(0);
    expect(preview.candidates[0]?.programFlow?.stockLevel.available).toBe(true);
    expect(preview.candidates[0]?.programFlow?.stockLevel.signal).toBe('NEUTRAL');
    expect(preview.candidates[1]?.programFlow?.stockLevel.netBuy).toBe(0);
    expect(preview.candidates[1]?.programFlow?.stockLevel.signal).toBe('NEUTRAL');
    expect(preview.fieldAvailability.stockProgramRowsAvailable).toBe(2);
  });

  it('discovers market program flow from existing nested candidate diagnostic context without provider calls', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      candidates: [{
        ...baseCandidate(),
        diagnosticContext: {
          programTrading: {
            scoring: {
              combinedProgramNetBuy: '-2,000',
              sourceProvider: 'SNAPSHOT',
            },
          },
        },
      }] as any,
    });

    expect(preview.fieldAvailability.marketProgramAvailable).toBe(true);
    expect(preview.fieldAvailability.marketProgramSignal).toBe('BEARISH');
    expect(preview.fieldAvailability.marketProgramSource).toBe('SNAPSHOT');
    expect(preview.fieldAvailability.providerCallsAdded).toBe(0);
    expect(preview.candidates[0]?.activePassiveConfluence).toBe('MIXED_FLOW');
  });

  it('prints passive proxy availability context flags and keeps provider calls at zero', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      marketProgramFlow: { marketProgramStatus: 'EMPTY' },
      candidates: [baseCandidate({ program_net_amount: 'N/A' })] as any,
    });

    const text = formatNormalSupplyPreviewFullSections(preview).join('\n');
    expect(preview.programFlowDiagnostics.reason).toBe('PROGRAM_FLOW_EXPECTED_BUT_VALUE_MISSING_DIAGNOSTIC_ONLY');
    expect(preview.programFlowDiagnostics.nextAction).toBe('CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER');
    expect(text).toContain('Program Passive Proxy Availability');
    expect(text).toContain('stockProgramRowsAvailable: 0/1');
    expect(text).toContain('contextFound: true');
    expect(text).toContain('wiredButNoFields: false');
    expect(text).toContain('providerCallsAdded=0');
    expect(text).toContain('passiveProxyUsedForLiveDecision=false');
  });

  it('keeps accepted-empty market program diagnostics out of consumer parse failure', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      marketProgramFlow: {
        available: false,
        source: 'NONE',
        sourceProvider: 'NONE',
        netBuyAmount: null,
        combinedNetBuy: null,
        providerIssue: false,
        signal: 'UNAVAILABLE',
        marketSignal: false,
        marketProgramDataStatus: 'ACCEPTED_EMPTY',
        kisAttempted: true,
        kisStatus: 'ACCEPTED_EMPTY',
        krxFallbackAttempted: true,
        krxFallbackStatus: 'EMPTY',
        cacheFallbackAttempted: true,
        cacheStatus: 'MISS',
        executionImpact: 'NONE',
        programFlowUsedForLiveDecision: false,
        passiveProxyUsedForLiveDecision: false,
        programPenaltyApplied: false,
      },
      candidates: [baseCandidate()] as any,
    });

    const text = formatNormalSupplyPreviewFullSections(preview).join('\n');
    expect(preview.programFlowDiagnostics.marketProgramAvailable).toBe(false);
    expect(preview.programFlowDiagnostics.marketProgramSignal).toBe('UNAVAILABLE');
    expect(preview.programFlowDiagnostics.marketProgramSource).toBe('NONE');
    expect(preview.programFlowDiagnostics.marketProgramProviderIssue).toBe(false);
    expect(preview.programFlowDiagnostics.marketProgramDataStatus).toBe('ACCEPTED_EMPTY');
    expect(preview.programFlowDiagnostics.kisStatus).toBe('ACCEPTED_EMPTY');
    expect(preview.programFlowDiagnostics.krxFallbackStatus).toBe('EMPTY');
    expect(preview.programFlowDiagnostics.cacheStatus).toBe('MISS');
    expect(preview.programFlowDiagnostics.marketProgramBreakPoint).toBe('KIS_ACCEPTED_EMPTY_KRX_EMPTY_CACHE_MISS');
    expect(preview.programFlowDiagnostics.marketProgramReason).toBe('MARKET_PROGRAM_EMPTY_VALID_DIAGNOSTIC_ONLY');
    expect(preview.programFlowDiagnostics.marketProgramBreakPoint).not.toBe('MARKET_PROGRAM_CONSUMER_PARSE_FAILED');
    expect(preview.programFlowDiagnostics.programMissingAsBearish).toBe(false);
    expect(preview.programFlowDiagnostics.programPenaltyApplied).toBe(false);
    expect(preview.programFlowDiagnostics.programFlowUsedForLiveDecision).toBe(false);
    expect(preview.programFlowDiagnostics.passiveProxyUsedForLiveDecision).toBe(false);
    expect(preview.programFlowDiagnostics.executionImpact).toBe('NONE');
    expect(preview.strongBuyAllowed).toBe(false);
    expect(preview.realOrderAllowed).toBe(false);
    expect(text).toContain('marketProgramBreakPoint=KIS_ACCEPTED_EMPTY_KRX_EMPTY_CACHE_MISS');
    expect(text).toContain('marketProgramReason=MARKET_PROGRAM_EMPTY_VALID_DIAGNOSTIC_ONLY');
    expect(text).toContain('marketProgramSignal: UNAVAILABLE');
  });

  it('classifies after-market accepted-empty market program as session-based unavailable while carrying stock diagnostics', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T07:31:00.000Z',
      marketProgramFlow: {
        available: false,
        source: 'NONE',
        sourceProvider: 'NONE',
        netBuyAmount: null,
        combinedNetBuy: null,
        providerIssue: false,
        signal: 'UNAVAILABLE',
        marketSignal: false,
        marketProgramDataStatus: 'ACCEPTED_EMPTY',
        kisAttempted: true,
        kisStatus: 'ACCEPTED_EMPTY',
        krxFallbackAttempted: true,
        krxFallbackStatus: 'EMPTY',
        cacheFallbackAttempted: true,
        cacheStatus: 'MISS',
        executionImpact: 'NONE',
        programFlowUsedForLiveDecision: false,
        passiveProxyUsedForLiveDecision: false,
        programPenaltyApplied: false,
      },
      candidates: [{
        ...baseCandidate({ programNetBuyAmount: null }),
        latestIntradayProgramSnapshot: {
          stockProgramRows: [{ stockCode: '123456', stockProgramNetBuy: '1,234' }],
        },
      }] as any,
    });

    const text = formatNormalSupplyPreviewFullSections(preview).join('\n');
    expect(preview.programFlowDiagnostics.sessionGuard.marketSession).toBe('AFTER_MARKET');
    expect(preview.programFlowDiagnostics.sessionGuard.kstTime).toBe('16:31');
    expect(preview.programFlowDiagnostics.programFlowExpected).toBe(false);
    expect(preview.programFlowDiagnostics.marketProgramDataStatus).toBe('NOT_EXPECTED_AFTER_MARKET');
    expect(preview.programFlowDiagnostics.marketProgramReason).toBe('MARKET_CLOSED_NO_INTRADAY_PROGRAM_FLOW_EXPECTED');
    expect(preview.programFlowDiagnostics.marketProgramBreakPoint).toBe('PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED');
    expect(preview.programFlowDiagnostics.marketProgramProviderIssue).toBe(false);
    expect(preview.programFlowDiagnostics.providerIssueSuppressedByMarketClosed).toBe(true);
    expect(preview.candidates[0]?.programFlow?.stockLevel.available).toBe(true);
    expect(preview.candidates[0]?.programFlow?.stockLevel.netBuy).toBe(1234);
    expect(preview.programFlowDiagnostics.stockProgramRowsAvailable).toBe(1);
    expect(preview.programFlowDiagnostics.programMissingAsBearish).toBe(false);
    expect(preview.programFlowDiagnostics.programPenaltyApplied).toBe(false);
    expect(preview.programFlowDiagnostics.programFlowUsedForLiveDecision).toBe(false);
    expect(preview.programFlowDiagnostics.passiveProxyUsedForLiveDecision).toBe(false);
    expect(preview.programFlowDiagnostics.executionImpact).toBe('NONE');
    expect(text).toContain('marketProgramDataStatus: NOT_EXPECTED_AFTER_MARKET');
    expect(text).toContain('marketProgramReason=MARKET_CLOSED_NO_INTRADAY_PROGRAM_FLOW_EXPECTED');
  });

  it('traces context found with no program fields to upstream numeric field wiring', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [baseCandidate()] as any,
    });

    expect(preview.programFlowDiagnostics.contextFound).toBe(true);
    expect(preview.programFlowDiagnostics.wiredButNoFields).toBe(true);
    expect(preview.programFlowDiagnostics.reason).toBe('PROGRAM_FLOW_EXPECTED_BUT_VALUE_MISSING_DIAGNOSTIC_ONLY');
    expect(preview.programFlowDiagnostics.nextAction).toBe('CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER');
    expect(preview.programFlowDiagnostics.stockProgramBreakPoint).toBe('STOCK_PROGRAM_SNAPSHOT_MISSING');
    expect(preview.programFlowDiagnostics.programMissingAsBearish).toBe(false);
  });

  it('reports no context when neither stock candidates nor market program context exist', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [] as any,
    });

    expect(preview.programFlowDiagnostics.contextFound).toBe(false);
    expect(preview.programFlowDiagnostics.reason).toBe('PROGRAM_FLOW_EXPECTED_BUT_VALUE_MISSING_DIAGNOSTIC_ONLY');
    expect(preview.programFlowDiagnostics.nextAction).toBe('CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER');
    expect(preview.programFlowDiagnostics.programMissingAsBearish).toBe(false);
  });

  it('traces non-numeric stock program aliases as all-NA diagnostic evidence', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [baseCandidate({ programNetBuy: 'N/A' })] as any,
    });

    expect(preview.programFlowDiagnostics.stockProgramRowsWithAnyProgramKey).toBe(1);
    expect(preview.programFlowDiagnostics.stockProgramRowsWithNumericProgramValue).toBe(0);
    expect(preview.programFlowDiagnostics.reason).toBe('PROGRAM_FLOW_EXPECTED_BUT_VALUE_MISSING_DIAGNOSTIC_ONLY');
    expect(preview.programFlowDiagnostics.nextAction).toBe('CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER');
    expect(preview.programFlowDiagnostics.programPenaltyApplied).toBe(false);
  });

  it('prints evidence trace counts in full output', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      marketProgramFlow: { marketProgramStatus: 'EMPTY' },
      candidates: [baseCandidate({ programNetBuy: '1,234' })] as any,
    });

    const text = formatNormalSupplyPreviewFullSections(preview).join('\n');
    expect(text).toContain('stockProgramRowsWithAnyProgramKey: 1/1');
    expect(text).toContain('stockProgramRowsWithNumericProgramValue: 1/1');
    expect(text).toContain('marketProgramContextFound: true');
    expect(text).toContain('marketProgramStatusFieldsFound: marketProgramStatus');
    expect(text).toContain('executionImpact=NONE');
  });

  it('normalizes stock wrapper program values and reports reason distribution in full output', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      candidates: [baseCandidate({ programNetBuyAmount: { value: '1,234' } })] as any,
    });

    expect(preview.candidates[0]?.programFlow?.stockLevel.available).toBe(true);
    expect(preview.candidates[0]?.programFlow?.stockLevel.netBuy).toBe(1234);
    expect(preview.programFlowDiagnostics.stockProgramRowsWithParsableProgramValue).toBe(1);
    expect(preview.programFlowDiagnostics.stockProgramValueReasonTop).toContain('PROGRAM_VALUE_OBJECT_WRAPPER=1');
    const text = formatNormalSupplyPreviewFullSections(preview).join('\n');
    expect(text).toContain('stockProgramRowsWithParsableProgramValue: 1/1');
    expect(text).toContain('stockProgramValueReasonDistribution: PROGRAM_VALUE_OBJECT_WRAPPER=1');
    expect(text).toContain('stockProgramSanitizedSampleTop: 1. "programNetBuyAmount=1,234"');
  });

  it('records explicit null diagnostics when a stock program key exists with undefined value', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [baseCandidate({ programNetBuyAmount: undefined })] as any,
    });

    expect(preview.programFlowDiagnostics.stockProgramRowsWithAnyProgramKey).toBe(1);
    expect(preview.programFlowDiagnostics.stockProgramRowsWithParsableProgramValue).toBe(0);
    expect(preview.programFlowDiagnostics.stockProgramValueReasonDistribution).toEqual({
      PROGRAM_VALUE_NULL: 1,
    });
    expect(preview.programFlowDiagnostics.stockProgramSanitizedSampleTop).toEqual([
      'programNetBuyAmount=null',
    ]);
    expect(preview.programFlowDiagnostics.reason).toBe('PROGRAM_FLOW_EXPECTED_BUT_VALUE_MISSING_DIAGNOSTIC_ONLY');
    expect(preview.programFlowDiagnostics.nextAction).toBe('CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER');
    expect(preview.programFlowDiagnostics.stockProgramBreakPoint).toBe('STOCK_PROGRAM_SNAPSHOT_MISSING');
    const text = formatNormalSupplyPreviewFullSections(preview).join('\n');
    expect(text).toContain('stockProgramValueReasonDistribution: PROGRAM_VALUE_NULL=1');
    expect(text).toContain('stockProgramSanitizedSampleTop: 1. "programNetBuyAmount=null"');
  });

  it('carries stock program value from latest intraday snapshot without live score impact', () => {
    const withoutProgram = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      candidates: [baseCandidate({ programNetBuyAmount: null })] as any,
    });
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [{
        ...baseCandidate({ programNetBuyAmount: null }),
        latestIntradayProgramSnapshot: {
          stockProgramRows: [{ stockCode: '123456', stockProgramNetBuy: '1,234' }],
        },
      }] as any,
    });

    const candidate = preview.candidates[0]!;
    expect(candidate.programFlow?.stockLevel.available).toBe(true);
    expect(candidate.programFlow?.stockLevel.netBuy).toBe(1234);
    expect(candidate.programFlow?.stockLevel.sourceProvider).toBe('SNAPSHOT');
    expect(candidate.activePassiveConfluence).toBe('ACTIVE_PASSIVE_CONFIRMED_BUY');
    expect(candidate.programFlowDryRun.appliedToLiveScore).toBe(false);
    expect(candidate.supplyScore).toBe(withoutProgram.candidates[0]?.supplyScore);
    expect(preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carrySource).toBe('LATEST_INTRADAY_PROGRAM_SNAPSHOT');
    expect(preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carrySuccessCount).toBe(1);
    expect(preview.programFlowDiagnostics.stockProgramRowsAvailable).toBe(1);
    expect(preview.programFlowDiagnostics.programFlowUsedForLiveDecision).toBe(false);
    expect(preview.programFlowDiagnostics.executionImpact).toBe('NONE');
  });

  it('wires stock-level program net buy snapshot values into candidate context aliases without live impact', () => {
    saveLatestIntradayProgramFlowSnapshot({
      snapshotId: 'ipfs-context-alias-test',
      snapshotKind: 'INTRADAY_PROGRAM_FLOW_SNAPSHOT',
      capturedAt: '2026-05-15T06:00:00.000Z',
      capturedAtKst: '2026-05-15 15:00:00 KST',
      marketDate: '2026-05-15',
      timezone: 'Asia/Seoul',
      source: 'RUNTIME_PROGRAM_FLOW',
      replayOnly: true,
      diagnosticOnly: true,
      executionImpact: 'NONE',
      stockRows: [
        {
          symbol: '004020',
          normalizedSymbol: '004020',
          name: '현대제철',
          programNetBuyAmount: -16_044_352_900,
          sourceProvider: 'SNAPSHOT',
          dataStatus: 'VERIFIED',
          providerIssue: false,
          marketSignal: true,
          reason: 'PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY',
        },
        {
          symbol: '017670',
          normalizedSymbol: '017670',
          name: 'SK텔레콤',
          programNetBuyAmount: 3_016_097_650,
          sourceProvider: 'SNAPSHOT',
          dataStatus: 'VERIFIED',
          providerIssue: false,
          marketSignal: true,
          reason: 'PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY',
        },
      ],
      marketProgram: {
        available: false,
        marketProgramNetBuy: null,
        combinedProgramNetBuy: null,
        signal: 'UNAVAILABLE',
        sourceProvider: 'NONE',
        dataStatus: 'MISSING',
        providerIssue: false,
        marketSignal: false,
        reason: 'PROGRAM_FLOW_NOT_WIRED_OR_NOT_AVAILABLE',
      },
      summary: {
        stockRowsTotal: 2,
        stockRowsWithProgramValue: 2,
        marketProgramAvailable: false,
        providerCallsAdded: 0,
      },
      sanitize: {
        applied: true,
        rawPayloadStored: false,
        removedSensitiveFields: [],
      },
    });
    const hyundai = { ...baseCandidate({ symbol: '004020', programNetBuyAmount: null }), code: '004020', name: '현대제철' };
    const skTelecom = { ...baseCandidate({ symbol: '017670', programNetBuyAmount: null }), code: '017670', name: 'SK텔레콤' };
    const missing = { ...baseCandidate({ symbol: '000660', programNetBuyAmount: null }), code: '000660', name: 'SK하이닉스' };

    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [hyundai, skTelecom, missing] as any,
    });

    expect(preview.programFlowDiagnostics.stockCarryTrace.candidateContextProgramNetBuyAmountFieldCreated).toBe(3);
    expect(preview.programFlowDiagnostics.stockCarryTrace.candidateContextProgramNetBuyAmountNonNull).toBe(2);
    expect(preview.programFlowDiagnostics.stockCarryTrace.stockProgramBreakPoint).toBe('OK_STOCK_PROGRAM_CONTEXT_WIRED');
    expect((hyundai as any).stockProgramNetBuyAmount).toBe(-16_044_352_900);
    expect((hyundai as any).stockProgramNetBuy).toBe(-16_044_352_900);
    expect((hyundai as any).programNetBuy).toBe(-16_044_352_900);
    expect((hyundai as any).programNetBuyAmount).toBe(-16_044_352_900);
    expect((skTelecom as any).stockProgramNetBuyAmount).toBe(3_016_097_650);
    expect((skTelecom as any).stockProgramNetBuy).toBe(3_016_097_650);
    expect((skTelecom as any).programNetBuy).toBe(3_016_097_650);
    expect((skTelecom as any).programNetBuyAmount).toBe(3_016_097_650);
    expect((missing as any).stockProgramNetBuyAmount).toBeUndefined();
    expect(preview.candidates.find((candidate) => candidate.symbol === '004020')?.stockProgramNetBuyAmount).toBe(-16_044_352_900);
    expect(preview.candidates.find((candidate) => candidate.symbol === '017670')?.stockProgramNetBuyAmount).toBe(3_016_097_650);
    expect(preview.programFlowDiagnostics.programFlowUsedForLiveDecision).toBe(false);
    expect(preview.programFlowDiagnostics.passiveProxyUsedForLiveDecision).toBe(false);
    expect(preview.programFlowDiagnostics.programPenaltyApplied).toBe(false);
    expect(preview.programFlowDiagnostics.programMissingAsBearish).toBe(false);
    expect(preview.executionImpact).toBe('NONE');
    expect(preview.strongBuyAllowed).toBe(false);
    expect(preview.programFlowDiagnostics.providerCallsAdded).toBe(0);
  });

  it('carries stock and market program values from latest intraday program flow snapshot without provider calls', () => {
    saveLatestIntradayProgramFlowSnapshot({
      snapshotId: 'ipfs-test',
      snapshotKind: 'INTRADAY_PROGRAM_FLOW_SNAPSHOT',
      capturedAt: '2026-05-15T06:00:00.000Z',
      capturedAtKst: '2026-05-15 15:00:00 KST',
      marketDate: '2026-05-15',
      timezone: 'Asia/Seoul',
      source: 'RUNTIME_PROGRAM_FLOW',
      replayOnly: true,
      diagnosticOnly: true,
      executionImpact: 'NONE',
      stockRows: [{
        symbol: '123456',
        normalizedSymbol: '123456',
        programNetBuyAmount: 1234,
        sourceProvider: 'SNAPSHOT',
        dataStatus: 'VERIFIED',
        providerIssue: false,
        marketSignal: true,
        reason: 'PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY',
      }],
      marketProgram: {
        available: true,
        marketProgramNetBuy: 10000,
        combinedProgramNetBuy: 10000,
        signal: 'BULLISH',
        sourceProvider: 'SNAPSHOT',
        dataStatus: 'VERIFIED',
        providerIssue: false,
        marketSignal: true,
        reason: 'PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY',
      },
      summary: {
        stockRowsTotal: 1,
        stockRowsWithProgramValue: 1,
        marketProgramAvailable: true,
        providerCallsAdded: 0,
      },
      sanitize: {
        applied: true,
        rawPayloadStored: false,
        removedSensitiveFields: [],
      },
    });

    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      marketProgramFlow: { marketProgramNetBuy: null },
      candidates: [baseCandidate({ programNetBuyAmount: null })] as any,
    });

    expect(preview.candidates[0]?.programFlow?.stockLevel.available).toBe(true);
    expect(preview.candidates[0]?.programFlow?.stockLevel.netBuy).toBe(1234);
    expect(preview.fieldAvailability.marketProgramAvailable).toBe(true);
    expect(preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carrySource).toBe('LATEST_INTRADAY_PROGRAM_FLOW_SNAPSHOT');
    expect(preview.programFlowDiagnostics.upstreamPopulation.marketLevel.carrySource).toBe('LATEST_INTRADAY_MARKET_PROGRAM_SNAPSHOT');
    expect(preview.programFlowDiagnostics.providerCallsAdded).toBe(0);
    expect(preview.programFlowDiagnostics.passiveProxyUsedForLiveDecision).toBe(false);
    expect(preview.programFlowDiagnostics.executionImpact).toBe('NONE');
  });

  it('carries stock program value from supply snapshot cache as diagnostic-only passive proxy', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [{
        ...baseCandidate({ programNetBuyAmount: null }),
        cache: {
          stockProgramRows: [{ stockCode: '123456', programNetBuy: '-1,234' }],
        },
      }] as any,
    });

    const candidate = preview.candidates[0]!;
    expect(candidate.programFlow?.stockLevel.available).toBe(true);
    expect(candidate.programFlow?.stockLevel.netBuy).toBe(-1234);
    expect(candidate.programFlow?.stockLevel.signal).toBe('BEARISH');
    expect(candidate.programFlow?.stockLevel.sourceProvider).toBe('CACHE');
    expect(candidate.activePassiveConfluence).toBe('MIXED_FLOW');
    expect(candidate.programFlowDryRun.appliedToLiveScore).toBe(false);
    expect(preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carrySource).toBe('SUPPLY_SNAPSHOT_CACHE');
    expect(preview.programFlowDiagnostics.programPenaltyApplied).toBe(false);
  });

  it('carries stock program value from program trading diagnostic context', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [{
        ...baseCandidate({ programNetBuyAmount: null }),
        programTrading: {
          rows: [{ stockCode: '123456', programNetBuy: 500 }],
        },
      }] as any,
    });

    expect(preview.candidates[0]?.programFlow?.stockLevel.available).toBe(true);
    expect(preview.candidates[0]?.programFlow?.stockLevel.netBuy).toBe(500);
    expect(preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carrySource).toBe('PROGRAM_TRADING_DIAGNOSTIC');
    expect(preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carrySuccessCount).toBe(1);
  });

  it('carries market program value from latest intraday market snapshot', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      marketProgramFlow: {
        marketProgramNetBuy: null,
        latestIntradayMarketProgramSnapshot: { combinedProgramNetBuy: 10000 },
      },
      candidates: [baseCandidate()] as any,
    });

    expect(preview.fieldAvailability.marketProgramAvailable).toBe(true);
    expect(preview.fieldAvailability.marketProgramSignal).toBe('BULLISH');
    expect(preview.fieldAvailability.marketProgramSource).toBe('SNAPSHOT');
    expect(preview.programFlowDiagnostics.upstreamPopulation.marketLevel.carrySource).toBe('LATEST_INTRADAY_MARKET_PROGRAM_SNAPSHOT');
    expect(preview.programFlowDiagnostics.reason).toBe('PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY');
    expect(preview.programFlowDiagnostics.passiveProxyUsedForLiveDecision).toBe(false);
  });

  it('carries market program value from program market cache', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      marketProgramFlow: {
        marketProgramNetBuy: null,
        programMarketCache: { programMarketNetBuy: -10000 },
      },
      candidates: [baseCandidate()] as any,
    });

    expect(preview.fieldAvailability.marketProgramAvailable).toBe(true);
    expect(preview.fieldAvailability.marketProgramSignal).toBe('BEARISH');
    expect(preview.fieldAvailability.marketProgramSource).toBe('CACHE');
    expect(preview.programFlowDiagnostics.upstreamPopulation.marketLevel.carrySource).toBe('PROGRAM_MARKET_CACHE');
    expect(preview.programFlowDiagnostics.programPenaltyApplied).toBe(false);
  });

  it('reports snapshot value null when snapshot structure exists without numeric values', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [{
        ...baseCandidate({ programNetBuyAmount: null }),
        latestIntradayProgramSnapshot: {
          stockProgramRows: [{ stockCode: '123456', stockProgramNetBuy: null }],
        },
      }] as any,
    });

    expect(preview.programFlowDiagnostics.reason).toBe('PROGRAM_FLOW_EXPECTED_BUT_VALUE_MISSING_DIAGNOSTIC_ONLY');
    expect(preview.programFlowDiagnostics.nextAction).toBe('CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER');
    expect(preview.programFlowDiagnostics.upstreamPopulation.stockLevel.breakPoint).toBe('SNAPSHOT_PROGRAM_VALUE_NULL');
    expect(preview.programFlowDiagnostics.programMissingAsBearish).toBe(false);
  });

  it('reports cache value not carried when cache rows exist for another symbol', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [{
        ...baseCandidate({ programNetBuyAmount: null }),
        cache: {
          stockProgramRows: [{ stockCode: '999999', programNetBuy: 1234 }],
        },
      }] as any,
    });

    expect(preview.programFlowDiagnostics.reason).toBe('PROGRAM_FLOW_EXPECTED_BUT_VALUE_MISSING_DIAGNOSTIC_ONLY');
    expect(preview.programFlowDiagnostics.nextAction).toBe('CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER');
    expect(preview.programFlowDiagnostics.upstreamPopulation.stockLevel.cacheProgramRowsWithValue).toBe(1);
    expect(preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carrySuccessCount).toBe(0);
    expect(preview.signalCounts.BEARISH).toBe(0);
    expect(preview.activePassiveConfluenceCounts.ACTIVE_PASSIVE_CONFIRMED_BUY).toBe(0);
    expect(preview.activePassiveConfluenceCounts.PASSIVE_BUYING_ONLY).toBe(0);
  });

  it('keeps stock program parse failures unavailable without bearish or penalty contamination', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [baseCandidate({ programNetBuyAmount: '매수우위' })] as any,
    });

    expect(preview.candidates[0]?.programFlow?.stockLevel.available).toBe(false);
    expect(preview.candidates[0]?.programFlow?.stockLevel.valueIssue).toBe(true);
    expect(preview.candidates[0]?.programFlow?.stockLevel.valueReason).toBe('PROGRAM_VALUE_UNSUPPORTED_FORMAT');
    expect(preview.candidates[0]?.programMissingAsBearish).toBe(false);
    expect(preview.programFlowDiagnostics.programPenaltyApplied).toBe(false);
    expect(preview.programFlowDiagnostics.reason).toBe('PROGRAM_FLOW_EXPECTED_BUT_VALUE_MISSING_DIAGNOSTIC_ONLY');
    expect(preview.programFlowDiagnostics.nextAction).toBe('CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER');
  });

  it('normalizes market string program flow and keeps market parse failure non-directional', () => {
    const success = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      marketProgramFlow: { marketProgramNetBuy: '-5,000', sourceProvider: 'CACHE' },
      candidates: [baseCandidate()] as any,
    });
    expect(success.fieldAvailability.marketProgramAvailable).toBe(true);
    expect(success.fieldAvailability.marketProgramSignal).toBe('BEARISH');
    expect(success.fieldAvailability.marketProgramMarketSignal).toBe(true);
    expect(success.programFlowDiagnostics.marketProgramValueReasonTop).toContain('PROGRAM_VALUE_COMMA_NUMERIC_STRING=1');

    const failure = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      marketProgramFlow: { marketProgramNetBuy: 'UNKNOWN' },
      candidates: [baseCandidate()] as any,
    });
    expect(failure.fieldAvailability.marketProgramAvailable).toBe(false);
    expect(failure.fieldAvailability.marketProgramMarketSignal).toBe(false);
    expect(failure.fieldAvailability.marketProgramProviderIssue).toBe(false);
    expect(failure.signalCounts.BEARISH).toBe(0);
  });

  it('classifies weekend null program flow as expected empty with safety flags preserved', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-16T03:00:00.000Z',
      candidates: [baseCandidate({ programNetBuyAmount: null })] as any,
    });

    expect(preview.programFlowDiagnostics.sessionGuard.marketSession).toBe('WEEKEND');
    expect(preview.programFlowDiagnostics.programFlowExpected).toBe(false);
    expect(preview.programFlowDiagnostics.reason).toBe('PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED');
    expect(preview.programFlowDiagnostics.nextAction).toBe('RETRY_DURING_REGULAR_SESSION');
    expect(preview.programFlowDiagnostics.providerIssueSuppressedByMarketClosed).toBe(true);
    expect(preview.programFlowDiagnostics.programNetBuyNullRootCause).toBe('SESSION_EXPECTED_EMPTY');
    expect(preview.programFlowDiagnostics.providerCallsAdded).toBe(0);
    expect(preview.programFlowDiagnostics.programMissingAsBearish).toBe(false);
    expect(preview.programFlowDiagnostics.programPenaltyApplied).toBe(false);
    expect(preview.programFlowDiagnostics.programFlowUsedForLiveDecision).toBe(false);
    expect(preview.programFlowDiagnostics.passiveProxyUsedForLiveDecision).toBe(false);
    expect(preview.programFlowDiagnostics.executionImpact).toBe('NONE');
  });

  it('traces regular-session market program carry from macroState payload', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      marketProgramCarrySource: {
        programNetBuyAmount: 1000,
        programArbitrageNetBuy: 50,
        programFetchedAt: '2026-05-15T00:59:00.000Z',
        programSource: 'KIS_API',
      },
      marketProgramFlow: {
        marketProgramNetBuy: 1000,
        sourceProvider: 'KIS_API',
        executionImpact: 'NONE',
        providerIssue: false,
        marketSignal: false,
      },
      candidates: [baseCandidate({ programNetBuyAmount: null })] as any,
    });

    expect(preview.programFlowDiagnostics.programFlowExpected).toBe(true);
    expect(preview.programFlowDiagnostics.marketCarryTrace.macroStateFound).toBe(true);
    expect(preview.programFlowDiagnostics.marketCarryTrace.macroStateProgramNetBuyAmountPresent).toBe(true);
    expect(preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowPayloadPresent).toBe(true);
    expect(preview.fieldAvailability.marketProgramAvailable).toBe(true);
    expect(preview.programFlowDiagnostics.marketProgramBreakPoint).toBe('MARKET_PROGRAM_VALUE_CARRIED_DIAGNOSTIC_ONLY');
    expect(preview.programFlowDiagnostics.nextAction).toBe('OBSERVE_DIAGNOSTIC_ONLY');
  });

  it('traces regular-session per-stock snapshot carry and consumer parsing', () => {
    saveLatestIntradayProgramFlowSnapshot(buildIntradayProgramFlowSnapshotFromRuntimeContext({
      stockRows: [{ symbol: '123456', programNetBuyAmount: 777, sourceProvider: 'KIS_API' }],
    }, new Date('2026-05-15T00:59:00.000Z')));

    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [{
        ...baseCandidate({ programNetBuyAmount: null }),
        stockProgramFlow: { symbol: '123456', programNetBuyAmount: 777, sourceProvider: 'SNAPSHOT' },
      }] as any,
    });

    expect(preview.programFlowDiagnostics.stockCarryTrace.latestSnapshotFound).toBe(true);
    expect(preview.programFlowDiagnostics.stockCarryTrace.latestSnapshotStockRowsWithProgramValue).toBe(1);
    expect(preview.programFlowDiagnostics.stockCarryTrace.perStockCarryMapSize).toBeGreaterThan(0);
    expect(preview.programFlowDiagnostics.stockCarryTrace.candidateStockProgramFlowAttached).toBe(1);
    expect(preview.programFlowDiagnostics.stockCarryTrace.consumerParsedStockProgramRows).toBe(1);
    expect(preview.programFlowDiagnostics.stockCarryTrace.stockCarrySource).toBe('LATEST_INTRADAY_PROGRAM_FLOW_SNAPSHOT');
    expect(preview.programFlowDiagnostics.providerCallsAdded).toBe(0);
  });

  it('routes snapshot rows with values but no symbol match to CHECK_PER_STOCK_SYMBOL_MATCHING', () => {
    saveLatestIntradayProgramFlowSnapshot(buildIntradayProgramFlowSnapshotFromRuntimeContext({
      stockRows: [{ symbol: '999999', programNetBuyAmount: 777, sourceProvider: 'KIS_API' }],
    }, new Date('2026-05-15T00:59:00.000Z')));

    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [baseCandidate({ programNetBuyAmount: null })] as any,
    });

    expect(preview.programFlowDiagnostics.stockCarryTrace.latestSnapshotStockRowsWithProgramValue).toBe(1);
    expect(preview.programFlowDiagnostics.stockCarryTrace.candidateStockProgramFlowAttached).toBe(0);
    expect(preview.programFlowDiagnostics.stockProgramBreakPoint).toBe('STOCK_PROGRAM_SYMBOL_MATCHING_FAILED');
    expect(preview.programFlowDiagnostics.programNetBuyNullRootCause).toBe('SYMBOL_MATCH_FAILED');
    expect(preview.programFlowDiagnostics.nextAction).toBe('CHECK_PER_STOCK_SYMBOL_MATCHING');
  });

  it('routes attached stockProgramFlow parse failures to CHECK_STOCK_PROGRAM_CONSUMER_PARSE', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [{
        ...baseCandidate({ programNetBuyAmount: null }),
        stockProgramFlow: { symbol: '123456', programNetBuyAmount: '매수우위', sourceProvider: 'KIS_API' },
      }] as any,
    });

    expect(preview.programFlowDiagnostics.stockCarryTrace.candidateStockProgramFlowAttached).toBe(1);
    expect(preview.programFlowDiagnostics.stockCarryTrace.consumerParsedStockProgramRows).toBe(0);
    expect(preview.programFlowDiagnostics.stockProgramBreakPoint).toBe('STOCK_PROGRAM_CONSUMER_PARSE_FAILED');
    expect(preview.programFlowDiagnostics.programNetBuyNullRootCause).toBe('CONSUMER_PARSE_FAILED');
    expect(preview.programFlowDiagnostics.nextAction).toBe('CHECK_STOCK_PROGRAM_CONSUMER_PARSE');
  });

  it('routes regular-session all-null program flow to producer population diagnostics only', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'NORMAL',
      source: 'COMMAND',
      capturedAt: '2026-05-15T01:00:00.000Z',
      candidates: [baseCandidate({ programNetBuyAmount: null })] as any,
    });

    expect(preview.programFlowDiagnostics.programFlowExpected).toBe(true);
    expect(preview.programFlowDiagnostics.reason).toBe('PROGRAM_FLOW_EXPECTED_BUT_VALUE_MISSING_DIAGNOSTIC_ONLY');
    expect(preview.programFlowDiagnostics.nextAction).toBe('CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER');
    expect(preview.programFlowDiagnostics.programNetBuyNullRootCause).toBe('SNAPSHOT_MISSING');
    expect(preview.signalCounts.BEARISH).toBe(0);
    expect(preview.programFlowDiagnostics.programMissingAsBearish).toBe(false);
    expect(preview.programFlowDiagnostics.programPenaltyApplied).toBe(false);
    expect(preview.programFlowDiagnostics.programFlowUsedForLiveDecision).toBe(false);
    expect(preview.programFlowDiagnostics.passiveProxyUsedForLiveDecision).toBe(false);
    expect(preview.programFlowDiagnostics.executionImpact).toBe('NONE');
  });

  it('keeps MARKET_PROGRAM_CARRY_WIRING_DISABLED as legacy fallback with no execution impact', () => {
    process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED = 'true';
    try {
      const preview = persistNormalSupplyPreview({
        engineMode: 'NORMAL',
        source: 'COMMAND',
        capturedAt: '2026-05-15T01:00:00.000Z',
        marketProgramCarrySource: { programNetBuyAmount: 1000, programSource: 'KIS_API' },
        candidates: [baseCandidate({ programNetBuyAmount: null })] as any,
      });

      expect(preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowPayloadPresent).toBe(false);
      expect(preview.programFlowDiagnostics.marketProgramBreakPoint).toBe('MARKET_PROGRAM_CARRY_PAYLOAD_MISSING');
      expect(preview.programFlowDiagnostics.executionImpact).toBe('NONE');
      expect(preview.programFlowDiagnostics.providerCallsAdded).toBe(0);
    } finally {
      delete process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED;
    }
  });

  it('keeps PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED as legacy fallback with no extra provider calls', () => {
    process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED = 'true';
    try {
      saveLatestIntradayProgramFlowSnapshot(buildIntradayProgramFlowSnapshotFromRuntimeContext({
        stockRows: [{ symbol: '123456', programNetBuyAmount: 777, sourceProvider: 'KIS_API' }],
      }, new Date('2026-05-15T00:59:00.000Z')));

      const preview = persistNormalSupplyPreview({
        engineMode: 'NORMAL',
        source: 'COMMAND',
        capturedAt: '2026-05-15T01:00:00.000Z',
        candidates: [baseCandidate({ programNetBuyAmount: null })] as any,
      });

      expect(preview.programFlowDiagnostics.stockCarryTrace.candidateStockProgramFlowAttached).toBe(0);
      expect(preview.programFlowDiagnostics.stockCarryTrace.consumerParsedStockProgramRows).toBe(1);
      expect(preview.programFlowDiagnostics.providerCallsAdded).toBe(0);
      expect(preview.programFlowDiagnostics.executionImpact).toBe('NONE');
    } finally {
      delete process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED;
    }
  });


});
