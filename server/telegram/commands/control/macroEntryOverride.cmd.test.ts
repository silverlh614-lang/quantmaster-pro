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
const SCHEDULER_PATH = path.resolve(__dirname, '..', '..', '..', 'orchestrator', 'adaptiveScanScheduler.base.ts');

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

  it('is wired through the control barrel and the adaptive scan scheduler macro gate', () => {
    // 배경(stale 단언 정정): macro entry override gating 이 preflight.ts 인라인에서
    // adaptiveScanScheduler.base.ts 로 이전됐다. 실제 enforcement = scheduler 가
    // isMacroEntryOverrideActive('R6_DEFENSE') 를 소비해 R6 에서 SELL_ONLY 해제 + FULL 스캔
    // (마커 OPERATOR_MACRO_ENTRY_OVERRIDE). preflight 는 override 를 진단으로만 surface
    // (getMacroEntryOverrideState → macroEntryOverrideActive/Targets). seed 4452bd3 부터
    // production 과 불일치했던 preflight 인라인 문자열 단언을 현행 enforcement 위치로 정정한다.
    const barrelSrc = fs.readFileSync(CONTROL_INDEX_PATH, 'utf-8');
    const schedulerSrc = fs.readFileSync(SCHEDULER_PATH, 'utf-8');
    const preflightSrc = fs.readFileSync(PREFLIGHT_PATH, 'utf-8');

    expect(barrelSrc).toContain('macroEntryOverride.cmd.js');
    // 실제 enforcement (scheduler): R6_DEFENSE override 소비 → SELL_ONLY 해제 + FULL 스캔.
    expect(schedulerSrc).toContain("isMacroEntryOverrideActive('R6_DEFENSE')");
    expect(schedulerSrc).toContain('OPERATOR_MACRO_ENTRY_OVERRIDE');
    // preflight: override 진단 surface (gating 은 scheduler 로 이전).
    expect(preflightSrc).toContain('getMacroEntryOverrideState');
    expect(preflightSrc).toContain('macroEntryOverrideActive');
  });
});
