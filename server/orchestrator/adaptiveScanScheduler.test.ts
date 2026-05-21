import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { recordScanResult, getScanFeedbackState, resetScanState } from './adaptiveScanScheduler.js';

function kstTime(hour: number, minute: number): Date {
  return new Date(Date.UTC(2026, 4, 8, hour - 9, minute, 0)); // 2026-05-08 Friday
}

const buyAllowedNow = kstTime(10, 0);
const trueEmptyOpts = { now: buyAllowedNow, engineMode: 'NORMAL' as const };
const schedulerSource = fs.readFileSync(path.resolve(__dirname, 'adaptiveScanScheduler.ts'), 'utf-8');
const schedulerBaseSource = fs.readFileSync(path.resolve(__dirname, 'adaptiveScanScheduler.base.ts'), 'utf-8');

describe('recordScanResult — 피드백 루프', () => {
  beforeEach(() => {
    resetScanState();
  });

  it('빈 스캔이 연속되면 consecutiveEmptyScans가 누적된다', () => {
    recordScanResult(0, trueEmptyOpts);
    recordScanResult(0, trueEmptyOpts);
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(2);
    expect(getScanFeedbackState().backoffMultiplier).toBe(1); // 5회 미만 → 배율 1
  });

  it('4회 연속 빈 스캔이어도 임계값(5) 미만이면 배율 1', () => {
    for (let i = 0; i < 4; i++) recordScanResult(0, trueEmptyOpts);
    const state = getScanFeedbackState();
    expect(state.consecutiveEmptyScans).toBe(4);
    expect(state.backoffMultiplier).toBe(1);
  });

  it('5회 연속 빈 스캔 → backoffMultiplier가 2로 증가한다', () => {
    for (let i = 0; i < 5; i++) recordScanResult(0, trueEmptyOpts);
    const state = getScanFeedbackState();
    expect(state.consecutiveEmptyScans).toBe(5);
    expect(state.backoffMultiplier).toBe(2);
  });

  it('10회 연속 빈 스캔 → backoffMultiplier가 3(최대)으로 증가한다', () => {
    for (let i = 0; i < 10; i++) recordScanResult(0, trueEmptyOpts);
    const state = getScanFeedbackState();
    expect(state.consecutiveEmptyScans).toBe(10);
    expect(state.backoffMultiplier).toBe(3);
  });

  it('15회 연속 빈 스캔이어도 backoffMultiplier는 3을 초과하지 않는다', () => {
    for (let i = 0; i < 15; i++) recordScanResult(0, trueEmptyOpts);
    expect(getScanFeedbackState().backoffMultiplier).toBe(3);
  });

  it('신호가 발견되면 consecutiveEmptyScans가 0으로 리셋된다', () => {
    for (let i = 0; i < 5; i++) recordScanResult(0, trueEmptyOpts);
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(5);

    recordScanResult(2); // 신호 2건 발견
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(0);
    expect(getScanFeedbackState().backoffMultiplier).toBe(1);
  });

  it('빈 스캔 후 신호 발견 후 다시 빈 스캔 → 카운터가 0부터 재시작', () => {
    for (let i = 0; i < 5; i++) recordScanResult(0, trueEmptyOpts);
    recordScanResult(1); // 리셋
    recordScanResult(0, trueEmptyOpts);
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(1);
    expect(getScanFeedbackState().backoffMultiplier).toBe(1);
  });

  it('resetScanState()로 전체 상태 초기화', () => {
    recordScanResult(0, trueEmptyOpts);
    recordScanResult(0, trueEmptyOpts);
    recordScanResult(0, trueEmptyOpts);
    resetScanState();
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(0);
    expect(getScanFeedbackState().backoffMultiplier).toBe(1);
  });
});

describe('recordScanResult — ADR-452b empty scan taxonomy wiring', () => {
  beforeEach(() => {
    resetScanState();
  });

  it('09:15 KST + signalCount=0 + NORMAL은 session-blocked로 streak를 증가시키지 않는다', () => {
    recordScanResult(0, { now: kstTime(9, 15), engineMode: 'NORMAL' });
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(0);
  });

  it('11:45 KST + signalCount=0 + NORMAL은 session-blocked로 streak를 증가시키지 않는다', () => {
    recordScanResult(0, { now: kstTime(11, 45), engineMode: 'NORMAL' });
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(0);
  });

  it('15:25 KST + signalCount=0 + NORMAL은 session-blocked로 streak를 증가시키지 않는다', () => {
    recordScanResult(0, { now: kstTime(15, 25), engineMode: 'NORMAL' });
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(0);
  });

  it('10:00 KST + signalCount=0 + NORMAL은 TRUE_EMPTY로 streak를 증가시킨다', () => {
    recordScanResult(0, { now: kstTime(10, 0), engineMode: 'NORMAL' });
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(1);
  });

  it('10:00 KST + signalCount=0 + SELL_ONLY는 mode-blocked로 streak를 증가시키지 않는다', () => {
    recordScanResult(0, { now: kstTime(10, 0), engineMode: 'SELL_ONLY' });
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(0);
  });

  it('positionFull=true이면 기존처럼 streak를 증가시키지 않는다', () => {
    recordScanResult(0, { now: kstTime(10, 0), engineMode: 'NORMAL', positionFull: true });
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(0);
  });
});



describe('R6 macro_unblock override scan wiring (ADR-R6-OVERRIDE-SCAN-001)', () => {
  it('keeps SELL_ONLY default and enables FULL path when override is active', () => {
    expect(schedulerBaseSource).toContain("const r6OverrideActive = isMacroEntryOverrideActive('R6_DEFENSE')");
    expect(schedulerBaseSource).toContain("priority:        'SELL_ONLY'");
    expect(schedulerBaseSource).toContain("priority:        'FULL'");
    expect(schedulerBaseSource).toContain('[R6_DEFENSE_OVERRIDE_SCAN] macro_unblock active');
  });
});

describe('R6 confirmation/recovery shadow scan trigger wiring', () => {
  it('routes R6 confirmation wait and bias recovery triggers to FULL shadow candidate scans', () => {
    expect(schedulerSource).toContain("emitShadowCandidateScanTrigger('R6_CONFIRMATION_WAIT')");
    expect(schedulerSource).toContain("emitShadowCandidateScanTrigger('BIAS_RECOVERY')");
    expect(schedulerSource).toContain("priority: 'FULL'");
    expect(schedulerSource).toContain('candidateScanTrigger: recoveryShadowTrigger');
    expect(schedulerSource).toContain('executionImpact=NONE liveNewBuyAllowed=false realOrderAllowed=false strongBuyAllowed=false');
  });
});
