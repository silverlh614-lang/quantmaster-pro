/**
 * kisRankingClient.newTypes.test.ts — 아이디어 5 확장 검증
 *
 * 검증 목표:
 *   1. 새로 추가된 3종(institutional-net-buy / short-balance / large-volume)이
 *      getRanking에서 호출 가능하고 정상 응답을 RankingEntry로 매핑한다.
 *   2. realDataKisGet이 빈 응답을 돌려주면 빈 배열로 자연 수렴한다.
 *   3. 개별 시장(KOSPI/KOSDAQ) 호출 중 하나가 throw해도 다른 쪽 결과는 유지된다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// kisClient 모듈을 mock — 실제 네트워크 호출 없이 TR 응답만 주입.
vi.mock('./kisClient.js', () => ({
  realDataKisGet: vi.fn(),
  HAS_REAL_DATA_CLIENT: true,
  KIS_IS_REAL: true,
  hasKisClientOverrides: () => false,
}));

import { realDataKisGet } from './kisClient.js';
import { getRanking, resetRankingCache } from './kisRankingClient.js';

const mockedKisGet = vi.mocked(realDataKisGet);

describe('kisRankingClient — 신규 3종 확장', () => {
  const originalForceMarket = process.env.DATA_FETCH_FORCE_MARKET;

  beforeEach(() => {
    // ADR-0009 장외 게이트 우회 — 본 테스트는 KIS 응답 매핑 자체를 검증한다.
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    resetRankingCache();
    mockedKisGet.mockReset();
  });

  afterEach(() => {
    if (originalForceMarket === undefined) delete process.env.DATA_FETCH_FORCE_MARKET;
    else process.env.DATA_FETCH_FORCE_MARKET = originalForceMarket;
    vi.restoreAllMocks();
  });

  it('institutional-net-buy: 기관 순매수량을 value로 매핑한다', async () => {
    mockedKisGet.mockImplementation(async (_trId, _path, params) => {
      const market = params.fid_cond_mrkt_div_code === 'J' ? 'KOSPI' : 'KOSDAQ';
      return {
        output: [
          {
            mksc_shrn_iscd: market === 'KOSPI' ? '005930' : '293490',
            hts_kor_isnm: market === 'KOSPI' ? '삼성전자' : '카카오게임즈',
            orgn_ntby_qty: market === 'KOSPI' ? '1500000' : '250000',
            prdy_ctrt: '1.23',
          },
        ],
      };
    });

    const rows = await getRanking('institutional-net-buy', { limit: 5 });
    expect(rows.length).toBe(2);
    const codes = rows.map(r => r.code);
    expect(codes).toContain('005930');
    expect(codes).toContain('293490');
    const samsung = rows.find(r => r.code === '005930')!;
    expect(samsung.value).toBe(1500000);
    expect(samsung.changePercent).toBeCloseTo(1.23);
  });

  it('short-balance: 공매도 잔고량을 value로 매핑한다', async () => {
    mockedKisGet.mockImplementation(async () => ({
      output: [
        {
          mksc_shrn_iscd: '000660',
          hts_kor_isnm: 'SK하이닉스',
          ssts_cntg_qty: '999000',
          prdy_ctrt: '-0.5',
        },
      ],
    }));
    const rows = await getRanking('short-balance', { limit: 5 });
    expect(rows.every(r => r.code === '000660')).toBe(true);
    expect(rows[0].value).toBe(999000);
  });

  it('large-volume: 거래량을 value로 매핑한다 (vol_cnt 상향으로 대량거래 필터)', async () => {
    mockedKisGet.mockImplementation(async () => ({
      output: [
        {
          mksc_shrn_iscd: '042700',
          hts_kor_isnm: '한미반도체',
          acml_vol: '12000000',
          prdy_ctrt: '3.4',
        },
      ],
    }));
    const rows = await getRanking('large-volume', { limit: 5 });
    expect(rows[0].value).toBe(12000000);
  });

  it('한 시장이 throw해도 다른 시장의 결과는 살아남는다', async () => {
    mockedKisGet.mockImplementation(async (_trId, _path, params) => {
      if (params.fid_cond_mrkt_div_code === 'J') throw new Error('KOSPI down');
      return {
        output: [{
          mksc_shrn_iscd: '293490',
          hts_kor_isnm: '카카오게임즈',
          orgn_ntby_qty: '50000',
          prdy_ctrt: '2.0',
        }],
      };
    });
    const rows = await getRanking('institutional-net-buy', { limit: 5 });
    expect(rows.length).toBe(1);
    expect(rows[0].market).toBe('KOSDAQ');
  });

  it('빈 응답이면 빈 배열로 수렴한다', async () => {
    mockedKisGet.mockResolvedValue({ output: [] });
    await expect(getRanking('short-balance', { limit: 5 })).resolves.toEqual([]);
  });
});
