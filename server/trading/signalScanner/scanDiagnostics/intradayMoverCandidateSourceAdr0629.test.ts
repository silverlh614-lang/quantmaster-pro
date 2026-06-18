/**
 * intradayMoverCandidateSourceAdr0629.test.ts — ADR-0629 회귀.
 * 신선 screener.json 당일 상위 → INTRADAY_MOVER candidate pool 입력 매핑.
 * flag default OFF byte-identical / ON 시 changeRate 내림차순 상위 N 매핑 / clamp / graceful [].
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ScreenedStock } from '../../../screener/stockScreener.js';

// getScreenerCache 를 mock — 모듈이 read 하는 단일 캐시 시드.
const mockState: { screener: ScreenedStock[]; throwOnRead: boolean; calls: number } = {
  screener: [],
  throwOnRead: false,
  calls: 0,
};

vi.mock('../../../screener/stockScreener.js', () => ({
  getScreenerCache: () => {
    mockState.calls += 1;
    if (mockState.throwOnRead) throw new Error('cache read boom');
    return mockState.screener;
  },
}));

function stock(code: string, changeRate: number, extra: Partial<ScreenedStock> = {}): ScreenedStock {
  return {
    code,
    name: `name-${code}`,
    currentPrice: 10_000,
    changeRate,
    volume: 1_000,
    turnoverRate: 0,
    per: 0,
    foreignNetBuy: 0,
    screenedAt: '2026-06-18T00:00:00.000Z',
    ...extra,
  };
}

const ORIGINAL_ENABLED = process.env.INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED;
const ORIGINAL_MAX = process.env.INTRADAY_MOVER_MAX_INJECT;

describe('ADR-0629 — intradayMoverCandidateSource', () => {
  beforeEach(() => {
    mockState.screener = [];
    mockState.throwOnRead = false;
    mockState.calls = 0;
    delete process.env.INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED;
    delete process.env.INTRADAY_MOVER_MAX_INJECT;
  });

  afterEach(() => {
    if (ORIGINAL_ENABLED === undefined) delete process.env.INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED;
    else process.env.INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED = ORIGINAL_ENABLED;
    if (ORIGINAL_MAX === undefined) delete process.env.INTRADAY_MOVER_MAX_INJECT;
    else process.env.INTRADAY_MOVER_MAX_INJECT = ORIGINAL_MAX;
  });

  it('(1) flag OFF → [] + getScreenerCache 미호출 (byte-identical)', async () => {
    mockState.screener = [stock('A', 30), stock('B', 10)];
    const { collectIntradayMoverCandidates } = await import('./intradayMoverCandidateSource.js');
    const result = collectIntradayMoverCandidates();
    expect(result).toEqual([]);
    expect(mockState.calls).toBe(0);     // 캐시 read 0 — 부작용 없음
  });

  it('(2) flag ON + 캐시 N건 → changeRate 내림차순 상위 maxInject 매핑·형태 검증', async () => {
    process.env.INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED = 'true';
    process.env.INTRADAY_MOVER_MAX_INJECT = '3';
    mockState.screener = [
      stock('A', 5),
      stock('B', 28),
      stock('C', 12),
      stock('D', 1),
    ];
    const { collectIntradayMoverCandidates } = await import('./intradayMoverCandidateSource.js');
    const result = collectIntradayMoverCandidates();

    expect(mockState.calls).toBe(1);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.code)).toEqual(['B', 'C', 'A']);  // 내림차순 상위 3

    const top = result[0];
    expect(top).toMatchObject({
      code: 'B',
      symbol: 'B',
      name: 'name-B',
      currentPrice: 10_000,
      price: 10_000,
      volume: 1_000,
      dayChangeRate: 28,
    });
    // source 미설정 — addCandidates 가 자동 태깅 (계약).
    expect(top.source).toBeUndefined();
    // featureScores 미매핑 — builder 가 missing 채점 위임.
    expect(top.featureScores).toBeUndefined();
  });

  it('(3a) maxInject clamp — 0 → 20, NaN → 20', async () => {
    process.env.INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED = 'true';
    const { getIntradayMoverMaxInject } = await import('./intradayMoverCandidateSource.js');

    process.env.INTRADAY_MOVER_MAX_INJECT = '0';
    expect(getIntradayMoverMaxInject()).toBe(20);

    process.env.INTRADAY_MOVER_MAX_INJECT = 'not-a-number';
    expect(getIntradayMoverMaxInject()).toBe(20);

    delete process.env.INTRADAY_MOVER_MAX_INJECT;
    expect(getIntradayMoverMaxInject()).toBe(20);

    process.env.INTRADAY_MOVER_MAX_INJECT = '-5';
    expect(getIntradayMoverMaxInject()).toBe(20);
  });

  it('(3b) maxInject clamp — 100 → 50 상한', async () => {
    process.env.INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED = 'true';
    process.env.INTRADAY_MOVER_MAX_INJECT = '100';
    const { getIntradayMoverMaxInject, collectIntradayMoverCandidates } = await import('./intradayMoverCandidateSource.js');
    expect(getIntradayMoverMaxInject()).toBe(50);

    mockState.screener = Array.from({ length: 80 }, (_, i) => stock(`S${i}`, 80 - i));
    expect(collectIntradayMoverCandidates()).toHaveLength(50);   // 80건이어도 상한 50만
  });

  it('(4) flag ON + 빈 캐시 → []', async () => {
    process.env.INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED = 'true';
    mockState.screener = [];
    const { collectIntradayMoverCandidates } = await import('./intradayMoverCandidateSource.js');
    expect(collectIntradayMoverCandidates()).toEqual([]);
  });

  it('(5) getScreenerCache throw → [] (전파 안 함, 불변식 #1)', async () => {
    process.env.INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED = 'true';
    mockState.throwOnRead = true;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { collectIntradayMoverCandidates } = await import('./intradayMoverCandidateSource.js');
    expect(collectIntradayMoverCandidates()).toEqual([]);   // throw 전파 안 함
    expect(warnSpy).toHaveBeenCalled();                     // 사유 로깅 (SDS-ignore 정합)
    warnSpy.mockRestore();
  });

  it('(6) 식별 불가(code 부재) 종목 skip — 부분 배열 (throw 0)', async () => {
    process.env.INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED = 'true';
    mockState.screener = [
      stock('A', 30),
      stock('', 25),                 // code 부재 → skip
      stock('C', 20),
    ];
    const { collectIntradayMoverCandidates } = await import('./intradayMoverCandidateSource.js');
    const result = collectIntradayMoverCandidates();
    expect(result.map((c) => c.code)).toEqual(['A', 'C']);
  });
});
