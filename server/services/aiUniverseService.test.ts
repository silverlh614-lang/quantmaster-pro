/**
 * @responsibility aiUniverseService 통합 회귀 테스트 — PR-25-A, ADR-0011, PR-37
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
  saveAiUniverseSnapshot,
  __testOnly as __snapshotTestOnly,
} from '../persistence/aiUniverseSnapshotRepo.js';
import {
  AI_CALL_BUDGET_FILE,
  KRX_STOCK_MASTER_FILE,
  aiUniverseSnapshotFile,
} from '../persistence/paths.js';
import { resetNaverNegativeCache } from '../clients/naverFinanceClient.js';

function cleanFiles(): void {
  for (const f of [AI_CALL_BUDGET_FILE, KRX_STOCK_MASTER_FILE]) {
    try { fs.unlinkSync(f); } catch { /* not present */ }
  }
  for (const m of ['MOMENTUM', 'EARLY_DETECT', 'QUANT_SCREEN', 'BEAR_SCREEN', 'SMALL_MID_CAP']) {
    try { fs.unlinkSync(aiUniverseSnapshotFile(m)); } catch { /* not present */ }
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
    resetNaverNegativeCache();
    delete process.env.AI_UNIVERSE_FALLBACK_DISABLED;
    delete process.env.DATA_FETCH_FORCE_OFF;
    delete process.env.DATA_FETCH_FORCE_MARKET;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanFiles();
    __masterTestOnly.reset();
    __budgetTestOnly.reset();
    resetNaverNegativeCache();
    delete process.env.AI_UNIVERSE_FALLBACK_DISABLED;
    delete process.env.DATA_FETCH_FORCE_OFF;
    delete process.env.DATA_FETCH_FORCE_MARKET;
    vi.restoreAllMocks();
  });

  it('MODE_QUERIES — 5개 mode 모두 쿼리 정의됨 (PR-39 SMALL_MID_CAP 포함)', () => {
    expect(__testOnly.MODE_QUERIES.MOMENTUM.length).toBeGreaterThan(0);
    expect(__testOnly.MODE_QUERIES.QUANT_SCREEN.length).toBeGreaterThan(0);
    expect(__testOnly.MODE_QUERIES.BEAR_SCREEN.length).toBeGreaterThan(0);
    expect(__testOnly.MODE_QUERIES.EARLY_DETECT.length).toBeGreaterThan(0);
    expect(__testOnly.MODE_QUERIES.SMALL_MID_CAP.length).toBeGreaterThan(0);
  });

  it('PR-39: buildSeedFallback SMALL_MID_CAP 은 LARGE_MOMENTUM(초대형주)을 제외하고 GROWTH_MID 만 반환', () => {
    const seed = __testOnly.buildSeedFallback('SMALL_MID_CAP', 8);
    expect(seed.length).toBeGreaterThan(0);
    // 삼성전자/SK하이닉스/현대차/기아 — LARGE_MOMENTUM 단일 태그 또는 LARGE_MOMENTUM+VALUE
    expect(seed.every((e) => !['005930', '000660', '005380', '000270'].includes(e.code))).toBe(true);
    // KOSDAQ GROWTH_MID 가 최소 1개 포함 — 에코프로비엠/에코프로/셀트리온헬스케어/알테오젠/엘앤에프
    expect(seed.some((e) => ['247540', '086520', '091990', '196170', '066970'].includes(e.code))).toBe(true);
  });

  it('Google Search 미설정 + AI_UNIVERSE_FALLBACK_DISABLED — Tier 5 즉시 (ADR-0011 호환)', async () => {
    process.env.AI_UNIVERSE_FALLBACK_DISABLED = 'true';
    setStockMaster([{ code: '005930', name: '삼성전자', market: 'KOSPI' }]);
    try {
      const res = await discoverUniverse('MOMENTUM', { enrich: false });
      expect(res.candidates.length).toBeGreaterThan(0);
      expect(res.diagnostics.googleHits).toBe(0);
      expect(res.diagnostics.budgetExceeded).toBe(false);
      // Tier 5 직행 — sourceStatus=FALLBACK_SEED, tierAttempts 의 첫 entry 에 NOT_CONFIGURED 보존
      expect(res.diagnostics.sourceStatus).toBe('FALLBACK_SEED');
      expect(res.diagnostics.tierAttempts[0]).toBe('NOT_CONFIGURED');
      expect(res.diagnostics.fallbackUsed).toBe(true);
      expect(res.candidates.every((c) => /^\d{6}$/.test(c.code))).toBe(true);
      expect(res.candidates.every((c) => c.discoveredFrom.includes('seed:market_leaders'))).toBe(true);
    } finally {
      delete process.env.AI_UNIVERSE_FALLBACK_DISABLED;
    }
  });

  it('Google Search 미설정 + mode=BEAR_SCREEN — 5-tier 사슬 끝까지 진행 후 SEED 도달', async () => {
    process.env.AI_UNIVERSE_FALLBACK_DISABLED = 'true';
    setStockMaster([]);
    try {
      const res = await discoverUniverse('BEAR_SCREEN', { enrich: false, maxCandidates: 10 });
      expect(res.diagnostics.sourceStatus).toBe('FALLBACK_SEED');
      expect(res.diagnostics.tierAttempts[0]).toBe('NOT_CONFIGURED');
      expect(res.diagnostics.fallbackUsed).toBe(true);
      const codes = res.candidates.map((c) => c.code);
      // 방어주·유틸리티 1순위: 한국전력/SK텔레콤/KT&G/CJ제일제당 중 최소 1개 포함
      expect(codes.some((c) => ['015760', '017670', '033780', '097950'].includes(c))).toBe(true);
    } finally {
      delete process.env.AI_UNIVERSE_FALLBACK_DISABLED;
    }
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

// ── PR-37 (ADR-0016) — 5-Tier Fallback 시나리오 ─────────────────────────────
describe('aiUniverseService — 5-Tier Fallback (PR-37, ADR-0016)', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_SEARCH_API_KEY;
    delete process.env.GOOGLE_SEARCH_CX;
    delete process.env.AI_UNIVERSE_FALLBACK_DISABLED;
    delete process.env.DATA_FETCH_FORCE_OFF;
    delete process.env.DATA_FETCH_FORCE_MARKET;
    cleanFiles();
    __masterTestOnly.reset();
    __budgetTestOnly.reset();
    resetNaverNegativeCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanFiles();
    __masterTestOnly.reset();
    __budgetTestOnly.reset();
    resetNaverNegativeCache();
    delete process.env.AI_UNIVERSE_FALLBACK_DISABLED;
    delete process.env.DATA_FETCH_FORCE_OFF;
    delete process.env.DATA_FETCH_FORCE_MARKET;
    vi.restoreAllMocks();
  });

  it('Tier 1 성공 → snapshot 갱신 (≥3 candidates)', async () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'test-key';
    process.env.GOOGLE_SEARCH_CX = 'test-cx';
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI' },
      { code: '247540', name: '에코프로비엠', market: 'KOSDAQ' },
      { code: '035420', name: 'NAVER', market: 'KOSPI' },
    ]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        items: [
          { title: '삼성전자', link: 'a', snippet: '삼성전자', displayLink: 'naver.com' },
          { title: 'SK하이닉스', link: 'b', snippet: 'SK하이닉스', displayLink: 'hankyung.com' },
          { title: '에코프로비엠', link: 'c', snippet: '에코프로비엠', displayLink: 'mk.co.kr' },
          { title: 'NAVER', link: 'd', snippet: 'NAVER', displayLink: 'sedaily.com' },
        ],
      }), { status: 200 }) as never
    );

    const res = await discoverUniverse('MOMENTUM', { enrich: false, maxCandidates: 5 });
    expect(res.diagnostics.sourceStatus).toBe('GOOGLE_OK');
    expect(res.diagnostics.tierAttempts).toEqual(['GOOGLE_OK']);
    expect(res.candidates.length).toBeGreaterThanOrEqual(3);

    // snapshot 갱신 확인 — 디스크에 파일이 생성됐어야 함
    expect(fs.existsSync(aiUniverseSnapshotFile('MOMENTUM'))).toBe(true);
    __snapshotTestOnly.removeSnapshotFile('MOMENTUM');
  });

  it('Tier 1 실패 + snapshot 보유 → Tier 2 (FALLBACK_SNAPSHOT)', async () => {
    // 사전: snapshot 파일 작성 (Tier 1 시뮬레이션의 결과를 가정)
    setStockMaster([{ code: '005930', name: '삼성전자', market: 'KOSPI' }]);
    saveAiUniverseSnapshot('MOMENTUM', {
      mode: 'MOMENTUM',
      generatedAt: Date.now(), // 같은 시각 — 만료 X
      tradingDate: '2026-04-23',
      marketMode: 'AFTER_MARKET',
      sourceStatus: 'GOOGLE_OK',
      candidates: [
        { code: '005930', name: '삼성전자', market: 'KOSPI', sources: ['naver.com'] },
        { code: '000660', name: 'SK하이닉스', market: 'KOSPI', sources: ['hankyung.com'] },
        { code: '247540', name: '에코프로비엠', market: 'KOSDAQ', sources: ['mk.co.kr'] },
      ],
      diagnostics: {
        googleQueries: 2, googleHits: 5, masterMisses: 0,
        enrichSucceeded: 0, enrichFailed: 0, budgetExceeded: false,
        sourceStatus: 'GOOGLE_OK', fallbackUsed: false,
        marketMode: 'AFTER_MARKET', tradingDateRef: '2026-04-23',
        snapshotAgeDays: null, tierAttempts: ['GOOGLE_OK'],
      },
    });

    // Tier 1 실패 — Google 미설정
    delete process.env.GOOGLE_SEARCH_API_KEY;
    delete process.env.GOOGLE_SEARCH_CX;

    const res = await discoverUniverse('MOMENTUM', { enrich: false });
    expect(res.diagnostics.sourceStatus).toBe('FALLBACK_SNAPSHOT');
    expect(res.diagnostics.tierAttempts).toContain('NOT_CONFIGURED');
    expect(res.diagnostics.tierAttempts).toContain('FALLBACK_SNAPSHOT');
    expect(res.diagnostics.fallbackUsed).toBe(true);
    expect(res.diagnostics.tradingDateRef).toBe('2026-04-23');
    expect(res.diagnostics.snapshotAgeDays).toBeGreaterThanOrEqual(0);
    expect(res.candidates.length).toBeGreaterThanOrEqual(3);
    expect(res.candidates.map((c) => c.code)).toContain('005930');
    __snapshotTestOnly.removeSnapshotFile('MOMENTUM');
  });

  it('Tier 1+2 실패 + Tier 3 Yahoo 응답 정상 → FALLBACK_QUANT', async () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI' },
      { code: '373220', name: 'LG에너지솔루션', market: 'KOSPI' },
      { code: '207940', name: '삼성바이오로직스', market: 'KOSPI' },
      { code: '005380', name: '현대차', market: 'KOSPI' },
      { code: '000270', name: '기아', market: 'KOSPI' },
    ]);
    process.env.DATA_FETCH_FORCE_MARKET = 'true'; // EgressGuard pass
    // Yahoo 25봉 응답 — 5건 이상 성공해야 stale=false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const closes = Array.from({ length: 25 }, (_, i) => 100 + i);
      const ts = closes.map((_, i) => Math.floor(new Date(`2026-04-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`).getTime() / 1000));
      return new Response(JSON.stringify({
        chart: {
          result: [{
            timestamp: ts,
            indicators: { quote: [{ close: closes, high: closes, low: closes, volume: closes.map(() => 1_000_000) }] },
            meta: { fiftyTwoWeekHigh: 124 },
          }],
        },
      }), { status: 200 }) as Response;
    });

    const res = await discoverUniverse('MOMENTUM', { enrich: false, maxCandidates: 5 });
    expect(res.diagnostics.sourceStatus).toBe('FALLBACK_QUANT');
    expect(res.diagnostics.tierAttempts).toContain('FALLBACK_QUANT');
    expect(res.diagnostics.fallbackUsed).toBe(true);
    expect(res.diagnostics.marketMode).toBe('DEGRADED');
    expect(res.candidates.length).toBeGreaterThan(0);
  });

  it('Tier 1+2+3 실패 → Tier 4 Naver 단독', async () => {
    setStockMaster([{ code: '005930', name: '삼성전자', market: 'KOSPI' }]);
    process.env.DATA_FETCH_FORCE_OFF = 'true'; // EgressGuard 가 Yahoo 차단

    // Naver 응답: snapshot 200 OK
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('m.stock.naver.com/api/stock/')) {
        const code = url.match(/api\/stock\/(\d{6})\//)?.[1] ?? '';
        return new Response(JSON.stringify({
          stockName: `종목${code}`,
          closePrice: 100,
          fluctuationsRatio: 0.5,
          totalInfos: [
            { code: 'marketValue', value: 100_000_000_000 },
            { code: 'per', value: 12 },
            { code: 'pbr', value: 1.2 },
            { code: 'eps', value: 8 },
            { code: 'bps', value: 80 },
            { code: 'dividendRatio', value: 1.5 },
            { code: 'foreignerOwnRatio', value: 30 },
          ],
        }), { status: 200 }) as Response;
      }
      return new Response('{}', { status: 404 }) as Response;
    });

    const res = await discoverUniverse('MOMENTUM', { enrich: false, maxCandidates: 5 });
    expect(res.diagnostics.sourceStatus).toBe('FALLBACK_NAVER');
    expect(res.diagnostics.tierAttempts).toContain('FALLBACK_NAVER');
    expect(res.diagnostics.fallbackUsed).toBe(true);
    expect(res.diagnostics.marketMode).toBe('DEGRADED');
    expect(res.candidates.length).toBeGreaterThan(0);
    expect(res.candidates[0].snapshot).not.toBeNull();
  });

  it('AI_UNIVERSE_FALLBACK_DISABLED=true → Tier 1 실패 → Tier 5 즉시 (Tier 2/3/4 스킵)', async () => {
    process.env.AI_UNIVERSE_FALLBACK_DISABLED = 'true';
    setStockMaster([]);
    const res = await discoverUniverse('MOMENTUM', { enrich: false, maxCandidates: 5 });
    expect(res.diagnostics.sourceStatus).toBe('FALLBACK_SEED');
    // tierAttempts 가 NOT_CONFIGURED → FALLBACK_SEED 만 (Tier 2/3/4 항목 없음)
    expect(res.diagnostics.tierAttempts).toEqual(['NOT_CONFIGURED', 'FALLBACK_SEED']);
    expect(res.candidates.length).toBeGreaterThan(0);
  });
});
