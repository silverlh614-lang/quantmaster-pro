import { describe, expect, it, beforeEach } from 'vitest';
import {
  __resetNormalSupplyPreviewForTests,
  classifySupplySignal,
  deriveNormalSupplyPreviewEngineMode,
  formatNormalSupplyPreviewFullSections,
  formatNormalSupplyPreviewSection,
  getLastNormalSupplyPreview,
  persistNormalSupplyPreview,
} from './normalSupplyPreview.js';

describe('Normal Supply Preview under SELL_ONLY', () => {
  beforeEach(() => {
    __resetNormalSupplyPreviewForTests();
  });

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
              executionImpact: 'SCORE_CONFIDENCE_DOWN_ONLY',
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
              executionImpact: 'SCORE_CONFIDENCE_DOWN_ONLY',
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
              executionImpact: 'SCORE_CONFIDENCE_DOWN_ONLY',
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
});
