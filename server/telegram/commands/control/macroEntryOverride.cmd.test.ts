import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

import { commandRegistry } from '../../commandRegistry.js';
import {
  __resetMacroEntryOverrideForTests,
  getMacroEntryOverrideState,
  setMacroEntryOverride,
} from '../../../state.js';
import './macroEntryOverride.cmd.js';
import './guards.cmd.js';

const CONTROL_INDEX_PATH = path.resolve(__dirname, 'index.ts');
const PREFLIGHT_PATH = path.resolve(__dirname, '..', '..', '..', 'trading', 'signalScanner', 'preflight.ts');

describe('/macro_unblock operator macro entry override', () => {
  afterEach(() => {
    __resetMacroEntryOverrideForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.doUnmock('../../../persistence/macroStateRepo.js');
    vi.doUnmock('../../../persistence/shadowTradeRepo.js');
    vi.doUnmock('../../../trading/regime/canonicalRegimeAccess.js');
  });

  it('registers command and aliases', () => {
    const cmd = commandRegistry.resolve('/macro_unblock');
    expect(cmd).toBeDefined();
    expect(commandRegistry.resolve('/macro_override')).toBe(cmd);
    expect(commandRegistry.resolve('/risk_unblock')).toBe(cmd);
    expect(cmd?.category).toBe('EMR');
    expect(cmd?.riskLevel).toBe(2);
  });

  it('enables a scoped FOMC override with TTL and reason', async () => {
    const cmd = commandRegistry.resolve('/macro_unblock');
    let captured = '';

    await cmd!.execute({
      args: ['30m', 'fomc', 'operator', 'approved'],
      reply: async (message: string) => {
        captured = message;
      },
    });

    const state = getMacroEntryOverrideState();
    expect(state?.targets).toEqual(['FOMC_BLOCK']);
    expect(state?.ttlMinutes).toBe(30);
    expect(state?.reason).toBe('operator approved');
    expect(captured).toContain('Macro Entry Override Enabled');
    expect(captured).toContain('FOMC_BLOCK');
  });

  it('clears an active override', async () => {
    setMacroEntryOverride({ targets: ['R6_DEFENSE'], reason: 'test' });
    const cmd = commandRegistry.resolve('/macro_unblock');
    let captured = '';

    await cmd!.execute({
      args: ['off'],
      reply: async (message: string) => {
        captured = message;
      },
    });

    expect(getMacroEntryOverrideState()).toBeNull();
    expect(captured).toContain('CLEARED');
  });

  it('expires in-memory override automatically', () => {
    setMacroEntryOverride({
      targets: ['VIX_BLOCK'],
      ttlMinutes: 10,
      now: new Date('2026-05-15T00:00:00.000Z'),
    });

    expect(getMacroEntryOverrideState(new Date('2026-05-15T00:09:59.000Z'))?.targets).toEqual(['VIX_BLOCK']);
    expect(getMacroEntryOverrideState(new Date('2026-05-15T00:10:00.000Z'))).toBeNull();
  });

  it('/guards displays override status without making it a blocker', async () => {
    setMacroEntryOverride({ targets: ['R6_DEFENSE'], reason: 'guard display' });
    const guards = commandRegistry.resolve('/guards');
    let captured = '';

    await guards!.execute({
      args: [],
      reply: async (message: string) => {
        captured = message;
      },
    });

    expect(captured).toContain('Macro Entry Override (/macro_unblock): ACTIVE');
    expect(captured).toContain('R6_DEFENSE');
  });

  it('keeps legacy command diagnostics without requiring an override for regime-free scan cadence', async () => {
    const barrelSrc = fs.readFileSync(CONTROL_INDEX_PATH, 'utf-8');
    const preflightSrc = fs.readFileSync(PREFLIGHT_PATH, 'utf-8');
    expect(barrelSrc).toContain('macroEntryOverride.cmd.js');
    expect(preflightSrc).toContain('getMacroEntryOverrideState');
    expect(preflightSrc).toContain('macroEntryOverrideActive');

    const retiredRegime = vi.fn(() => { throw new Error('REGIME_RETIRED'); });
    vi.doMock('../../../persistence/macroStateRepo.js', () => ({
      loadMacroState: () => ({ regime: 'R6_DEFENSE', vkospiDayChange: 0 }),
    }));
    vi.doMock('../../../persistence/shadowTradeRepo.js', () => ({ loadShadowTrades: () => [] }));
    vi.doMock('../../../trading/regime/canonicalRegimeAccess.js', () => ({
      resolveCanonicalRegimeLevel: retiredRegime,
    }));
    const scheduler = await import('../../../orchestrator/adaptiveScanScheduler.js');
    const state = await import('../../../state.js');
    const overrideLookup = vi.spyOn(state, 'isMacroEntryOverrideActive');
    const now = new Date('2026-05-08T01:00:00.000Z'); // Friday 10:00 KST
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubEnv('MAX_CONVICTION_POSITIONS', '10');
    vi.stubEnv('TRADE_WINDOW_LEGACY_HOURS', 'false');
    scheduler.resetScanState();
    const withoutOverride = scheduler.decideScan();
    expect(withoutOverride).toMatchObject({ shouldScan: true, intervalMinutes: 2, priority: 'FULL' });

    setMacroEntryOverride({ targets: ['R6_DEFENSE'], reason: 'legacy state compatibility', now });
    scheduler.resetScanState();
    expect(scheduler.decideScan()).toEqual(withoutOverride);
    vi.setSystemTime(new Date(now.getTime() + 60_000));
    expect(scheduler.decideScan()).toMatchObject({ shouldScan: false, intervalMinutes: 2 });
    vi.setSystemTime(new Date(now.getTime() + 120_000));
    expect(scheduler.decideScan()).toMatchObject({ shouldScan: true, intervalMinutes: 2, priority: 'FULL' });
    expect(overrideLookup).not.toHaveBeenCalled();
    expect(retiredRegime).not.toHaveBeenCalled();
  });
});
