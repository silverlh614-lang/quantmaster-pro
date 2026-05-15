import { afterEach, describe, expect, it } from 'vitest';
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

  it('is wired through the control barrel and preflight macro gates', () => {
    const barrelSrc = fs.readFileSync(CONTROL_INDEX_PATH, 'utf-8');
    const preflightSrc = fs.readFileSync(PREFLIGHT_PATH, 'utf-8');

    expect(barrelSrc).toContain('macroEntryOverride.cmd.js');
    expect(preflightSrc).toContain("regime === 'R6_DEFENSE' && !r6EntryOverrideActive");
    expect(preflightSrc).toContain('vixGating.noNewEntry && !vixEntryOverrideActive');
    expect(preflightSrc).toContain('fomcProximity.noNewEntry && !fomcEntryOverrideActive');
    expect(preflightSrc).toContain('OPERATOR_MACRO_ENTRY_OVERRIDE');
  });
});
