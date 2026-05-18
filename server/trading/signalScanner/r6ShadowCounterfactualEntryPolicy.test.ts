// @responsibility R6 shadow counterfactual entry policy regression tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CandidateWithSupplyContext } from './injectPerSymbolSupplyContext.js';

let tmpDir = '';
const originalDataDir = process.env.PERSIST_DATA_DIR;
const originalMaxEntries = process.env.R6_COUNTERFACTUAL_MAX_ENTRIES;
const originalOpenPosition = process.env.R6_COUNTERFACTUAL_OPEN_POSITION_ENABLED;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-shadow-cf-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  process.env.R6_COUNTERFACTUAL_MAX_ENTRIES = '3';
  vi.resetModules();
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = originalDataDir;
  if (originalMaxEntries === undefined) delete process.env.R6_COUNTERFACTUAL_MAX_ENTRIES;
  else process.env.R6_COUNTERFACTUAL_MAX_ENTRIES = originalMaxEntries;
  if (originalOpenPosition === undefined) delete process.env.R6_COUNTERFACTUAL_OPEN_POSITION_ENABLED;
  else process.env.R6_COUNTERFACTUAL_OPEN_POSITION_ENABLED = originalOpenPosition;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function accumulatingRawCandidate(
  overrides: Record<string, unknown> = {},
): CandidateWithSupplyContext & { code: string; name: string; entryPrice?: number } {
  return {
    code: '005930',
    name: 'Samsung Electronics',
    entryPrice: 50_000,
    preflight: {
      supplyContext: {
        symbol: '005930',
        provider: 'KIS_API',
        supplyProviderHealth: 'VERIFIED',
        supplySignal: 'NEUTRAL',
        providerIssue: false,
        marketSignal: true,
        executionImpact: 'NONE',
        foreignNetBuyAmount: 10_000,
        institutionNetBuyAmount: 9_000,
        fetchedAt: '2026-05-18T03:00:00.000Z',
        rawStatus: 'OK',
      },
    },
    ...overrides,
  } as CandidateWithSupplyContext & { code: string; name: string; entryPrice?: number };
}

