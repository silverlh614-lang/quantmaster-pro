// @responsibility R6 shadow counterfactual entry policy regression tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CandidateWithSupplyContext } from './injectPerSymbolSupplyContext.js';

let tmpDir = '';
const originalDataDir = process.env.PERSIST_DATA_DIR;
const originalMaxEntries = process.env.R6_COUNTERFACTUAL_MAX_ENTRIES;
const originalNominal = process.env.R6_COUNTERFACTUAL_NOMINAL_KRW;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-shadow-cf-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  process.env.R6_COUNTERFACTUAL_MAX_ENTRIES = '3';
  process.env.R6_COUNTERFACTUAL_NOMINAL_KRW = '100000';
  vi.resetModules();
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = originalDataDir;
  if (originalMaxEntries === undefined) delete process.env.R6_COUNTERFACTUAL_MAX_ENTRIES;
  else process.env.R6_COUNTERFACTUAL_MAX_ENTRIES = originalMaxEntries;
  if (originalNominal === undefined) delete process.env.R6_COUNTERFACTUAL_NOMINAL_KRW;
  else process.env.R6_COUNTERFACTUAL_NOMINAL_KRW = originalNominal;
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
  it('creates a SHADOW/PAPER R6 counterfactual entry from ACCUMULATING candidates without live order impact', async () => {
    const { persistNormalSupplyPreview } = await import('./normalSupplyPreview.js');
    const { applyR6ShadowCounterfactualEntries } = await import('./r6ShadowCounterfactualEntryPolicy.js');
    const { loadShadowTrades } = await import('../../persistence/shadowTradeRepo.js');

    const rawCandidates = [accumulatingRawCandidate()];
    const preview = persistNormalSupplyPreview({
      engineMode: 'MACRO_LIVE_BLOCK',
      source: 'RUNTIME_DIAGNOSTIC',
      reason: 'R6_DEFENSE',
      candidates: rawCandidates,
      capturedAt: '2026-05-18T03:00:00.000Z',
    });

    expect(preview.signalCounts.ACCUMULATING).toBe(1);
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
      regime: 'R6_DEFENSE',
      liveNewBuyAllowed: false,
      realOrderAllowed: false,
      strongBuyAllowed: false,
      r6CounterfactualEntries: 1,
      noShadowEntryReason: 'N/A',
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
    });
    expect(trades[0].fills?.some((fill) => fill.type === 'BUY' && fill.status === 'CONFIRMED')).toBe(true);
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
