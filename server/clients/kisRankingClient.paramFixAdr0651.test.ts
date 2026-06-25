/**
 * @responsibility ADR-0651 W2/W3 — kisRankingClient leader 랭킹 param 정합(flag OFF byte-identical /
 * ON institutional 파생) + W3 circuit 키 격리(`__circuitKey: ${trId}#LEADER`) 검증. 발굴 전용·매매 무영향.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./kisClient.js', () => ({
  realDataKisGet: vi.fn(),
  HAS_REAL_DATA_CLIENT: true,
  KIS_IS_REAL: true,
  hasKisClientOverrides: () => false,
  getCircuitBreakerStats: () => [],
}));

import { realDataKisGet } from './kisClient.js';
import { getRanking, resetRankingCache } from './kisRankingClient.js';

const mockedKisGet = vi.mocked(realDataKisGet);

const INVESTOR_PATH = '/uapi/domestic-stock/v1/ranking/investor';
const VOLUME_TR = 'FHPST01710000';
const INVESTOR_TR = 'FHPST01600000';

/** 가장 마지막 institutional-net-buy(investor TR) 호출의 KOSPI(J) param 을 캡처. */
function lastInvestorParams(): Record<string, string> {
  const call = [...mockedKisGet.mock.calls]
    .reverse()
    .find((c) => c[1] === INVESTOR_PATH && c[2].fid_cond_mrkt_div_code === 'J');
  if (!call) throw new Error('institutional-net-buy investor 호출 미발견');
  return call[2];
}

describe('ADR-0651 W2 — leader 랭킹 param 정합 (flag 게이트)', () => {
  const originalForceMarket = process.env.DATA_FETCH_FORCE_MARKET;
  const originalFlag = process.env.LEADER_RANKING_PARAM_FIX_ENABLED;

  beforeEach(() => {
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    resetRankingCache();
    mockedKisGet.mockReset();
    mockedKisGet.mockResolvedValue({ output: [] });
  });

  afterEach(() => {
    if (originalForceMarket === undefined) delete process.env.DATA_FETCH_FORCE_MARKET;
    else process.env.DATA_FETCH_FORCE_MARKET = originalForceMarket;
    if (originalFlag === undefined) delete process.env.LEADER_RANKING_PARAM_FIX_ENABLED;
    else process.env.LEADER_RANKING_PARAM_FIX_ENABLED = originalFlag;
    vi.restoreAllMocks();
  });

  it('flag OFF(미설정) — institutional-net-buy 기존 param byte-identical (sort=2·cnt=30·vol=10000)', async () => {
    delete process.env.LEADER_RANKING_PARAM_FIX_ENABLED;
    await getRanking('institutional-net-buy', { limit: 30 });
    const p = lastInvestorParams();
    expect(p.fid_rank_sort_cls_code).toBe('2'); // 기관
    expect(p.fid_input_cnt_1).toBe('30');
    expect(p.fid_vol_cnt).toBe('10000');
    // 나머지 working 형태 불변
    expect(p.fid_cond_scr_div_code).toBe('20160');
    expect(p.fid_inqr_dvsn_cls_code).toBe('0');
    expect(p.fid_div_cls_code).toBe('0');
    expect(p.fid_trgt_cls_code).toBe('111111111');
    expect(p.fid_input_price_1).toBe('3000');
    expect(p.fid_input_price_2).toBe('500000');
  });

  it('flag OFF — 임의값("1"/"TRUE"/빈값)도 OFF 로 취급(ADR-0157 정확 비교)', async () => {
    for (const v of ['1', 'TRUE', 'yes', '']) {
      process.env.LEADER_RANKING_PARAM_FIX_ENABLED = v;
      resetRankingCache();
      mockedKisGet.mockClear();
      await getRanking('institutional-net-buy', { limit: 30 });
      const p = lastInvestorParams();
      expect(p.fid_rank_sort_cls_code).toBe('2');
      expect(p.fid_vol_cnt).toBe('10000');
    }
  });

  it('flag ON(=true) — 검증된 외국인 working param 으로 정합(sort=1·cnt=40·vol=50000)', async () => {
    process.env.LEADER_RANKING_PARAM_FIX_ENABLED = 'true';
    await getRanking('institutional-net-buy', { limit: 30 });
    const p = lastInvestorParams();
    expect(p.fid_rank_sort_cls_code).toBe('1'); // 외국인 working sort
    expect(p.fid_input_cnt_1).toBe('40');
    expect(p.fid_vol_cnt).toBe('50000');
    // 단일통로 — 응답·엔드포인트 동일(추가 KIS 호출 0·새 TR 0)
    expect(p.fid_cond_scr_div_code).toBe('20160');
    expect(p.fid_div_cls_code).toBe('0');
  });

  it('flag ON — mapRow 는 동일 응답의 orgn_ntby_qty(기관)를 파생값으로 읽는다', async () => {
    process.env.LEADER_RANKING_PARAM_FIX_ENABLED = 'true';
    mockedKisGet.mockImplementation(async (_trId, _path, params) => ({
      output: [{
        mksc_shrn_iscd: params.fid_cond_mrkt_div_code === 'J' ? '005930' : '293490',
        hts_kor_isnm: 'X',
        orgn_ntby_qty: '777000',   // 기관 순매수 — 파생 기준
        frgn_ntby_qty: '111000',   // 외국인 (정렬 기준이지만 value 로 쓰지 않음)
        prdy_ctrt: '1.0',
      }],
    }));
    const rows = await getRanking('institutional-net-buy', { limit: 5 });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.value === 777000)).toBe(true);
  });

  it('flag ON — 빈/파싱불가 응답이면 빈 배열 graceful(throw 0·404≠bearish)', async () => {
    process.env.LEADER_RANKING_PARAM_FIX_ENABLED = 'true';
    mockedKisGet.mockResolvedValue(null);
    await expect(getRanking('institutional-net-buy', { limit: 5 })).resolves.toEqual([]);
  });
});

