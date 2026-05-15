import { describe, expect, it, beforeEach } from 'vitest';
import {
  __resetNormalSupplyPreviewForTests,
  deriveNormalSupplyPreviewEngineMode,
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
    expect(preview.signalCounts.UNUSABLE).toBe(1);
    expect(preview.topCandidates[0]?.symbol).toBe('005930');
    expect(getLastNormalSupplyPreview()).toBe(preview);
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
});