describe('R6_SHADOW_ENTRY_POLICY', () => {
  it('keeps R6 counterfactual learning-only only when counterfactualOnly policy is enabled', async () => {
    process.env.R6_COUNTERFACTUAL_OPEN_POSITION_ENABLED = 'false';
    vi.resetModules();
    const { persistNormalSupplyPreview } = await import('./normalSupplyPreview.js');
    const { applyR6ShadowCounterfactualEntries } = await import('./r6ShadowCounterfactualEntryPolicy.js');
    const { loadShadowTrades } = await import('../../persistence/shadowTradeRepo.js');
    const { loadCounterfactualShadowLearningLedger } = await import('../../persistence/counterfactualShadowLearningRepo.js');

    const rawCandidates = [accumulatingRawCandidate()];
    const preview = persistNormalSupplyPreview({
      engineMode: 'MACRO_LIVE_BLOCK',
      source: 'RUNTIME_DIAGNOSTIC',
      reason: 'R6_DEFENSE',
      candidates: rawCandidates,
      capturedAt: '2026-05-18T03:00:00.000Z',
    });

    const summary = applyR6ShadowCounterfactualEntries({
      preview,
      rawCandidates,
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R6_DEFENSE',
        kellyMultiplierFromRegime: 0,
        fomcPhase: 'NONE',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0,
        vixGatingActive: false,
        bearDefenseMode: true,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: false,
        shadowLearningAllowed: true,
        diagnosticAllowed: true,
      },
      now: new Date('2026-05-18T03:05:00.000Z'),
    });

    expect(summary).toMatchObject({
      r6CounterfactualEntries: 0,
      counterfactualLearningEntries: 1,
      noShadowEntryReason: 'R6_COUNTERFACTUAL_ACTIVE_POSITION_DISABLED',
      executionImpact: 'NONE',
    });
    expect(loadShadowTrades()).toHaveLength(0);
    const ledger = loadCounterfactualShadowLearningLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      symbol: '005930',
      label: 'R6_COUNTERFACTUAL_BUY',
      liveAllowed: false,
      paperAllowed: false,
      executionShadowAllowed: false,
      virtualAccountImpact: 'NONE',
      paperFillCreated: false,
      shadowPositionOpened: false,
      executionImpact: 'NONE',
      liveOrderSent: false,
    });
  }, 20_000);

  it('creates a SHADOW/PAPER R6 counterfactual entry from ACCUMULATING candidates without live order impact', async () => {
    delete process.env.R6_COUNTERFACTUAL_OPEN_POSITION_ENABLED;
    vi.resetModules();
    const { persistNormalSupplyPreview } = await import('./normalSupplyPreview.js');
    const { applyR6ShadowCounterfactualEntries } = await import('./r6ShadowCounterfactualEntryPolicy.js');
    const { loadShadowTrades } = await import('../../persistence/shadowTradeRepo.js');
    const { loadCounterfactualShadowLearningLedger } = await import('../../persistence/counterfactualShadowLearningRepo.js');

    const rawCandidates = [accumulatingRawCandidate()];
    const preview = persistNormalSupplyPreview({
      engineMode: 'MACRO_LIVE_BLOCK',
      source: 'RUNTIME_DIAGNOSTIC',
      reason: 'R6_DEFENSE',
      candidates: rawCandidates,
      capturedAt: '2026-05-18T03:00:00.000Z',
    });

    expect(preview.signalCounts.ACCUMULATING).toBe(1);
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const summary = applyR6ShadowCounterfactualEntries({
      preview,
      rawCandidates,
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R6_DEFENSE',
        kellyMultiplierFromRegime: 0,
        fomcPhase: 'NONE',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0,
        vixGatingActive: false,
        bearDefenseMode: true,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: false,
        r6RecoveryStatus: 'R6_CONFIRMATION_WAIT',
        latchDecayPercent: 0,
        mhs: 70,
        shadowLearningAllowed: true,
        diagnosticAllowed: true,
      },
      now: new Date('2026-05-18T03:05:00.000Z'),
    });

    expect(summary).toMatchObject({
      regime: 'R6_CONFIRMATION_WAIT',
      liveNewBuyAllowed: false,
      realOrderAllowed: false,
      strongBuyAllowed: false,
      r6CounterfactualEntries: 1,
      noShadowEntryReason: 'N/A',
      sizingSource: 'LIVE_SIZING_MIRROR',
      executionImpact: 'NONE',
    });

    const trades = loadShadowTrades();
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      stockCode: '005930',
      mode: 'SHADOW',
      status: 'ACTIVE',
      entryType: 'R6_COUNTERFACTUAL_BUY',
      sourceSignal: 'ACCUMULATING',
      entryReason: 'R6_COUNTERFACTUAL_RECOVERY_TEST',
      executionImpact: 'NONE',
      liveOrderSent: false,
      riskUnit: 'R6_COUNTERFACTUAL',
      sizingSource: 'LIVE_SIZING_MIRROR',
      entryRegime: 'R6_DEFENSE',
      entryEffectiveState: 'R6_CONFIRMATION_WAIT',
      transitionPath: ['R6_DEFENSE'],
      r6LatchDecayAtEntry: 0,
      mhsAtEntry: 70,
      biasAtEntry: 'BULL',
    });
    expect(trades[0].supplyScoreAtEntry).toBeGreaterThanOrEqual(70);
    const notional = (trades[0].originalQuantity ?? trades[0].quantity) * trades[0].shadowEntryPrice;
    expect(notional).toBeGreaterThan(100_000);
    expect(notional).toBeLessThanOrEqual(10_000_000);
    expect(trades[0].sizingEngineSnapshot?.finalPositionKrw).toBe(notional);
    expect(trades[0].r6Counterfactual?.sizingSource).toBe('LIVE_SIZING_MIRROR');
    expect(trades[0].r6Counterfactual?.entryRegime).toBe('R6_DEFENSE');
    expect(trades[0].r6Counterfactual?.entryEffectiveState).toBe('R6_CONFIRMATION_WAIT');
    expect(trades[0].r6Counterfactual?.transitionPath).toEqual(['R6_DEFENSE']);
    expect(trades[0].r6Counterfactual?.mhsAtEntry).toBe(70);
    expect(trades[0].fills?.some((fill) => fill.type === 'BUY' && fill.status === 'CONFIRMED')).toBe(true);
    expect(trades[0].liveOrderSent).toBe(false);
    const ledger = loadCounterfactualShadowLearningLedger();
    expect(ledger[0]).toMatchObject({
      symbol: '005930',
      label: 'R6_COUNTERFACTUAL_BUY',
      entryRegime: 'R6_DEFENSE',
      entryEffectiveState: 'R6_CONFIRMATION_WAIT',
      transitionPath: ['R6_DEFENSE'],
      mhsAtEntry: 70,
      biasAtEntry: 'BULL',
      executionImpact: 'NONE',
      liveOrderSent: false,
    });
    expect(ledger[0].supplyScoreAtEntry).toBeGreaterThanOrEqual(70);
    const joinedLogs = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(joinedLogs).toMatch(/\[R6_SHADOW_ENTRY_POLICY_RESOLVED\][\s\S]+\[SHADOW_ORDER_CREATED\][\s\S]+\[SHADOW_PAPER_FILLED\][\s\S]+\[SHADOW_POSITION_OPENED\][\s\S]+\[R6_SHADOW_ACTIVE_RECORDED\]/);
    expect(joinedLogs).not.toContain('[R6_COUNTERFACTUAL_LEARNING_ONLY_RECORDED]');
    logSpy.mockRestore();
  }, 20_000);

  it('records an explicit noShadowEntryReason instead of silently ending at zero', async () => {
    const { persistNormalSupplyPreview } = await import('./normalSupplyPreview.js');
    const { applyR6ShadowCounterfactualEntries } = await import('./r6ShadowCounterfactualEntryPolicy.js');

    const rawCandidates = [accumulatingRawCandidate({ entryPrice: undefined })];
    const preview = persistNormalSupplyPreview({
      engineMode: 'MACRO_LIVE_BLOCK',
      source: 'RUNTIME_DIAGNOSTIC',
      reason: 'R6_CONFIRMATION_WAIT',
      candidates: rawCandidates,
      capturedAt: '2026-05-18T03:00:00.000Z',
    });

    const summary = applyR6ShadowCounterfactualEntries({
      preview,
      rawCandidates,
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R6_DEFENSE',
        kellyMultiplierFromRegime: 0,
        fomcPhase: 'NONE',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0,
        vixGatingActive: false,
        bearDefenseMode: true,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: false,
        shadowLearningAllowed: true,
        diagnosticAllowed: true,
      },
      now: new Date('2026-05-18T03:05:00.000Z'),
    });

    expect(summary.r6CounterfactualEntries).toBe(0);
    expect(summary.noShadowEntryReason).toBe('PRICE_DATA_MISSING');
  });
});
