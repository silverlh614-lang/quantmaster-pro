/**
 * @responsibility ADR-0652 — kisRankingClient leader/screener 랭킹 endpoint 문자열 정정 검증.
 * flag ON: volume path/market-cap trId+scr/institutional foreign-institution-total. OFF: 구 문자열 byte-identical.
 * 방어적 mapRow(orgn_ntby_qty 파싱·missing code→null). 발굴 전용·executionImpact NONE.
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
import {
  getRanking,
  resetRankingCache,
  resolveRankingEndpoint,
} from './kisRankingClient.js';

const mockedKisGet = vi.mocked(realDataKisGet);

const VOLUME_RANK_PATH = '/uapi/domestic-stock/v1/quotations/volume-rank';
const OLD_VOLUME_PATH = '/uapi/domestic-stock/v1/ranking/volume';
const MARKET_CAP_PATH = '/uapi/domestic-stock/v1/ranking/market-cap';
const FOREIGN_INST_PATH = '/uapi/domestic-stock/v1/quotations/foreign-institution-total';
const OLD_INVESTOR_PATH = '/uapi/domestic-stock/v1/ranking/investor';

/** type+market(J/Q) 의 마지막 call (trId, path, params) 캡처. */
function lastCall(predicate: (trId: string, path: string, params: Record<string, string>) => boolean) {
  const call = [...mockedKisGet.mock.calls]
    .reverse()
    .find((c) => predicate(c[0] as string, c[1] as string, c[2] as Record<string, string>));
  if (!call) throw new Error('대상 호출 미발견');
  return { trId: call[0] as string, path: call[1] as string, params: call[2] as Record<string, string> };
}

describe('ADR-0652 — 랭킹 endpoint 정정 (flag ON default)', () => {
  const originalForceMarket = process.env.DATA_FETCH_FORCE_MARKET;
  const originalEndpointFlag = process.env.LEADER_RANKING_ENDPOINT_FIX_ENABLED;

  beforeEach(() => {
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    delete process.env.LEADER_RANKING_ENDPOINT_FIX_ENABLED; // 미설정 = default ON
    resetRankingCache();
    mockedKisGet.mockReset();
    mockedKisGet.mockResolvedValue({ output: [] });
  });

  afterEach(() => {
    if (originalForceMarket === undefined) delete process.env.DATA_FETCH_FORCE_MARKET;
    else process.env.DATA_FETCH_FORCE_MARKET = originalForceMarket;
    if (originalEndpointFlag === undefined) delete process.env.LEADER_RANKING_ENDPOINT_FIX_ENABLED;
    else process.env.LEADER_RANKING_ENDPOINT_FIX_ENABLED = originalEndpointFlag;
    vi.restoreAllMocks();
  });

  it('volume: path 가 /quotations/volume-rank (PATH ONLY · trId 불변)', async () => {
    await getRanking('volume', { limit: 10 });
    const c = lastCall((trId) => trId === 'FHPST01710000');
    expect(c.path).toBe(VOLUME_RANK_PATH);
    expect(c.trId).toBe('FHPST01710000');
    expect(c.params.fid_cond_scr_div_code).toBe('20171'); // scr 불변
  });

  it('large-volume: 동일 volume-rank path 사용', async () => {
    await getRanking('large-volume', { limit: 10 });
    const c = lastCall((trId) => trId === 'FHPST01710000');
    expect(c.path).toBe(VOLUME_RANK_PATH);
  });

  it('market-cap: trId FHPST01740000 + scr 20174 (path 불변)', async () => {
    await getRanking('market-cap', { limit: 10 });
    const c = lastCall((_t, p) => p === MARKET_CAP_PATH);
    expect(c.trId).toBe('FHPST01740000');
    expect(c.params.fid_cond_scr_div_code).toBe('20174');
    expect(c.path).toBe(MARKET_CAP_PATH);
  });

  it('institutional-net-buy: foreign-institution-total path + trId FHPTJ04400000 + V/etc_cls 2', async () => {
    await getRanking('institutional-net-buy', { limit: 10 });
    // J(KOSPI)→fid_input_iscd '0001' / Q(KOSDAQ)→'1001', 둘 다 div_code 'V'.
    const callJ = [...mockedKisGet.mock.calls].find(
      (c) => c[1] === FOREIGN_INST_PATH && (c[2] as Record<string, string>).fid_input_iscd === '0001',
    );
    const callQ = [...mockedKisGet.mock.calls].find(
      (c) => c[1] === FOREIGN_INST_PATH && (c[2] as Record<string, string>).fid_input_iscd === '1001',
    );
    expect(callJ).toBeDefined();
    expect(callQ).toBeDefined();
    expect(callJ![0]).toBe('FHPTJ04400000');
    const pJ = callJ![2] as Record<string, string>;
    expect(pJ.fid_cond_mrkt_div_code).toBe('V');
    expect(pJ.fid_cond_scr_div_code).toBe('16449');
    expect(pJ.fid_etc_cls_code).toBe('2');
    expect(pJ.fid_rank_sort_cls_code).toBe('0');
    expect(pJ.fid_div_cls_code).toBe('0');
  });

  it('resolveRankingEndpoint(ON) 결과가 권위값과 일치', () => {
    expect(resolveRankingEndpoint('volume', 'J')).toMatchObject({
      trId: 'FHPST01710000', apiPath: VOLUME_RANK_PATH,
    });
    expect(resolveRankingEndpoint('market-cap', 'J')).toMatchObject({
      trId: 'FHPST01740000', apiPath: MARKET_CAP_PATH, scrDivOverride: '20174',
    });
    expect(resolveRankingEndpoint('institutional-net-buy', 'Q')).toMatchObject({
      trId: 'FHPTJ04400000', apiPath: FOREIGN_INST_PATH,
    });
    // fluctuation 은 무접촉
    expect(resolveRankingEndpoint('fluctuation', 'J')).toMatchObject({
      trId: 'FHPST01700000', apiPath: '/uapi/domestic-stock/v1/ranking/fluctuation',
    });
  });

  it('방어적 mapRow: orgn_ntby_qty 파싱 + fallback 체인 + missing code → null', async () => {
    mockedKisGet.mockImplementation(async (_trId, path, params) => {
      if (path !== FOREIGN_INST_PATH) return { output: [] };
      const iscd = (params as Record<string, string>).fid_input_iscd;
      return {
        output: [
          // orgn_ntby_qty 우선
          { mksc_shrn_iscd: iscd === '0001' ? '005930' : '293490', hts_kor_isnm: 'X', orgn_ntby_qty: '888000', prdy_ctrt: '1.0' },
          // orgn_ntby_qty 부재 → orgn_ntby_tr_pbmn fallback
          { mksc_shrn_iscd: '000660', hts_kor_isnm: 'Y', orgn_ntby_tr_pbmn: '123456', prdy_ctrt: '0.5' },
          // code 없음 → null (skip)
          { hts_kor_isnm: 'Z', orgn_ntby_qty: '999' },
        ],
      };
    });
    const rows = await getRanking('institutional-net-buy', { limit: 10 });
    const samsung = rows.find((r) => r.code === '005930');
    expect(samsung?.value).toBe(888000);
    const sk = rows.find((r) => r.code === '000660');
    expect(sk?.value).toBe(123456); // fallback 체인
    // missing code row 는 제외 — 어떤 row 도 빈 code 가 아님
    expect(rows.every((r) => r.code.length === 6)).toBe(true);
  });
});

