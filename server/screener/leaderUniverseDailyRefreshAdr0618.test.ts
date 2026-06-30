/**
 * @responsibility ADR-0618 주도주 일일 신선 갱신 회귀 — flag OFF byte-identical·LEADER 3키 한정·TTL upsert·주간 무영향·cron 정적가드.
 *
 * leaderUniverseDailyRefreshAdr0618.test.ts
 *
 * 검증:
 *   1. flag OFF → cron 콜백 단락(fetch 0·dynamic-universe.json 미변경, byte-identical)
 *   2. flag ON → LEADER 3키만 수집(market-cap·institutional-net-buy·volume)
 *   3. fluctuation/large-volume/short-balance 키 미호출
 *   4. 단축 TTL 3일(LEADER_REFRESH_TTL_DAYS)
 *   5. 같은 code 충돌 → expiresAt 일일 TTL upsert(연장) + source LEADER 재기입(refreshExisting=true)
 *   6. 주간 비주도 엔트리(MID_RISER 등) 무영향(expiresAt·source 보존)
 *   7. expandOnEmpty byte-identical(refreshExisting=false — 기존 dedup skip 보존)
 *   8. 랭킹 부분 실패(allSettled) 격리 → throw 0
 *   9. cron 등록 정적 가드(TRADING_DAY_ONLY · 10 23 * * 0-4 · flag 단락)
 *  10. ENV SSOT isLeaderUniverseDailyRefreshEnabled === 'true' 정확비교
 */

import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderdaily-test-'));
process.env.PERSIST_DATA_DIR = TEST_DATA_DIR;

vi.mock('../clients/kisRankingClient.js', () => ({
  getRanking: vi.fn(async () => []),
  resetRankingCache: vi.fn(),
  getRankingCacheSnapshot: vi.fn(() => []),
}));

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
}));

import {
  runLeaderUniverseDailyRefresh,
  isLeaderUniverseDailyRefreshEnabled,
  LEADER_REFRESH_TTL_DAYS,
  expandOnEmpty,
  loadDynamicUniverse,
  type DynamicStock,
} from './dynamicUniverseExpander.js';
import { getRanking } from '../clients/kisRankingClient.js';
import { DATA_DIR } from '../persistence/paths.js';

const DYNAMIC_FILE = path.join(DATA_DIR, 'dynamic-universe.json');
const ORIGINAL_EXISTED = fs.existsSync(DYNAMIC_FILE);
const ORIGINAL_CONTENT = ORIGINAL_EXISTED ? fs.readFileSync(DYNAMIC_FILE, 'utf-8') : null;

type Row = { code: string; name: string; rank: number; value: number; changePercent: number; market: 'KOSPI' | 'KOSDAQ' };
const entry = (code: string, value = 1000, cp = 1): Row =>
  ({ code, name: `종목${code}`, rank: 1, value, changePercent: cp, market: 'KOSPI' });

function writeDynamic(rows: DynamicStock[]): void {
  fs.writeFileSync(DYNAMIC_FILE, JSON.stringify(rows, null, 2));
}

