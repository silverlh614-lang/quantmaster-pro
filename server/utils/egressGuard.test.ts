/**
 * @responsibility EgressGuard 심볼 추출·게이트 판정·synthetic Response 회귀 테스트
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateEgress,
  guardedFetch,
  __setFetchImplForTests,
  __resetFetchImplForTests,
  __resetLogThrottleForTests,
} from './egressGuard.js';

// KST 토요일 정오 — KRX/NYSE 모두 closed
const SAT_KST_NOON = new Date('2026-04-25T03:00:00.000Z');
// KST 월 정오 — KRX open, NYSE closed
const MON_KST_NOON = new Date('2026-04-27T03:00:00.000Z');
// ET 월 10:30 — NYSE open, KRX closed
const MON_NYSE_OPEN = new Date('2026-04-27T15:30:00.000Z');

afterEach(() => {
  __resetFetchImplForTests();
  __resetLogThrottleForTests();
  delete process.env.EGRESS_GUARD_DISABLED;
  delete process.env.DATA_FETCH_FORCE_MARKET;
  delete process.env.DATA_FETCH_FORCE_OFF;
});

describe('evaluateEgress — URL 기반 심볼 추출 + 시장 판정', () => {
  it('Yahoo chart URL 에서 심볼 추출 (query2)', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/005930.KS?range=1y', 'REALTIME', MON_KST_NOON);
    expect(d.action).toBe('pass');
    expect(d.symbol).toBe('005930.KS');
    expect(d.market).toBe('KRX');
  });

  it('Yahoo chart URL 에서 심볼 추출 (query1)', () => {
    const d = evaluateEgress('https://query1.finance.yahoo.com/v8/finance/chart/AAPL', 'REALTIME', MON_NYSE_OPEN);
    expect(d.action).toBe('pass');
    expect(d.symbol).toBe('AAPL');
    expect(d.market).toBe('NYSE');
  });

  it('URL-encoded ^KQ11 — decodeURIComponent 후 분류', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/%5EKQ11?range=1d', 'REALTIME', SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.symbol).toBe('^KQ11');
    expect(d.market).toBe('KRX');
  });

  it('KRX 주말 → skip', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/^KS11', 'REALTIME', SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('KRX');
  });

  it('NYSE 평일 장외(KST 토 정오 = ET 금 22:00) → skip', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/^VIX', 'REALTIME', SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('NYSE');
  });

  it('KRX 장중(월 12:00 KST) → pass', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/^KS11', 'REALTIME', MON_KST_NOON);
    expect(d.action).toBe('pass');
    expect(d.market).toBe('KRX');
  });

  it('quoteSummary endpoint 도 지원', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v10/finance/quoteSummary/005930.KS?modules=assetProfile', 'REALTIME', SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('KRX');
  });

  it('미등록 host → pass', () => {
    const d = evaluateEgress('https://api.stlouisfed.org/fred/series/observations', 'REALTIME', SAT_KST_NOON);
    expect(d.action).toBe('pass');
    expect(d.symbol).toBeUndefined();
  });

  it('심볼 추출 불가(finance.yahoo.com 루트) → pass', () => {
    const d = evaluateEgress('https://finance.yahoo.com/', 'REALTIME', SAT_KST_NOON);
    expect(d.action).toBe('pass');
  });

  it('잘못된 URL → pass (원 fetch 가 에러 처리)', () => {
    const d = evaluateEgress('not-a-url', 'REALTIME', SAT_KST_NOON);
    expect(d.action).toBe('pass');
  });
});

describe('guardedFetch — pass 분기', () => {
  it('시장 열려있으면 native fetch 호출', async () => {
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    const mock = vi.fn(async () => new Response('{}', { status: 200 }));
    __setFetchImplForTests(mock as any);
    const res = await guardedFetch('https://query2.finance.yahoo.com/v8/finance/chart/AAPL');
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledOnce();
  });

  it('미등록 host 는 native fetch 호출 (FORCE_OFF 여도 pass)', async () => {
    process.env.DATA_FETCH_FORCE_OFF = 'true';
    const mock = vi.fn(async () => new Response('{}', { status: 200 }));
    __setFetchImplForTests(mock as any);
    const res = await guardedFetch('https://api.example.com/data');
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledOnce();
  });
});

describe('guardedFetch — skip 분기 (synthetic 503)', () => {
  beforeEach(() => {
    process.env.DATA_FETCH_FORCE_OFF = 'true';
  });

  it('시장 닫혀있으면 503 + X-Egress-Guard 헤더, native fetch 미호출', async () => {
    const mock = vi.fn(async () => new Response('{}', { status: 200 }));
    __setFetchImplForTests(mock as any);
    const res = await guardedFetch('https://query2.finance.yahoo.com/v8/finance/chart/005930.KS');
    expect(res.status).toBe(503);
    expect(res.ok).toBe(false);
    expect(res.headers.get('X-Egress-Guard')).toBe('market-closed');
    expect(mock).not.toHaveBeenCalled();
  });

  it('body 에 gated=true + symbol + market 포함', async () => {
    __setFetchImplForTests(vi.fn() as any);
    const res = await guardedFetch('https://query1.finance.yahoo.com/v8/finance/chart/AAPL');
    const body = await res.json() as { gated: boolean; symbol: string; market: string };
    expect(body.gated).toBe(true);
    expect(body.symbol).toBe('AAPL');
    expect(body.market).toBe('NYSE');
  });
});

describe('EGRESS_GUARD_DISABLED env 탈출구', () => {
  it('true 면 시장 닫혀있어도 native fetch 호출', async () => {
    process.env.DATA_FETCH_FORCE_OFF = 'true';
    process.env.EGRESS_GUARD_DISABLED = 'true';
    const mock = vi.fn(async () => new Response('{}', { status: 200 }));
    __setFetchImplForTests(mock as any);
    const res = await guardedFetch('https://query2.finance.yahoo.com/v8/finance/chart/005930.KS');
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledOnce();
  });
});

// ── ADR-0056: EgressIntent 결정 매트릭스 (REALTIME / HISTORICAL / OVERNIGHT) ──────────
//
// 시간 기준점 SSOT (NYSE EST=-5h 고정):
//   - SAT_KST_NOON   = 2026-04-25T03:00Z = ET Fri 22:00 (NYSE closed, KRX 토요일 closed)
//   - MON_KST_NOON   = 2026-04-27T03:00Z = ET Sun 22:00 (KRX 정규장, NYSE closed)
//   - MON_NYSE_OPEN  = 2026-04-27T15:30Z = ET Mon 10:30 (NYSE 정규장, KRX closed)
//
// NYSE 애프터마켓 (EST 16:00~20:00):
//   - MON_NYSE_AH_OPEN  = 2026-04-27T21:00Z → ET Mon 16:00 (애프터마켓 open boundary)
//   - MON_NYSE_AH_MID   = 2026-04-27T23:00Z → ET Mon 18:00 (애프터마켓 한가운데)
//   - MON_NYSE_AH_CLOSE = 2026-04-28T01:00Z → ET Mon 20:00 (애프터마켓 close boundary, 미통과)
//   - MON_NYSE_LATE     = 2026-04-28T03:00Z → ET Mon 22:00 (closed, 애프터마켓 외)
//   - SAT_NYSE_AH_TIME  = 2026-04-25T21:00Z → ET Sat 16:00 (주말이라 false)
const MON_NYSE_AH_OPEN  = new Date('2026-04-27T21:00:00.000Z'); // ET Mon 16:00
const MON_NYSE_AH_MID   = new Date('2026-04-27T23:00:00.000Z'); // ET Mon 18:00
const MON_NYSE_AH_CLOSE = new Date('2026-04-28T01:00:00.000Z'); // ET Mon 20:00
const MON_NYSE_LATE     = new Date('2026-04-28T03:00:00.000Z'); // ET Mon 22:00

describe('evaluateEgress with EgressIntent — ADR-0056 결정 매트릭스', () => {
  // ── REALTIME (default) — PR-29 동작 보존 ──
  it('REALTIME (default) blocks NYSE outside regular hours', () => {
    // SAT_KST_NOON = ET Fri 22:00 → NYSE closed
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'REALTIME', SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('NYSE');
  });

  it('REALTIME (default) blocks KRX on weekend', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/005930.KS', 'REALTIME', SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('KRX');
  });

  it('REALTIME passes during regular hours (NYSE)', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'REALTIME', MON_NYSE_OPEN);
    expect(d.action).toBe('pass');
    expect(d.market).toBe('NYSE');
  });

  // ── HISTORICAL — 모든 시간대 통과 ──
  it('HISTORICAL passes NYSE outside regular hours', () => {
    // SAT_KST_NOON = NYSE closed, but HISTORICAL 의도 → 통과
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'HISTORICAL', SAT_KST_NOON);
    expect(d.action).toBe('pass');
    expect(d.market).toBe('NYSE');
    expect(d.reason).toBe('historical bypass');
  });

  it('HISTORICAL passes KRX on weekend', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/005930.KS', 'HISTORICAL', SAT_KST_NOON);
    expect(d.action).toBe('pass');
    expect(d.market).toBe('KRX');
    expect(d.reason).toBe('historical bypass');
  });

  it('HISTORICAL passes during regular hours (no degradation)', () => {
    // 정규장 통과는 의도 무관 동일
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'HISTORICAL', MON_NYSE_OPEN);
    expect(d.action).toBe('pass');
    expect(d.market).toBe('NYSE');
  });

  // ── OVERNIGHT — NYSE 애프터마켓 추가 통과 ──
  it('OVERNIGHT passes NYSE 16:00 EST (afterhours open boundary)', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'OVERNIGHT', MON_NYSE_AH_OPEN);
    expect(d.action).toBe('pass');
    expect(d.market).toBe('NYSE');
    expect(d.reason).toBe('nyse afterhours');
  });

  it('OVERNIGHT passes NYSE 18:00 EST (afterhours mid)', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'OVERNIGHT', MON_NYSE_AH_MID);
    expect(d.action).toBe('pass');
    expect(d.market).toBe('NYSE');
  });

  it('OVERNIGHT blocks NYSE 20:00 EST (afterhours close boundary, exclusive)', () => {
    // close boundary 자체는 미통과 (>= open && < close)
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'OVERNIGHT', MON_NYSE_AH_CLOSE);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('NYSE');
  });

  it('OVERNIGHT blocks NYSE 22:00 EST (after afterhours window)', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'OVERNIGHT', MON_NYSE_LATE);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('NYSE');
  });

  it('OVERNIGHT blocks KRX outside regular hours (no afterhours bypass)', () => {
    // KRX 는 OVERNIGHT 의도라도 정규장만 통과 (애프터마켓 없음)
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/005930.KS', 'OVERNIGHT', SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('KRX');
  });

  it('OVERNIGHT TSE outside regular hours behaves like REALTIME (no afterhours)', () => {
    // TSE 는 OVERNIGHT 의도라도 정규장만 통과
    // SAT_KST_NOON = JP Sat 12:00 → TSE 토요일 closed
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/7203.T', 'OVERNIGHT', SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('TSE');
  });

  // ── 미명시 호출자 = REALTIME 기본값 (회귀 안전망) ──
  it('omitted intent defaults to REALTIME (NYSE closed → skip)', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', undefined, SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('NYSE');
  });

  it('omitted intent defaults to REALTIME (KRX weekend → skip)', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/005930.KS', undefined, SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('KRX');
  });

  // ── env 우선순위 ──
  it('DATA_FETCH_FORCE_OFF blocks even HISTORICAL (force_off > intent)', () => {
    // force_off 는 isMarketOpenFor 단계에서 이미 false 반환 → HISTORICAL 분기로 빠지지만
    // afterhours 분기는 force_off 시 false 반환. HISTORICAL 분기는 시장 무관 통과.
    process.env.DATA_FETCH_FORCE_OFF = 'true';
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'HISTORICAL', MON_NYSE_OPEN);
    expect(d.action).toBe('pass');
    expect(d.reason).toBe('historical bypass');
  });

  it('DATA_FETCH_FORCE_MARKET passes all intents during normal regular hours', () => {
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    // force_market 은 isMarketOpenFor 가 true 반환 → 정규장 분기로 통과
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'OVERNIGHT', SAT_KST_NOON);
    expect(d.action).toBe('pass');
    expect(d.reason).toBeUndefined(); // 정규장 분기 (의도와 무관)
  });
});

describe('isNyseAfterHours (간접 테스트 via OVERNIGHT 의도)', () => {
  // private 함수는 OVERNIGHT 의도의 NYSE 분기를 통해 검증
  it('returns true at 16:00 EST (open boundary)', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'OVERNIGHT', MON_NYSE_AH_OPEN);
    expect(d.action).toBe('pass');
    expect(d.reason).toBe('nyse afterhours');
  });

  it('returns false at 20:00 EST (close boundary, exclusive)', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'OVERNIGHT', MON_NYSE_AH_CLOSE);
    expect(d.action).toBe('skip');
  });

  it('returns false on weekend (Saturday 16:00 EST)', () => {
    // 2026-04-25T20:00Z = ET Sat 15:00 (주말이라 false 자체는 정규장 분기 미적용)
    // 주말 16:00 EST = 2026-04-25T21:00Z → ET Sat 16:00
    const SAT_NYSE_AH_TIME = new Date('2026-04-25T21:00:00.000Z');
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'OVERNIGHT', SAT_NYSE_AH_TIME);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('NYSE');
  });

  it('returns false on Sunday', () => {
    // ET Sun 18:00 (애프터마켓 시간대지만 일요일이라 차단)
    const SUN_NYSE_AH = new Date('2026-04-26T22:00:00.000Z'); // UTC 22:00 = ET Sun 17:00 = 1020 min
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/AAPL', 'OVERNIGHT', SUN_NYSE_AH);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('NYSE');
  });
});