describe('ADR-0652 — flag OFF(=false) 구 문자열 byte-identical', () => {
  const originalForceMarket = process.env.DATA_FETCH_FORCE_MARKET;
  const originalEndpointFlag = process.env.LEADER_RANKING_ENDPOINT_FIX_ENABLED;

  beforeEach(() => {
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    process.env.LEADER_RANKING_ENDPOINT_FIX_ENABLED = 'false';
    resetRankingCache();
    mockedKisGet.mockReset();
    mockedKisGet.mockResolvedValue({ output: [] });
  });

  afterEach(() => {
    if (originalForceMarket === undefined) delete process.env.DATA_FETCH_FORCE_MARKET;
    else process.env.DATA_FETCH_FORCE_MARKET = originalForceMarket;
    if (originalEndpointFlag === undefined) delete process.env.LEADER_RANKING_ENDPOINT_FIX_ENABLED;
    else process.env.LEADER_RANKING_ENDPOINT_FIX_ENABLED = originalEndpointFlag;
    vi.restoreAllMocks();
  });

  it('volume: 구 path /ranking/volume 유지', async () => {
    await getRanking('volume', { limit: 10 });
    const c = lastCall((trId) => trId === 'FHPST01710000');
    expect(c.path).toBe(OLD_VOLUME_PATH);
  });

  it('market-cap: 구 trId FHPST01720000 + scr 20172 유지', async () => {
    await getRanking('market-cap', { limit: 10 });
    const c = lastCall((_t, p) => p === MARKET_CAP_PATH);
    expect(c.trId).toBe('FHPST01720000');
    expect(c.params.fid_cond_scr_div_code).toBe('20172');
  });

  it('institutional-net-buy: 구 /ranking/investor path + FHPST01600000 유지', async () => {
    await getRanking('institutional-net-buy', { limit: 10 });
    const c = lastCall((_t, p) => p === OLD_INVESTOR_PATH);
    expect(c.trId).toBe('FHPST01600000');
    expect(c.path).toBe(OLD_INVESTOR_PATH);
  });

  it('resolveRankingEndpoint(OFF) 는 spec 원본 반환', () => {
    expect(resolveRankingEndpoint('volume', 'J').apiPath).toBe(OLD_VOLUME_PATH);
    expect(resolveRankingEndpoint('market-cap', 'J').trId).toBe('FHPST01720000');
    expect(resolveRankingEndpoint('market-cap', 'J').scrDivOverride).toBeUndefined();
    expect(resolveRankingEndpoint('institutional-net-buy', 'J').apiPath).toBe(OLD_INVESTOR_PATH);
    expect(resolveRankingEndpoint('institutional-net-buy', 'J').trId).toBe('FHPST01600000');
  });
});
