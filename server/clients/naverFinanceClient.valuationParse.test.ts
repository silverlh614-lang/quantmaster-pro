/**
 * @responsibility Naver 밸류에이션 단위 접미사 파싱 회귀 — per/pbr/eps/bps/시총 0 결함 픽스
 *
 * 사용자 prod 보고(2026-06-06): /api/ai-universe/snapshot 응답이 per/pbr/eps/bps/marketCap=0.
 * 원인: Naver totalInfos 가 per "165.96배"·eps "10,587원"·시총 "131조 2,368억" 처럼 값에
 * 한국어 단위를 붙여 보내, 콤마·말미%만 제거하는 parseNumber 가 NaN→0 으로 떨어뜨렸다.
 * parseUnitNumber(접미사 제거)·parseMarketCapWon(조/억 자리값 합산)로 정정한다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __testOnly,
  fetchNaverStockSnapshot,
  resetNaverNegativeCache,
} from './naverFinanceClient';

const { parseUnitNumber, parseMarketCapWon } = __testOnly;

describe('parseUnitNumber — 단위 접미사 제거', () => {
  it('per/pbr "배" 접미사 제거', () => {
    expect(parseUnitNumber('165.96배')).toBe(165.96);
    expect(parseUnitNumber('13.52배')).toBe(13.52);
  });
  it('eps/bps "원" 접미사 + 천단위 콤마 제거', () => {
    expect(parseUnitNumber('10,587원')).toBe(10587);
    expect(parseUnitNumber('129,912원')).toBe(129912);
  });
  it('% 접미사 제거(배당/외인비율)', () => {
    expect(parseUnitNumber('0.13%')).toBe(0.13);
    expect(parseUnitNumber('37.82%')).toBe(37.82);
  });
  it('순수 숫자/숫자값은 그대로', () => {
    expect(parseUnitNumber(12.3)).toBe(12.3);
    expect(parseUnitNumber('1,757,000')).toBe(1757000);
  });
  it('빈값/비숫자/기호만 → 0', () => {
    expect(parseUnitNumber('')).toBe(0);
    expect(parseUnitNumber('N/A')).toBe(0);
    expect(parseUnitNumber('-')).toBe(0);
    expect(parseUnitNumber(null)).toBe(0);
    expect(parseUnitNumber(undefined)).toBe(0);
  });
});

describe('parseMarketCapWon — 조/억 자리값 합산 → 원', () => {
  it('조+억 복합("131조 2,368억") → 원 단위 합산', () => {
    expect(parseMarketCapWon('131조 2,368억')).toBe(131_236_800_000_000);
  });
  it('억 단독', () => {
    expect(parseMarketCapWon('5,432억')).toBe(543_200_000_000);
  });
  it('조 단독(소수 포함)', () => {
    expect(parseMarketCapWon('1.86조')).toBe(1_860_000_000_000);
    expect(parseMarketCapWon('480조')).toBe(480_000_000_000_000);
  });
  it('만 단위 합산', () => {
    // 3억(3e8) + 5,000만(5e7) = 3.5e8
    expect(parseMarketCapWon('3억 5,000만')).toBe(300_000_000 + 50_000_000);
  });
  it('단위 토큰 부재 → 콤마 제거 숫자 그대로', () => {
    expect(parseMarketCapWon('1312368')).toBe(1312368);
  });
  it('빈값/비숫자 → 0', () => {
    expect(parseMarketCapWon('')).toBe(0);
    expect(parseMarketCapWon('N/A')).toBe(0);
    expect(parseMarketCapWon(null)).toBe(0);
  });
});

describe('fetchNaverStockSnapshot — totalInfos 단위 접미사 통합 파싱(삼성전기 009150 prod 케이스)', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    resetNaverNegativeCache();
    vi.resetAllMocks();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('per/pbr/eps/bps/marketCap 가 단위 접미사를 벗고 채워진다', async () => {
    const payload = {
      stockName: '삼성전기',
      dealTrendInfos: [{ closePrice: '1,757,000', fluctuationsRatio: '1.92' }],
      totalInfos: [
        { code: 'marketValue', value: '131조 2,368억' },
        { code: 'per', value: '165.96배' },
        { code: 'pbr', value: '13.52배' },
        { code: 'eps', value: '10,587원' },
        { code: 'bps', value: '129,912원' },
        { code: 'dividendYieldRatio', value: '0.13%' },
        { code: 'foreignRate', value: '37.82%' },
      ],
    };
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ) as any;

    const snap = await fetchNaverStockSnapshot('009150');

    expect(snap).not.toBeNull();
    expect(snap?.closePrice).toBe(1_757_000);
    expect(snap?.per).toBe(165.96);
    expect(snap?.pbr).toBe(13.52);
    expect(snap?.eps).toBe(10587);
    expect(snap?.bps).toBe(129912);
    expect(snap?.marketCap).toBe(131_236_800_000_000); // 원 단위(formatMarketCapKr 호환)
    expect(snap?.dividendYield).toBe(0.13);
    expect(snap?.foreignerOwnRatio).toBe(37.82);
  });
});
