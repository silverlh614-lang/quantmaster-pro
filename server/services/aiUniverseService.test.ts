/**
 * @responsibility aiUniverseService 통합 회귀 테스트 — PR-25-A, ADR-0011
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { discoverUniverse, enrichKnownStock, __testOnly } from './aiUniverseService.js';
import {
  setStockMaster,
  __testOnly as __masterTestOnly,
} from '../persistence/krxStockMasterRepo.js';
import { __testOnly as __budgetTestOnly } from '../persistence/aiCallBudgetRepo.js';
import {
  AI_CALL_BUDGET_FILE,
  KRX_STOCK_MASTER_FILE,
} from '../persistence/paths.js';

function cleanFiles(): void {
  for (const f of [AI_CALL_BUDGET_FILE, KRX_STOCK_MASTER_FILE]) {
    try { fs.unlinkSync(f); } catch { /* not present */ }
  }
}

describe('aiUniverseService (ADR-0011)', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_SEARCH_API_KEY;
    delete process.env.GOOGLE_SEARCH_CX;
    delete process.env.AI_DAILY_CALL_BUDGET;
    cleanFiles();
    __masterTestOnly.reset();
    __budgetTestOnly.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanFiles();
    __masterTestOnly.reset();
    __budgetTestOnly.reset();
    vi.restoreAllMocks();
  });

  it('MODE_QUERIES — 4개 mode 모두 쿼리 정의됨', () => {
    expect(__testOnly.MODE_QUERIES.MOMENTUM.length).toBeGreaterThan(0);
    expect(__testOnly.MODE_QUERIES.QUANT_SCREEN.length).toBeGreaterThan(0);
    expect(__testOnly.MODE_QUERIES.BEAR_SCREEN.length).toBeGreaterThan(0);
    expect(__testOnly.MODE_QUERIES.EARLY_DETECT.length).toBeGreaterThan(0);
  });

  it('Google Search 미설정 시 seed fallback 사용 + sourceStatus=NOT_CONFIGURED', async () => {
    setStockMaster([{ code: '005930', name: '삼성전자', market: 'KOSPI' }]);
    const res = await discoverUniverse('MOMENTUM', { enrich: false });
    expect(res.candidates.length).toBeGreaterThan(0);
    expect(res.diagnostics.googleHits).toBe(0);
    expect(res.diagnostics.budgetExceeded).toBe(false);
    expect(res.diagnostics.sourceStatus).toBe('NOT_CONFIGURED');
    expect(res.diagnostics.fallbackUsed).toBe(true);
    // seed universe 는 실제 KRX 시총 상위 종목코드를 사용
    expect(res.candidates.every((c) => /^\d{6}$/.test(c.code))).toBe(true);
    expect(res.candidates.every((c) => c.discoveredFrom.includes('seed:market_leaders'))).toBe(true);
  });

  it('Google Search 미설정 + mode=BEAR_SCREEN → 방어주 중심 seed', async () => {
    setStockMaster([]);
    const res = await discoverUniverse('BEAR_SCREEN', { enrich: false, maxCandidates: 10 });
    expect(res.diagnostics.sourceStatus).toBe('NOT_CONFIGURED');
    expect(res.diagnostics.fallbackUsed).toBe(true);
    const codes = res.candidates.map((c) => c.code);
    // 방어주·유틸리티 1순위: 한국전력/SK텔레콤/KT&G/CJ제일제당 중 최소 1개 포함
    expect(codes.some((c) => ['015760', '017670', '033780', '097950'].includes(c))).toBe(true);
  });

  it('buildSeedFallback — mode 별 태그 우선순위', () => {
    const momentum = __testOnly.buildSeedFallback('MOMENTUM', 5);
    expect(momentum.length).toBe(5);
    // 삼성전자·SK하이닉스 같은 LARGE_MOMENTUM 이 먼저 포함
    expect(momentum[0].code).toBe('005930');

    const bear = __testOnly.buildSeedFallback('BEAR_SCREEN', 3);
    expect(bear.length).toBe(3);
    // DEFENSIVE 태그 우선 — KT&G/한국전력/SK텔레콤 같은 defensive 종목
    expect(bear.every((e) => ['015760', '017670', '033780', '097950', '055550', '105560'].includes(e.code))).toBe(true);
  });

  it('Google Search 결과 → 종목명 추출 → 후보 발굴', async () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'test-key';
    process.env.GOOGLE_SEARCH_CX = 'test-cx';
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
      { code: '247540', name: '에코프로비엠', market: 'KOSDAQ' },
    ]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        items: [
          { title: '삼성전자 강세', link: 'https://m.stock.naver.com/x', snippet: '오늘 삼성전자 5%↑', displayLink: 'm.stock.naver.com' },
          { title: '2차전지 주목', link: 'https://hankyung.com/y', snippet: '에코프로비엠 신고가', displayLink: 'hankyung.com' },
        ],
        searchInformation: { totalResults: '2' },
      }), { status: 200 }) as never
    );

    const res = await discoverUniverse('MOMENTUM', { enrich: false });
    const codes = res.candidates.map((c) => c.code).sort();
    expect(codes).toContain('005930');
    expect(codes).toContain('247540');
    expect(res.diagnostics.googleQueries).toBeGreaterThan(0);
    expect(res.diagnostics.budgetExceeded).toBe(false);
    expect(res.diagnostics.sourceStatus).toBe('GOOGLE_OK');
    expect(res.diagnostics.fallbackUsed).toBe(false);
  });

  it('동일 종목이 여러 출처에 등장하면 sources 누적 + 우선순위 ↑', async () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'test-key';
    process.env.GOOGLE_SEARCH_CX = 'test-cx';
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
      { code: '247540', name: '에코프로비엠', market: 'KOSDAQ' },
    ]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        items: [
          { title: '삼성전자', link: 'a', snippet: '삼성전자', displayLink: 'naver.com' },
          { title: '삼성전자', link: 'b', snippet: '삼성전자', displayLink: 'hankyung.com' },
          { title: '에코프로비엠', link: 'c', snippet: '에코프로비엠', displayLink: 'mk.co.kr' },
        ],
      }), { status: 200 }) as never
    );

    const res = await discoverUniverse('MOMENTUM', { enrich: false, maxCandidates: 5 });
    const samsung = res.candidates.find((c) => c.code === '005930')!;
    expect(samsung.discoveredFrom.length).toBeGreaterThanOrEqual(2);
    // sources 가 더 많은 종목이 정렬 상위
    expect(res.candidates[0].code).toBe('005930');
  });

  it('enrichKnownStock — 마스터에 없는 코드는 null', async () => {
    setStockMaster([{ code: '005930', name: '삼성전자', market: 'KOSPI' }]);
    const result = await enrichKnownStock('999999');
    expect(result).toBeNull();
  });

  it('enrichKnownStock — 마스터에 있는 코드는 entry + snapshot 시도', async () => {
    setStockMaster([{ code: '005930', name: '삼성전자', market: 'KOSPI' }]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not-found', { status: 404 }) as never
    );
    const result = await enrichKnownStock('005930');
    expect(result?.code).toBe('005930');
    expect(result?.snapshot).toBeNull();
    expect(result?.discoveredFrom).toEqual(['known']);
  });
});