describe('ADR-0618 — 주도주 일일 신선 갱신', () => {
  beforeEach(() => {
    if (fs.existsSync(DYNAMIC_FILE)) fs.unlinkSync(DYNAMIC_FILE);
    vi.mocked(getRanking).mockReset().mockImplementation(async () => []);
    delete process.env.LEADER_DAILY_REFRESH_ENABLED;
    // ADR-0652 — LEADER_RANKING_ENDPOINT_FIX_ENABLED 는 default ON(`!== 'false'`)이라
    // FOREIGN_NET_BUY 소스가 'volume'(구 대용) 대신 정본 'foreign-net-buy' 키를 쓴다.
    // 프로덕션 default 동작을 결정적으로 검증하기 위해 명시 고정한다.
    process.env.LEADER_RANKING_ENDPOINT_FIX_ENABLED = 'true';
  });

  afterAll(() => {
    delete process.env.LEADER_RANKING_ENDPOINT_FIX_ENABLED;
    try { fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* 무시 */ }
    try {
      if (ORIGINAL_CONTENT != null) fs.writeFileSync(DYNAMIC_FILE, ORIGINAL_CONTENT);
      else if (fs.existsSync(DYNAMIC_FILE)) fs.unlinkSync(DYNAMIC_FILE);
    } catch { /* 무시 */ }
  });

  // ── 1. flag OFF → cron 콜백 단락(byte-identical) ────────────────────────────
  it('1. flag OFF → cron 콜백 단락 — 랭킹 fetch 0·dynamic-universe.json 미변경(byte-identical)', async () => {
    delete process.env.LEADER_DAILY_REFRESH_ENABLED;
    // cron 콜백 시뮬레이션: flag OFF 면 즉시 단락(runLeaderUniverseDailyRefresh 미호출).
    const callback = () => {
      if (!isLeaderUniverseDailyRefreshEnabled()) return undefined;
      return runLeaderUniverseDailyRefresh();
    };
    const before = fs.existsSync(DYNAMIC_FILE);
    await callback();
    expect(vi.mocked(getRanking)).not.toHaveBeenCalled();
    expect(fs.existsSync(DYNAMIC_FILE)).toBe(before); // 파일 생성/변경 0
  });

  // ── 2. flag ON → LEADER 3키만 수집 ──────────────────────────────────────────
  it('2. flag ON → LEADER 3키만 수집(market-cap·institutional-net-buy·foreign-net-buy)', async () => {
    process.env.LEADER_DAILY_REFRESH_ENABLED = 'true';
    await runLeaderUniverseDailyRefresh();
    const called = vi.mocked(getRanking).mock.calls.map(c => c[0]);
    // ADR-0652 default-ON: FOREIGN_NET_BUY 소스 키 = 'foreign-net-buy'(구 'volume' 대체).
    expect(new Set(called)).toEqual(new Set(['market-cap', 'institutional-net-buy', 'foreign-net-buy']));
    expect(called.length).toBe(3);
  });

  // ── 3. fluctuation/large-volume/short-balance 미호출 ────────────────────────
  it('3. fluctuation/large-volume/short-balance 키 미호출(주간 유지)', async () => {
    process.env.LEADER_DAILY_REFRESH_ENABLED = 'true';
    await runLeaderUniverseDailyRefresh();
    const called = vi.mocked(getRanking).mock.calls.map(c => c[0]);
    expect(called).not.toContain('fluctuation');
    expect(called).not.toContain('large-volume');
    expect(called).not.toContain('short-balance');
  });

  // ── 4. 단축 TTL 3일 ─────────────────────────────────────────────────────────
  it('4. 단축 TTL = LEADER_REFRESH_TTL_DAYS(3일) per-entry expiresAt', async () => {
    expect(LEADER_REFRESH_TTL_DAYS).toBe(3);
    process.env.LEADER_DAILY_REFRESH_ENABLED = 'true';
    vi.mocked(getRanking).mockImplementation(async (type) =>
      type === 'market-cap' ? [entry('900001')] : []);
    const t0 = Date.now();
    await runLeaderUniverseDailyRefresh();
    const rows = loadDynamicUniverse();
    const r = rows.find(x => x.code === '900001');
    expect(r).toBeDefined();
    const ttlMs = new Date(r!.expiresAt).getTime() - t0;
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    expect(ttlMs).toBeGreaterThan(threeDays - 60_000);
    expect(ttlMs).toBeLessThan(threeDays + 60_000);
  });

  // ── 5. 같은 code 충돌 → upsert(연장) + source 재기입 ────────────────────────
  it('5. 같은 code 주간 엔트리 → expiresAt 일일 TTL 연장 + source LEADER 재기입(refreshExisting=true)', async () => {
    // 주간 14일 엔트리(다른 source) 선존재.
    const oldExpiry = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    const admissible = '900002';
    writeDynamic([
      { symbol: `${admissible}.KS`, code: admissible, name: '구주도주', source: 'FOREIGN_NET_BUY', addedAt: new Date().toISOString(), expiresAt: oldExpiry },
    ]);
    process.env.LEADER_DAILY_REFRESH_ENABLED = 'true';
    // 일일 갱신이 market-cap 으로 같은 code 재발견.
    vi.mocked(getRanking).mockImplementation(async (type) =>
      type === 'market-cap' ? [entry(admissible)] : []);
    await runLeaderUniverseDailyRefresh();
    const rows = loadDynamicUniverse();
    const r = rows.find(x => x.code === admissible);
    expect(r).toBeDefined();
    // expiresAt 가 14일 → 3일로 단축(upsert), source 가 MARKET_CAP 으로 재기입.
    expect(new Date(r!.expiresAt).getTime()).toBeLessThan(new Date(oldExpiry).getTime());
    expect(r!.source).toBe('MARKET_CAP');
    // 중복 추가 없음(단일 엔트리).
    expect(rows.filter(x => x.code === admissible).length).toBe(1);
  });

  // ── 6. 주간 비주도 엔트리 무영향 ────────────────────────────────────────────
  it('6. 주간 비주도 엔트리(MID_RISER) 무영향 — expiresAt·source 보존', async () => {
    const midExpiry = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    writeDynamic([
      { symbol: '900003.KS', code: '900003', name: '중위권', source: 'MID_RISER', addedAt: new Date().toISOString(), expiresAt: midExpiry },
    ]);
    process.env.LEADER_DAILY_REFRESH_ENABLED = 'true';
    // 일일 갱신은 900003 을 수집하지 않음(LEADER 키만).
    vi.mocked(getRanking).mockImplementation(async () => []);
    await runLeaderUniverseDailyRefresh();
    const rows = loadDynamicUniverse();
    const r = rows.find(x => x.code === '900003');
    expect(r).toBeDefined();
    expect(r!.source).toBe('MID_RISER');           // source 보존
    expect(r!.expiresAt).toBe(midExpiry);          // expiresAt 보존(연장 안 함)
  });

  // ── 7. expandOnEmpty byte-identical (refreshExisting=false) ─────────────────
  it('7. expandOnEmpty 는 기존 dedup skip 보존 — 기존 동적 엔트리 expiresAt/source 미변경', async () => {
    const oldExpiry = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
    writeDynamic([
      { symbol: '900004.KS', code: '900004', name: '기존', source: 'FOREIGN_NET_BUY', addedAt: new Date().toISOString(), expiresAt: oldExpiry },
    ]);
    // volume 랭킹이 같은 code 재발견해도 expandOnEmpty 는 skip(연장 안 함).
    vi.mocked(getRanking).mockImplementation(async (type) =>
      type === 'volume' ? [entry('900004')] : []);
    const newCount = await expandOnEmpty();
    const rows = loadDynamicUniverse();
    const r = rows.find(x => x.code === '900004');
    expect(r!.expiresAt).toBe(oldExpiry);          // 연장 안 함(byte-identical)
    expect(r!.source).toBe('FOREIGN_NET_BUY');     // source 재기입 안 함
    expect(newCount).toBe(0);                      // 기존 code → 신규 0
  });

  it('7-b. expandOnEmpty 는 여전히 5키 호출(LEADER 3키로 축소 안 됨)', async () => {
    await expandOnEmpty();
    const called = vi.mocked(getRanking).mock.calls.map(c => c[0]);
    // ADR-0652 default-ON: FOREIGN_NET_BUY 소스 키 = 'foreign-net-buy'(구 'volume' 대체).
    expect(new Set(called)).toEqual(new Set([
      'foreign-net-buy', 'fluctuation', 'market-cap', 'institutional-net-buy', 'large-volume',
    ]));
    expect(called.length).toBe(5);
  });

  // ── 8. 랭킹 부분 실패 격리 ──────────────────────────────────────────────────
  it('8. 랭킹 부분 실패(allSettled) → throw 0·격리', async () => {
    process.env.LEADER_DAILY_REFRESH_ENABLED = 'true';
    vi.mocked(getRanking).mockImplementation(async (type) => {
      if (type === 'market-cap') throw new Error('KIS 일시장애');
      // ADR-0652 default-ON: FOREIGN_NET_BUY 소스 키 = 'foreign-net-buy'(value>0 필터 통과).
      if (type === 'foreign-net-buy') return [entry('900005')];
      return [];
    });
    await expect(runLeaderUniverseDailyRefresh()).resolves.toBeGreaterThanOrEqual(0);
    const rows = loadDynamicUniverse();
    // 실패한 market-cap 외 foreign-net-buy 결과는 보존.
    expect(rows.some(x => x.code === '900005')).toBe(true);
  });

  // ── 10. ENV SSOT 정확비교 ───────────────────────────────────────────────────
  it('10. isLeaderUniverseDailyRefreshEnabled — `=== "true"` 정확비교(default OFF)', () => {
    expect(isLeaderUniverseDailyRefreshEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isLeaderUniverseDailyRefreshEnabled({ LEADER_DAILY_REFRESH_ENABLED: 'false' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isLeaderUniverseDailyRefreshEnabled({ LEADER_DAILY_REFRESH_ENABLED: '1' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isLeaderUniverseDailyRefreshEnabled({ LEADER_DAILY_REFRESH_ENABLED: 'TRUE' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isLeaderUniverseDailyRefreshEnabled({ LEADER_DAILY_REFRESH_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

// ── 9. cron 등록 정적 가드 ────────────────────────────────────────────────────
describe('ADR-0618 — leader_universe_daily_refresh cron 정적 가드', () => {
  const SRC = fs.readFileSync(path.resolve(__dirname, '../scheduler/screenerJobs.ts'), 'utf-8');
  const CATALOG = fs.readFileSync(path.resolve(__dirname, '../scheduler/scheduleCatalog.ts'), 'utf-8');

  it('9-a. screenerJobs.ts — TRADING_DAY_ONLY + `10 23 * * 0-4` 등록', () => {
    expect(SRC).toMatch(
      /scheduledJob\(\s*['"]10 23 \* \* 0-4['"]\s*,\s*['"]TRADING_DAY_ONLY['"]\s*,\s*['"]leader_universe_daily_refresh['"]/,
    );
  });

  it('9-b. 콜백 본체 flag 단락 — isLeaderUniverseDailyRefreshEnabled 즉시 return', () => {
    expect(SRC).toMatch(/if\s*\(\s*!isLeaderUniverseDailyRefreshEnabled\(\)\s*\)\s*return/);
  });

  it('9-c. scheduleCatalog.ts — leader_universe_daily_refresh 행(silentWhen 무음)', () => {
    expect(CATALOG).toMatch(/jobName:\s*['"]leader_universe_daily_refresh['"]/);
    expect(CATALOG).toMatch(/leader_universe_daily_refresh[\s\S]{0,200}?silentWhen/);
  });
});
