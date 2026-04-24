/**
 * @responsibility AI 추천 일일 호출 카운터 회귀 테스트 — enforcement 비활성 이후
 * 카운터 기록·자정 리셋·영속화만 검증 (2026-04 사용자 요청으로 한도 차단 제거).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import {
  tryConsume,
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

describe('aiCallBudgetRepo — 카운터 기록·리셋·영속화', () => {
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

  it('초기 카운터 0', () => {
    expect(getUsed('google_search')).toBe(0);
    expect(getUsed('naver_finance')).toBe(0);
    expect(getUsed('krx_master_refresh')).toBe(0);
  });

  it('tryConsume 는 항상 true 반환 (enforcement 없음)', () => {
    for (let i = 0; i < 1000; i++) {
      expect(tryConsume('google_search', 1)).toBe(true);
    }
    expect(getUsed('google_search')).toBe(1000);
  });

  it('bucket 별 카운터 독립 누적', () => {
    for (let i = 0; i < 5; i++) tryConsume('google_search', 1);
    for (let i = 0; i < 10; i++) tryConsume('naver_finance', 1);
    expect(getUsed('google_search')).toBe(5);
    expect(getUsed('naver_finance')).toBe(10);
    expect(getUsed('krx_master_refresh')).toBe(0);
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
    // KST 다음날 00:00 = UTC 전날 15:00
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
  });
});
