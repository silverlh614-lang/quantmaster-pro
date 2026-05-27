import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  __resetNormalSupplyPreviewForTests,
  deriveNormalSupplyPreviewEngineMode,
  formatNormalSupplyPreviewFullSections,
  formatNormalSupplyPreviewSection,
  getLastNormalSupplyPreview,
  persistNormalSupplyPreview,
} from './normalSupplyPreview.js';

beforeEach(() => {
  __resetNormalSupplyPreviewForTests();
});

afterEach(() => {
  delete process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED;
  delete process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED;
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

  it('formats the overlay with UNKNOWN=0 and executionImpact=NONE', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'MACRO_LIVE_BLOCK',
      source: 'RUNTIME_DIAGNOSTIC',
      candidates: [],
    });
    const section = formatNormalSupplyPreviewSection(preview);
    expect(section).toContain('Normal Supply Preview with legacy defense policy disabled');
    expect(section).toContain('previewBasis: NORMAL_SUPPLY_DIAGNOSTIC');
    expect(section).toContain('actualEngineMode: MACRO_LIVE_BLOCK');
    expect(section).toContain('liveExecutionAllowed: false');
    expect(section).toContain('realOrderAllowed: false');
    expect(section).toContain('executionImpact: NONE');
    expect(section).toContain('UNKNOWN: 0');
    expect(section).not.toContain('NORMAL_SUPPLY_DIAGNOSTIC_FULL');
    expect(section).not.toContain('BEARISH Supply Candidates');
    expect(section).not.toContain('Signal Source Split');
  });

  it('prints actual regime from SourceSnapshotDecisionContext and keeps legacy R6 diagnostic-only', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'MACRO_LIVE_BLOCK',
      source: 'RUNTIME_DIAGNOSTIC',
      candidates: [],
    });
    const section = formatNormalSupplyPreviewSection(preview, {
      engineMode: 'SHADOW_ONLY',
      effectiveRegime: 'R3_EARLY',
      displayRegime: 'SHADOW_ONLY',
      riskOverride: 'SHADOW_ONLY',
      policyView: 'SHADOW_ONLY',
      liveEntryAllowed: false,
      regimeContextSource: 'SourceSnapshotDecisionContext',
      regimeContextMatch: true,
      page2EffectiveRegime: 'R3_EARLY',
      childEffectiveRegime: 'R3_EARLY',
      legacyEffectiveRegime: 'R6_DEFENSE',
      legacyDeprecated: true,
      legacyUsedForDecision: false,
      regimeContextMismatch: false,
      legacyEffectiveRegimeLeak: false,
      nextAction: 'NONE',
    }) ?? '';
    expect(section).toContain('actualEffectiveRegime: R3_EARLY');
    expect(section).toContain('actualLegacyEffectiveRegime: R6_DEFENSE deprecated=true usedForDecision=false');
    expect(section).toContain('regimeContextSource: SourceSnapshotDecisionContext');
    expect(section).toContain('regimeContextMatch: true');
    expect(section).toContain('REGIME_CONTEXT_MISMATCH: false');
    expect(section).toContain('LEGACY_EFFECTIVE_REGIME_LEAK: false');
    expect(section).not.toContain('actualEffectiveRegime: R6_DEFENSE');
  });

  it('formats compact ACCUMULATING promotion block reason without changing live policy', () => {
    const preview = persistNormalSupplyPreview({
      engineMode: 'SELL_ONLY',
      source: 'COMMAND',
      candidates: [
        {
          code: '011210',
          name: '현대위아',
          preflight: {
            supplyContext: {
              symbol: '011210',
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

    const section = formatNormalSupplyPreviewSection(preview, { maxTopCandidates: 1 });
    expect(section).toContain('📌 수급 해석 요약');
    expect(section).toContain('- 데이터 상태: VERIFIED 1/1 정상');
    expect(section).toContain('- 외인/기관 순매수 감지 종목: 1개');
    expect(section).toContain('- 최종 ACCUMULATING 후보: 1개');
    expect(section).toContain('- 최종 BULLISH 후보: 0개');
    expect(section).toContain('- 설명: 외인/기관 순매수 감지는 원천 active flow 기준이며, ACCUMULATING/BULLISH는 프로그램 수급, 점수 임계값, 정책 차단까지 반영한 최종 수급 판정입니다.');
    expect(section).toContain('- 최고 수급점수: 77');
    expect(section).toContain('- BULLISH 기준: 80');
    expect(section).toContain('- 현재 판정: ACCUMULATING');
    expect(section).toContain('- 미승격 사유: supplyScore 77 < bullishThreshold 80');
    expect(section).toContain('- 실거래 차단: SELL_ONLY_MODE');
    expect(section).toContain('- 허용 동작: Shadow 관찰 / Watchlist Boost');
    expect(section).toContain('- executionImpact: NONE');
    expect(section).toContain('1. 011210 현대위아');
    expect(section).toContain('activeFlow=외인+기관 동반 순매수');
    expect(section).toContain('supplyScore=77/80');
    expect(section).toContain('signal=ACCUMULATING');
    expect(section).toContain('promotionBlocked=BELOW_BULLISH_THRESHOLD');
    expect(section).toContain('liveDecision=BLOCKED_BY_SELL_ONLY_MODE');
    expect(section).toContain('shadowObservable=true');
    expect(section).not.toContain('watchlistBoost=N/A');
    expect(section).toContain('watchlistPriorityBoost=1');
    expect(section).toContain('executionImpact=NONE');
    expect(preview.liveExecutionAllowed).toBe(false);
    expect(preview.realOrderAllowed).toBe(false);
  });

  it('classifies SELL_ONLY and macro live block separately from true hard block', () => {
    expect(deriveNormalSupplyPreviewEngineMode({ preflightDecision: 'ABORT_SELL_ONLY' })).toBe('PRE_FLIGHT_BLOCK');
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
