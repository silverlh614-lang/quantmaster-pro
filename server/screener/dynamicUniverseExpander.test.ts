/**
 * dynamicUniverseExpander.test.ts — Phase A 실패 내성 검증
 *
 * 검증 목표: kisRankingClient의 모든 랭킹 호출이 null/throw로 실패해도
 *   1. expandOnEmpty()가 throw 없이 0을 반환하고
 *   2. getExpandedUniverse()가 정적 STOCK_UNIVERSE를 그대로 돌려주고
 *   3. dynamic-universe.json이 빈 상태(또는 기존 상태)로 유지된다.
 *
 * 즉, KIS 장애 시에도 호출자가 기존 정적 유니버스로 자연스럽게 폴백한다.
 */

import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// PERSIST_DATA_DIR을 일회용 디렉터리로 지정 — 저장된 JSON 파일이 실제 DATA_DIR을 오염시키지 않는다.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dynuniv-test-'));
process.env.PERSIST_DATA_DIR = TEST_DATA_DIR;

// kisRankingClient 전체를 mock — 모든 랭킹 호출이 실패(빈 배열)를 반환하는 시뮬레이션.
vi.mock('../clients/kisRankingClient.js', () => ({
  getRanking: vi.fn(async () => []),
  resetRankingCache: vi.fn(),
  getRankingCacheSnapshot: vi.fn(() => []),
}));

// Telegram side-effects 차단 (expandOnEmpty은 Telegram을 부르지 않지만
// 동일 파일의 runDynamicUniverseExpansion 경로가 있어 방어적으로 mock).
vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
}));

import {
  expandOnEmpty,
  getExpandedUniverse,
} from './dynamicUniverseExpander.js';
import { getRanking } from '../clients/kisRankingClient.js';
import { STOCK_UNIVERSE } from './stockScreener.js';
import { DATA_DIR } from '../persistence/paths.js';

// 주의: paths.ts는 module-load 시점에 DATA_DIR 을 확정하므로, 다른 테스트 파일에서
// 먼저 import된 경우 TEST_DATA_DIR이 아닌 production 경로가 쓰인다. 그래서
// 테스트는 실제 사용 중인 DATA_DIR 을 검증 기준으로 삼아 상태 격리한다.
const EFFECTIVE_DYNAMIC_FILE = path.join(DATA_DIR, 'dynamic-universe.json');
const DYNAMIC_FILE = EFFECTIVE_DYNAMIC_FILE;

describe('expandOnEmpty — KIS 실패 시 정적 유니버스 폴백', () => {
  beforeEach(() => {
    // 매 케이스 시작 시 dynamic-universe.json을 제거해 상태 격리.
    if (fs.existsSync(DYNAMIC_FILE)) fs.unlinkSync(DYNAMIC_FILE);
    // 기본 impl 재설정 — 빈 배열 반환이 실패 시뮬레이션의 기본.
    vi.mocked(getRanking).mockReset().mockImplementation(async () => []);
  });

  afterAll(() => {
    // 테스트 종료 후 임시 디렉터리 정리.
    try { fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* 무시 */ }
  });

  it('모든 랭킹 TR이 빈 배열을 반환하면 expandOnEmpty는 0을 돌려주고 throw 하지 않는다', async () => {
    const count = await expandOnEmpty();
    expect(count).toBe(0);

    // 아이디어 5: 기존 3종(volume/fluctuation/market-cap) + 신규 2종
    // (institutional-net-buy/large-volume)가 병렬 호출된다.
    const called = vi.mocked(getRanking).mock.calls.map(c => c[0]);
    expect(called).toEqual(expect.arrayContaining([
      'volume', 'fluctuation', 'market-cap',
      'institutional-net-buy', 'large-volume',
    ]));
    expect(called.length).toBe(5);
  });

  it('getExpandedUniverse는 KIS 실패 상황에서도 정적 STOCK_UNIVERSE 전부를 반환한다', async () => {
    await expandOnEmpty();
    const universe = getExpandedUniverse();
    expect(universe.length).toBeGreaterThanOrEqual(STOCK_UNIVERSE.length);
    const codes = new Set(universe.map(u => u.code));
    for (const staticEntry of STOCK_UNIVERSE.slice(0, 10)) {
      expect(codes.has(staticEntry.code)).toBe(true);
    }
  });

  it('getRanking이 rejection으로 실패해도 expandOnEmpty는 throw하지 않는다 (allSettled 내성)', async () => {
    vi.mocked(getRanking).mockRejectedValueOnce(new Error('KIS network error'));
    // allSettled로 감싸져 있어 한 랭킹 거부가 전체를 끌어내리지 않는다.
    const count = await expandOnEmpty();
    expect(count).toBe(0);
  });

  it('한 랭킹만 실패해도 나머지 결과와 정적 유니버스는 보존된다', async () => {
    // volume만 실패, fluctuation/market-cap은 정상(빈 배열) 반환.
    vi.mocked(getRanking).mockImplementationOnce(async () => { throw new Error('volume 일시장애'); });
    await expect(expandOnEmpty()).resolves.toBe(0);

    // 정적 유니버스는 언제나 반환 가능.
    const universe = getExpandedUniverse();
    expect(universe.length).toBe(STOCK_UNIVERSE.length);
  });

  it('정상 랭킹 응답이 있으면 정적 유니버스에 없는 신규 종목을 추가한다', async () => {
    vi.mocked(getRanking).mockImplementation(async (type) => {
      if (type === 'volume') {
        return [
          { code: '999001', name: '가상종목A', rank: 1, value: 1000000, changePercent: 3.5, market: 'KOSPI' },
        ];
      }
      if (type === 'fluctuation') {
        return [
          { code: '999002', name: '가상종목B', rank: 1, value: 5.0, changePercent: 5.0, market: 'KOSDAQ' },
        ];
      }
      return [];
    });

    const count = await expandOnEmpty();
    expect(count).toBeGreaterThanOrEqual(1);

    // 저장 파일이 생성되고 정적 유니버스와 겹치지 않는 항목만 포함.
    const persisted = JSON.parse(fs.readFileSync(DYNAMIC_FILE, 'utf-8'));
    const persistedCodes = persisted.map((p: { code: string }) => p.code);
    expect(persistedCodes).toContain('999001');
    expect(persistedCodes).toContain('999002');
  });
});
