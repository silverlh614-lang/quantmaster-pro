/**
 * @responsibility Google Custom Search 클라이언트 회귀 테스트 — PR-25-A, ADR-0011
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import {
  googleSearch,
  KOREAN_FINANCE_WHITELIST,
  __testOnly,
} from './googleSearchClient.js';
import { __testOnly as __budgetTestOnly } from '../persistence/aiCallBudgetRepo.js';
import { AI_CALL_BUDGET_FILE } from '../persistence/paths.js';

function cleanFile(): void {
  try { fs.unlinkSync(AI_CALL_BUDGET_FILE); } catch { /* not present */ }
}

describe('googleSearchClient (ADR-0011)', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_SEARCH_API_KEY;
    delete process.env.GOOGLE_SEARCH_CX;
    delete process.env.AI_DAILY_CALL_BUDGET;
    cleanFile();
    __budgetTestOnly.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanFile();
    __budgetTestOnly.reset();
    vi.restoreAllMocks();
  });

  it('API 키 미설정 시 NOT_CONFIGURED 반환', async () => {
    const res = await googleSearch('오늘 급등주');
    expect(res.source).toBe('NOT_CONFIGURED');
    expect(res.items).toEqual([]);
  });

  it('buildWhitelistQuery — site: OR 절로 화이트리스트 강제', () => {
    const q = __testOnly.buildWhitelistQuery('급등주', ['naver.com', 'hankyung.com']);
    expect(q).toContain('급등주');
    expect(q).toContain('site:naver.com OR site:hankyung.com');
  });

  it('KOREAN_FINANCE_WHITELIST 에 핵심 도메인 포함', () => {
    expect(KOREAN_FINANCE_WHITELIST).toContain('m.stock.naver.com');
    expect(KOREAN_FINANCE_WHITELIST).toContain('hankyung.com');
  });

  it('정상 응답 시 items 매핑 + GOOGLE_CSE source', async () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'test-key';
    process.env.GOOGLE_SEARCH_CX = 'test-cx';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        items: [
          { title: '오늘의 급등주', link: 'https://m.stock.naver.com/x', snippet: '삼성전자', displayLink: 'm.stock.naver.com' },
          { title: '시장 리뷰', link: 'https://hankyung.com/y', snippet: 'NAVER 강세', displayLink: 'hankyung.com' },
        ],
        searchInformation: { totalResults: '2' },
      }), { status: 200 }) as never
    );
    const res = await googleSearch('급등주');
    expect(res.source).toBe('GOOGLE_CSE');
    expect(res.items).toHaveLength(2);
    expect(res.items[0].displayLink).toBe('m.stock.naver.com');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('HTTP 오류 시 ERROR source 반환', async () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'test-key';
    process.env.GOOGLE_SEARCH_CX = 'test-cx';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('quota', { status: 429 }) as never
    );
    const res = await googleSearch('q');
    expect(res.source).toBe('ERROR');
  });

  it('Google API 응답에 hl=ko + gl=kr 쿼리 파라미터 포함', async () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'test-key';
    process.env.GOOGLE_SEARCH_CX = 'test-cx';
    let calledUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    await googleSearch('급등주');
    expect(calledUrl).toContain('hl=ko');
    expect(calledUrl).toContain('gl=kr');
  });
});
