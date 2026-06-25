/**
 * @responsibility kisRankingClient.probeLastError — probeLeaderRanking 이 realDataNoiseStore 의
 * passive last-error stamp(403/5xx/400)를 apiPath 단위로 read 해 LeaderRankingProbeRow 에
 * lastErrorKind/lastHttpStatus 로 노출하는지 검증 (관측 전용, 매매 무영향).
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
import { probeLeaderRanking, resetRankingCache } from './kisRankingClient.js';
import {
  recordRealDataLastErrorForDiag,
  getRealDataLastErrorForDiag,
  clearRealDataLastErrorForDiag,
  __resetKisRealDataNoiseStoreForTests,
} from './kisClient/realDataNoiseStore.js';

const mockedKisGet = vi.mocked(realDataKisGet);

const MARKET_CAP_PATH = '/uapi/domestic-stock/v1/ranking/market-cap';
const INVESTOR_PATH = '/uapi/domestic-stock/v1/ranking/investor';
const VOLUME_PATH = '/uapi/domestic-stock/v1/ranking/volume';

describe('realDataNoiseStore — 진단 last-error 레코더 (passive)', () => {
  beforeEach(() => __resetKisRealDataNoiseStoreForTests());
  afterEach(() => __resetKisRealDataNoiseStoreForTests());

  it('403 stamp → AUTH_OR_TOKEN 분류로 read', () => {
    recordRealDataLastErrorForDiag({ endpoint: VOLUME_PATH, httpStatus: 403 });
    const diag = getRealDataLastErrorForDiag(VOLUME_PATH);
    expect(diag?.errorKind).toBe('AUTH_OR_TOKEN');
    expect(diag?.httpStatus).toBe(403);
  });

  it('503 stamp → TRANSIENT_SERVER_500 분류', () => {
    recordRealDataLastErrorForDiag({ endpoint: VOLUME_PATH, httpStatus: 503 });
    expect(getRealDataLastErrorForDiag(VOLUME_PATH)?.errorKind).toBe('TRANSIENT_SERVER_500');
  });

  it('clear → 성공 후 stamp 해제(회복 반영)', () => {
    recordRealDataLastErrorForDiag({ endpoint: VOLUME_PATH, httpStatus: 403 });
    clearRealDataLastErrorForDiag(VOLUME_PATH);
    expect(getRealDataLastErrorForDiag(VOLUME_PATH)).toBeNull();
  });

  it('stamp 없는 endpoint → null', () => {
    expect(getRealDataLastErrorForDiag('/no/such/path')).toBeNull();
  });

  // ── ADR-0651 W1 — kisMsg 압축 1줄 round-trip ──────────────────────────────
  it('W1 — kisMsg(rt_cd/msg_cd/msg1) stamp → read 라운드트립', () => {
    recordRealDataLastErrorForDiag({
      endpoint: VOLUME_PATH,
      httpStatus: 404,
      kisMsg: '1/EGW00201/순위분석 권한이 없습니다',
    });
    const diag = getRealDataLastErrorForDiag(VOLUME_PATH);
    expect(diag?.httpStatus).toBe(404);
    expect(diag?.kisMsg).toBe('1/EGW00201/순위분석 권한이 없습니다');
  });

  it('W1 — kisMsg 미지정 시 진단 entry 에 kisMsg 부재(graceful)', () => {
    recordRealDataLastErrorForDiag({ endpoint: VOLUME_PATH, httpStatus: 503 });
    const diag = getRealDataLastErrorForDiag(VOLUME_PATH);
    expect(diag?.kisMsg).toBeUndefined();
  });

  it('W1 — clear 후 kisMsg 도 함께 해제(회복 반영)', () => {
    recordRealDataLastErrorForDiag({ endpoint: VOLUME_PATH, httpStatus: 404, kisMsg: '1/X/Y' });
    clearRealDataLastErrorForDiag(VOLUME_PATH);
    expect(getRealDataLastErrorForDiag(VOLUME_PATH)).toBeNull();
  });
});

describe('probeLeaderRanking — last-error stamp 반영', () => {
  const originalForceMarket = process.env.DATA_FETCH_FORCE_MARKET;

  beforeEach(() => {
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    resetRankingCache();
    mockedKisGet.mockReset();
    __resetKisRealDataNoiseStoreForTests();
  });

  afterEach(() => {
    if (originalForceMarket === undefined) delete process.env.DATA_FETCH_FORCE_MARKET;
    else process.env.DATA_FETCH_FORCE_MARKET = originalForceMarket;
    __resetKisRealDataNoiseStoreForTests();
    vi.restoreAllMocks();
  });

  it('빈 응답 + 403 stamp → 해당 TR row 에 lastErrorKind=AUTH_OR_TOKEN/403', async () => {
    // getRanking 은 빈 응답(null)을 반환하도록 mock — http.ts 실제 호출은 없으므로
    //   stamp 는 별도 진단 레코더에 직접 주입(실 경로 http.ts 가 하던 stamp 를 모사).
    mockedKisGet.mockResolvedValue(null);
    recordRealDataLastErrorForDiag({ endpoint: MARKET_CAP_PATH, httpStatus: 403 });

    const probe = await probeLeaderRanking();
    const row = probe.rows.find((r) => r.type === 'market-cap');
    expect(row?.count).toBe(0);
    expect(row?.lastErrorKind).toBe('AUTH_OR_TOKEN');
    expect(row?.lastHttpStatus).toBe(403);

    // 다른 TR 은 stamp 없음 → undefined (회귀 없음).
    const investorRow = probe.rows.find((r) => r.type === 'institutional-net-buy');
    expect(investorRow?.lastErrorKind).toBeUndefined();
    expect(investorRow?.lastHttpStatus).toBeUndefined();
  });

  it('정상 응답 시 stamp 없으면 lastErrorKind undefined', async () => {
    mockedKisGet.mockImplementation(async (_trId, _path, params) => ({
      output: [
        {
          mksc_shrn_iscd: params.fid_cond_mrkt_div_code === 'J' ? '005930' : '293490',
          hts_kor_isnm: 'X',
          stck_avls: '1000',
          acml_vol: '1000',
          orgn_ntby_qty: '1000',
          prdy_ctrt: '1.0',
        },
      ],
    }));

    const probe = await probeLeaderRanking();
    for (const row of probe.rows) {
      expect(row.lastErrorKind).toBeUndefined();
      expect(row.lastHttpStatus).toBeUndefined();
    }
  });

  it('5xx stamp on volume → row lastErrorKind=TRANSIENT_SERVER_500/500', async () => {
    mockedKisGet.mockResolvedValue(null);
    recordRealDataLastErrorForDiag({ endpoint: VOLUME_PATH, httpStatus: 500 });

    const probe = await probeLeaderRanking();
    const row = probe.rows.find((r) => r.type === 'volume');
    expect(row?.lastErrorKind).toBe('TRANSIENT_SERVER_500');
    expect(row?.lastHttpStatus).toBe(500);
  });

  // ── ADR-0651 W1 — probe row 에 lastKisMsg 노출 ────────────────────────────
  it('W1 — kisMsg stamp → probe row lastKisMsg 노출(관측 전용)', async () => {
    mockedKisGet.mockResolvedValue(null);
    recordRealDataLastErrorForDiag({
      endpoint: INVESTOR_PATH,
      httpStatus: 404,
      kisMsg: '1/EGW00121/모의투자 미지원',
    });

    const probe = await probeLeaderRanking();
    const row = probe.rows.find((r) => r.type === 'institutional-net-buy');
    expect(row?.lastHttpStatus).toBe(404);
    expect(row?.lastKisMsg).toBe('1/EGW00121/모의투자 미지원');

    // 다른 TR 은 kisMsg 없음 → undefined (회귀 없음).
    const volRow = probe.rows.find((r) => r.type === 'volume');
    expect(volRow?.lastKisMsg).toBeUndefined();
  });

  it('W1 — kisMsg 없는 정상 stamp 면 lastKisMsg undefined', async () => {
    mockedKisGet.mockResolvedValue(null);
    recordRealDataLastErrorForDiag({ endpoint: VOLUME_PATH, httpStatus: 403 });

    const probe = await probeLeaderRanking();
    const row = probe.rows.find((r) => r.type === 'volume');
    expect(row?.lastHttpStatus).toBe(403);
    expect(row?.lastKisMsg).toBeUndefined();
  });
});
