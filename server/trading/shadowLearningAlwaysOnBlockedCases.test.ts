/**
 * @responsibility Shadow Always-On blocked case invariants.
 *
 * Verifies that representative blocked cases still persist learning-only rows
 * with executionImpact=NONE and never unlock live execution semantics.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ShadowLearningOnlyScanReason } from './shadowLearningOnlyScan.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slo-always-on-'));
process.env.PERSIST_DATA_DIR = tmpDir;

const ENV_KEY = 'SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED';

let mod: typeof import('./shadowLearningOnlyScan.js');
let repo: typeof import('../persistence/shadowLearningOnlySignalRepo.js');

const ALWAYS_ON_BLOCKED_REASONS: ShadowLearningOnlyScanReason[] = [
  'FOMC_BLOCK',
  'VIX_SPIKE',
  'RISK_OFF_REGIME',
  'R0_CRISIS',
  'R1_DEFENSIVE',
  'KRX_HOLIDAY_REPLAY',
  'MANUAL_BLOCK',
  'R3_SANITY_BLOCK',
  'KIS_CONFIG_MISSING',
  'WATCHLIST_EMPTY',
  'DATA_STARVED',
  'VOLUME_CLOCK_BLOCK',
  'POSITION_FULL',
  'SECTOR_ENERGY_STALE',
  'SUPPLY_DATA_UNSTABLE',
  'LIQUIDITY_BLOCK',
];

function resetTmpDir(): void {
  try {
    fs.readdirSync(tmpDir).forEach((f) => {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
}

function seedWatchlist(code = '005930'): void {
  fs.writeFileSync(
    path.join(tmpDir, 'watchlist.json'),
    JSON.stringify([
      {
        code,
        name: `TEST-${code}`,
        entryPrice: 75000,
        stopLoss: 71000,
        targetPrice: 84000,
        addedAt: '2026-05-04T00:00:00.000Z',
        addedBy: 'AUTO',
        section: 'SWING',
        gateScore: 9.5,
        entryRegime: 'R3_EARLY',
      },
    ]),
    'utf-8',
  );
}

beforeEach(async () => {
  process.env[ENV_KEY] = 'true';
  resetTmpDir();
  vi.resetModules();
  mod = await import('./shadowLearningOnlyScan.js');
  repo = await import('../persistence/shadowLearningOnlySignalRepo.js');
  repo.__resetShadowLearningOnlySignalsForTests();
});

afterEach(() => {
  delete process.env[ENV_KEY];
  resetTmpDir();
});

describe('Shadow Always-On blocked cases', () => {
  it.each(ALWAYS_ON_BLOCKED_REASONS)('%s persists learning-only row with executionImpact=NONE', async (reason) => {
    seedWatchlist();

    const result = await mod.runShadowLearningOnlyScan({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason,
      scanDate: '2026-05-04',
    });

    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      expect(result.reason).toBe(reason);
      expect(result.candidates).toBe(1);
      expect(result.wouldBuyCount).toBe(1);
      expect(result.signalsRecorded).toBe(1);
    }

    const signals = repo.loadShadowLearningOnlySignals();
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      symbol: '005930',
      signalDate: '2026-05-04',
      blockedReason: reason,
      learningOnly: true,
      executionImpact: 'NONE',
      wouldHaveBought: true,
      signalGrade: 'BUY',
      outcome: 'PENDING',
    });
    expect(signals[0]!.macroBlockReason).toBe(`${reason}:WATCHLIST`);
  });

  it('blocked cases on same day remain independently learnable by reason without duplicate leakage', async () => {
    seedWatchlist('005930');

    for (const reason of ['POSITION_FULL', 'VOLUME_CLOCK_BLOCK', 'SUPPLY_DATA_UNSTABLE'] as const) {
      const result = await mod.runShadowLearningOnlyScan({
        allowRealOrder: false,
        bypassMacroEntryBlock: true,
        reason,
        scanDate: '2026-05-04',
      });
      expect(result.skipped).toBe(false);
      if (!result.skipped) expect(result.signalsRecorded).toBe(1);
    }

    const signals = repo.loadShadowLearningOnlySignals();
    expect(signals).toHaveLength(3);
    expect(signals.map((s) => s.blockedReason).sort()).toEqual([
      'POSITION_FULL',
      'SUPPLY_DATA_UNSTABLE',
      'VOLUME_CLOCK_BLOCK',
    ]);
    expect(signals.every((s) => s.learningOnly === true)).toBe(true);
    expect(signals.every((s) => s.executionImpact === 'NONE')).toBe(true);
  });

  it('allowRealOrder=true is rejected before any blocked-case persistence', async () => {
    seedWatchlist();

    await expect(
      mod.runShadowLearningOnlyScan({
        allowRealOrder: true as unknown as false,
        bypassMacroEntryBlock: true,
        reason: 'POSITION_FULL',
        scanDate: '2026-05-04',
      }),
    ).rejects.toThrow(/allowRealOrder=false invariant violated/);

    expect(repo.loadShadowLearningOnlySignals()).toHaveLength(0);
  });
});