describe('ADR-0651 W3 — circuit 키 격리 (__circuitKey namespacing)', () => {
  const originalForceMarket = process.env.DATA_FETCH_FORCE_MARKET;

  beforeEach(() => {
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    resetRankingCache();
    mockedKisGet.mockReset();
    mockedKisGet.mockResolvedValue({ output: [] });
  });

  afterEach(() => {
    if (originalForceMarket === undefined) delete process.env.DATA_FETCH_FORCE_MARKET;
    else process.env.DATA_FETCH_FORCE_MARKET = originalForceMarket;
    vi.restoreAllMocks();
  });

  it('volume(FHPST01710000) leader fetch 는 `${trId}#LEADER` circuit 키를 전달한다', async () => {
    await getRanking('volume', { limit: 10 });
    const calls = mockedKisGet.mock.calls.filter((c) => c[0] === VOLUME_TR);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c[2].__circuitKey).toBe(`${VOLUME_TR}#LEADER`);
    }
  });

  it('investor(FHPST01600000) leader fetch 도 격리 키를 쓴다 (screener 원본 trId 미오염)', async () => {
    await getRanking('institutional-net-buy', { limit: 10 });
    const calls = mockedKisGet.mock.calls.filter((c) => c[0] === INVESTOR_TR);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c[2].__circuitKey).toBe(`${INVESTOR_TR}#LEADER`);
    }
  });

  it('wire trId(첫 인자)는 원본 유지 — circuit 키만 분리(헤더 무변경 보증)', async () => {
    await getRanking('volume', { limit: 10 });
    const calls = mockedKisGet.mock.calls.filter((c) => c[0] === VOLUME_TR);
    // 첫 인자(trId)는 원본, __circuitKey 만 namespaced.
    for (const c of calls) {
      expect(c[0]).toBe(VOLUME_TR);
      expect(c[2].__circuitKey).not.toBe(VOLUME_TR);
    }
  });
});
