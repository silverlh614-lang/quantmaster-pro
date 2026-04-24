/**
 * @responsibility 예산 임계 경보 훅 회귀 테스트 — PR-25-C, ADR-0011
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import {
  tryConsume,
  setBudgetAlertHook,
  resetBudget,
  ALERT_THRESHOLDS_PCT,
  __testOnly,
} from './aiCallBudgetRepo.js';
import { AI_CALL_BUDGET_FILE } from './paths.js';

function cleanFile(): void {
  try { fs.unlinkSync(AI_CALL_BUDGET_FILE); } catch { /* not present */ }
}

describe('aiCallBudgetRepo — 임계 경보 훅 (PR-25-C)', () => {
  beforeEach(() => {
    delete process.env.AI_DAILY_CALL_BUDGET;
    cleanFile();
    __testOnly.reset();
    setBudgetAlertHook(null);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T00:00:00.000Z'));
  });
  afterEach(() => {
    setBudgetAlertHook(null);
    vi.useRealTimers();
    cleanFile();
    __testOnly.reset();
  });

  it('ALERT_THRESHOLDS_PCT 가 80/95/100 순서', () => {
    expect([...ALERT_THRESHOLDS_PCT]).toEqual([80, 95, 100]);
  });

  it('80% 도달 시 훅 1회 호출', () => {
    const calls: any[] = [];
    setBudgetAlertHook((p) => calls.push(p));
    for (let i = 0; i < 64; i++) tryConsume('google_search', 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ bucket: 'google_search', thresholdPct: 80, used: 64, limit: 80 });
  });

  it('80%→95%→100% 순차 경계 각각 1회씩 호출', () => {
    const calls: any[] = [];
    setBudgetAlertHook((p) => calls.push(p));
    for (let i = 0; i < 80; i++) tryConsume('google_search', 1);
    expect(calls.map(c => c.thresholdPct)).toEqual([80, 95, 100]);
  });

  it('같은 임계값은 하루에 한 번만 호출 (dedupe)', () => {
    const calls: any[] = [];
    setBudgetAlertHook((p) => calls.push(p));
    for (let i = 0; i < 64; i++) tryConsume('google_search', 1);
    expect(calls).toHaveLength(1);
    // 계속 호출해도 80% 는 재발생 안 함
    for (let i = 0; i < 10; i++) tryConsume('google_search', 1);
    expect(calls.filter(c => c.thresholdPct === 80)).toHaveLength(1);
  });

  it('한도 0 (AI_DAILY_CALL_BUDGET=0) 일 때 훅 호출 안 됨 — division by zero 회피', () => {
    process.env.AI_DAILY_CALL_BUDGET = '0';
    __testOnly.reset();
    const calls: any[] = [];
    setBudgetAlertHook((p) => calls.push(p));
    tryConsume('google_search', 1); // 한도 0 이므로 false 반환
    expect(calls).toHaveLength(0);
  });

  it('bucket 별 임계 카운터 독립', () => {
    const calls: any[] = [];
    setBudgetAlertHook((p) => calls.push(p));
    for (let i = 0; i < 64; i++) tryConsume('google_search', 1);
    expect(calls.filter(c => c.bucket === 'google_search')).toHaveLength(1);
    expect(calls.filter(c => c.bucket === 'naver_finance')).toHaveLength(0);
  });

  it('hook 실행 중 예외 발생해도 tryConsume 는 계속 동작', () => {
    setBudgetAlertHook(() => { throw new Error('boom'); });
    // 예외가 터져도 카운터 증가는 성공
    for (let i = 0; i < 64; i++) {
      expect(tryConsume('google_search', 1)).toBe(true);
    }
  });

  it('resetBudget 호출 시 alertedThresholds 도 청소 → 다시 경보 발생', () => {
    const calls: any[] = [];
    setBudgetAlertHook((p) => calls.push(p));
    for (let i = 0; i < 64; i++) tryConsume('google_search', 1);
    expect(calls).toHaveLength(1);
    resetBudget();
    for (let i = 0; i < 64; i++) tryConsume('google_search', 1);
    expect(calls.filter(c => c.thresholdPct === 80)).toHaveLength(2);
  });

  it('자정 경과 시 alertedThresholds 도 리셋', () => {
    const calls: any[] = [];
    setBudgetAlertHook((p) => calls.push(p));
    for (let i = 0; i < 64; i++) tryConsume('google_search', 1);
    expect(calls).toHaveLength(1);
    vi.setSystemTime(new Date('2026-04-25T00:00:00.000Z'));
    for (let i = 0; i < 64; i++) tryConsume('google_search', 1);
    expect(calls.filter(c => c.thresholdPct === 80)).toHaveLength(2);
  });
});
