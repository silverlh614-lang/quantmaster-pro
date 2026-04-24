/**
 * @responsibility AI 추천 일일 호출 예산 카운터 회귀 테스트 — PR-25-A, ADR-0011
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import {
  tryConsume,
  getRemaining,
  getUsed,
  resetBudget,
  getBudgetSnapshot,
  flushAiCallBudget,
  __testOnly,
} from './aiCallBudgetRepo.js';
import { AI_CALL_BUDGET_FILE } from './paths.js';

function cleanFile(): void {
  try { fs.unlinkSync(AI_CALL_BUDGET_FILE); } catch { /* not present */ }
}

describe('aiCallBudgetRepo (ADR-0011)', () => {
  beforeEach(() => {
    delete process.env.AI_DAILY_CALL_BUDGET;
    cleanFile();
    __testOnly.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T00:00:00.000Z')); // KST 09:00
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanFile();
    __testOnly.reset();
  });

  it('초기에 google_search 잔여=80 (기본 한도)', () => {
    expect(getRemaining('google_search')).toBe(80);
    expect(getUsed('google_search')).toBe(0);
  });

  it('tryConsume 가 한도 안에서 true, 한도 초과 시 false', () => {
    for (let i = 0; i < 80; i++) {
      expect(tryConsume('google_search', 1)).toBe(true);
    }
    expect(tryConsume('google_search', 1)).toBe(false);
    expect(getRemaining('google_search')).toBe(0);
    expect(getUsed('google_search')).toBe(80);
  });

  it('한도 초과 호출은 카운터 증가 없음', () => {
    for (let i = 0; i < 80; i++) tryConsume('google_search', 1);
    expect(tryConsume('google_search', 5)).toBe(false);
    expect(getUsed('google_search')).toBe(80);
  });

  it('AI_DAILY_CALL_BUDGET env override 적용', () => {
    process.env.AI_DAILY_CALL_BUDGET = '20';
    __testOnly.reset();
    expect(getRemaining('google_search')).toBe(20);
    for (let i = 0; i < 20; i++) tryConsume('google_search', 1);
    expect(tryConsume('google_search', 1)).toBe(false);
  });

  it('bucket 별 한도 독립 — google_search 80, naver_finance 1000', () => {
    expect(getRemaining('google_search')).toBe(80);
    expect(getRemaining('naver_finance')).toBe(1000);
    for (let i = 0; i < 80; i++) tryConsume('google_search', 1);
    expect(tryConsume('google_search', 1)).toBe(false);
    expect(tryConsume('naver_finance', 1)).toBe(true);
  });

  it('영속화 — flush 후 새 인스턴스에서 카운터 유지', () => {
    for (let i = 0; i < 30; i++) tryConsume('google_search', 1);
    flushAiCallBudget();
    __testOnly.reset();
    expect(getUsed('google_search')).toBe(30);
  });

  it('자정 KST 경과 시 카운터 자동 리셋', () => {
    for (let i = 0; i < 50; i++) tryConsume('google_search', 1);
    expect(getUsed('google_search')).toBe(50);

    // KST 다음날 00:00 = UTC 전날 15:00 → 24시간 advance
    vi.setSystemTime(new Date('2026-04-25T00:00:00.000Z'));
    expect(getUsed('google_search')).toBe(0);
  });

  it('resetBudget — 모든 카운터 0 으로', () => {
    for (let i = 0; i < 50; i++) tryConsume('google_search', 1);
    resetBudget();
    expect(getUsed('google_search')).toBe(0);
  });

  it('getBudgetSnapshot — 알려진 모든 bucket 노출', () => {
    tryConsume('google_search', 5);
    tryConsume('naver_finance', 100);
    const snap = getBudgetSnapshot();
    const buckets = snap.buckets.map((b) => b.bucket).sort();
    expect(buckets).toContain('google_search');
    expect(buckets).toContain('naver_finance');
    expect(buckets).toContain('krx_master_refresh');
    const gs = snap.buckets.find((b) => b.bucket === 'google_search')!;
    expect(gs.used).toBe(5);
    expect(gs.remaining).toBe(75);
  });
});
