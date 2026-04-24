/**
 * kisRankingClient.ts — KIS 순위 기반 TR 단일 책임 클라이언트 (Phase A + 아이디어 5)
 *
 * 단일 책임: "순위 → 종목" 방향의 KIS 랭킹 TR 6종을 관리한다.
 *   - volume:              FHPST01710000 (거래량 상위)
 *   - fluctuation:         FHPST01700000 (등락률 상위)
 *   - market-cap:          FHPST01720000 (시가총액 상위)
 *   - institutional-net-buy: FHPST01600000 (기관 순매수 상위)
 *   - short-balance:       FHPST04020000 (공매도 잔고 상위)
 *   - large-volume:        FHPST01710000 (대량거래 — 거래량 TR, vol_cnt 상향)
 *
 * 기존 kisClient.ts의 토큰·헤더 로직은 realDataKisGet 재사용으로 그대로 가져온다.
 * kisClient를 2,000줄짜리 비대 파일로 만들지 않기 위한 분리 — 항후 flow/ws 클라이언트도
 * 같은 패턴으로 독립시킨다.
 *
 * 반환: { code, name, rank, value, changePercent }[]
 * 캐시: 메모리 5분 TTL (장중 과다 호출 방지 — 호출자가 주기적으로 두들겨도 1/300s 만큼만 실제 API)
 * 실패: 빈 배열 반환 (호출자는 기존 Yahoo/정적 유니버스 또는 KRX 폴백으로 자연스럽게 전환)
 *
 * 아이디어 5 — "KIS 순위 TR 이중 활용":
 *   기관 순매수·공매도 잔고·대량거래 상위를 추가 호출함으로써 "지금 뜨는 종목"을
 *   googleSearch 없이 국내 순위 TR만으로 확보한다. VTS mock 호환성은 기존
 *   `hasKisClientOverrides()` 가드를 그대로 재사용해 실계좌 데이터 키 분리 원칙을
 *   지킨다.
 */

import {
  realDataKisGet,
  HAS_REAL_DATA_CLIENT,
  KIS_IS_REAL,
  hasKisClientOverrides,
} from './kisClient.js';
import { isMarketOpen } from '../utils/marketClock.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export type RankingType =
  | 'volume'
  | 'fluctuation'
  | 'market-cap'
  | 'institutional-net-buy'
  | 'short-balance'
  | 'large-volume';

export interface RankingEntry {
  code: string;           // 6자리 종목코드
  name: string;           // 한글 종목명
  rank: number;           // 1부터 시작하는 순위 (KOSPI·KOSDAQ 통합 순위는 아님 — 각 시장 내 순위)
  value: number;          // 정렬 기준값 — 거래량/등락률/시가총액/순매수량 등 TR에 따라 의미 상이
  changePercent: number;  // 당일 등락률 (%)
  market: 'KOSPI' | 'KOSDAQ';
}

export interface GetRankingOptions {
  /** 각 시장별 상위 N개 (기본 30). KOSPI+KOSDAQ 합치면 2*N 최대. */
  limit?: number;
  /** true면 캐시를 무시하고 강제 새로고침. 기본 false. */
  bypassCache?: boolean;
}

// ── 메모리 캐시 ──────────────────────────────────────────────────────────────

interface CacheEntry {
  data: RankingEntry[];
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map<string, CacheEntry>();

function cacheKey(type: RankingType, limit: number): string {
  return `${type}:${limit}`;
}

// ── ADR-0009 장외 게이트 로그 throttle ─────────────────────────────────────
// 장외 시간에 RankingType 별 스킵 로그를 1분에 한 번만 남겨 로그 폭증을 방지한다.
const OFF_HOURS_LOG_INTERVAL_MS = 60 * 1000;
let _lastOffHoursLogAt = 0;

// ── TR 파라미터 매핑 ─────────────────────────────────────────────────────────

interface TrSpec {
  trId: string;
  apiPath: string;
  /** 시장(J=KOSPI · Q=KOSDAQ)별 파라미터. */
  params: (mrktDiv: 'J' | 'Q') => Record<string, string>;
  /** 응답 row → RankingEntry 매핑. null 반환 시 건너뜀. */
  mapRow: (row: Record<string, string>, rank: number, market: 'KOSPI' | 'KOSDAQ') => RankingEntry | null;
}

const TR_SPECS: Record<RankingType, TrSpec> = {
  volume: {
    trId: 'FHPST01710000',
    apiPath: '/uapi/domestic-stock/v1/ranking/volume',
    params: (mrktDiv) => ({
      fid_cond_mrkt_div_code: mrktDiv,
      fid_cond_scr_div_code:  '20171',
      fid_input_iscd:         '0000',
      fid_div_cls_code:       '0',
      fid_blng_cls_code:      '0',
      fid_trgt_cls_code:      '111111111',
      fid_trgt_exls_cls_code: '000000',
      fid_input_price_1:      '3000',
      fid_input_price_2:      '500000',
      fid_vol_cnt:            '50000',
      fid_input_date_1:       '',
    }),
    mapRow: (row, rank, market) => {
      const code = (row.mksc_shrn_iscd ?? row.stck_shrn_iscd ?? '').trim();
      if (!code || code.length !== 6) return null;
      return {
        code,
        name:          (row.hts_kor_isnm ?? '').trim(),
        rank,
        value:         parseInt(row.acml_vol ?? '0', 10),
        changePercent: parseFloat(row.prdy_ctrt ?? '0'),
        market,
      };
    },
  },
  fluctuation: {
    trId: 'FHPST01700000',
    apiPath: '/uapi/domestic-stock/v1/ranking/fluctuation',
    params: (mrktDiv) => ({
      fid_cond_mrkt_div_code: mrktDiv,
      fid_cond_scr_div_code:  '20170',
      fid_input_iscd:         '0000',
      fid_rank_sort_cls_code: '0',      // 상승률 내림차순
      fid_input_cnt_1:        '0',
      fid_prc_cls_code:       '0',      // 전체 (신고가 제약 없음)
      fid_input_price_1:      '3000',
      fid_input_price_2:      '',
      fid_vol_cnt:            '50000',
      fid_trgt_cls_code:      '0',
      fid_trgt_exls_cls_code: '0',
      fid_div_cls_code:       '0',
      fid_rsfl_rate1:         '',
      fid_rsfl_rate2:         '',
    }),
    mapRow: (row, rank, market) => {
      const code = (row.mksc_shrn_iscd ?? row.stck_shrn_iscd ?? '').trim();
      if (!code || code.length !== 6) return null;
      const changePercent = parseFloat(row.prdy_ctrt ?? '0');
      return {
        code,
        name:          (row.hts_kor_isnm ?? '').trim(),
        rank,
        value:         changePercent,   // 등락률 자체가 정렬값
        changePercent,
        market,
      };
    },
  },
  'market-cap': {
    trId: 'FHPST01720000',
    apiPath: '/uapi/domestic-stock/v1/ranking/market-cap',
    params: (mrktDiv) => ({
      fid_cond_mrkt_div_code: mrktDiv,
      fid_cond_scr_div_code:  '20172',
      fid_input_iscd:         '0000',
      fid_div_cls_code:       '0',
      fid_input_price_1:      '',
      fid_input_price_2:      '',
      fid_vol_cnt:            '',
      fid_trgt_cls_code:      '0',
      fid_trgt_exls_cls_code: '0',
    }),
    mapRow: (row, rank, market) => {
      const code = (row.mksc_shrn_iscd ?? row.stck_shrn_iscd ?? '').trim();
      if (!code || code.length !== 6) return null;
      return {
        code,
        name:          (row.hts_kor_isnm ?? '').trim(),
        rank,
        value:         parseFloat(row.stck_avls ?? row.lstn_stcn ?? '0'),  // 시가총액(억원) 또는 상장주식수
        changePercent: parseFloat(row.prdy_ctrt ?? '0'),
        market,
      };
    },
  },
  // 기관 순매수 상위 — googleSearch "지금 뜨는 종목" 질문을 완전 대체.
  // tr_id/scr_div_code는 stockScreener 및 mockKisClient와 동일한 FHPST01600000/20160 사용.
  // 과거 FHPST01620000/20162 는 KIS에 존재하지 않아 404를 유발함.
  'institutional-net-buy': {
    trId: 'FHPST01600000',
    apiPath: '/uapi/domestic-stock/v1/ranking/investor',
    params: (mrktDiv) => ({
      fid_cond_mrkt_div_code: mrktDiv,
      fid_cond_scr_div_code:  '20160',
      fid_input_iscd:         '0000',
      fid_inqr_dvsn_cls_code: '0',       // 0=순매수
      fid_div_cls_code:       '0',
      fid_rank_sort_cls_code: '2',       // 2=기관 (KIS 공통 규약 — 1=외국인 / 2=기관 / 0=전체)
      fid_input_cnt_1:        '30',
      fid_trgt_cls_code:      '111111111',
      fid_trgt_exls_cls_code: '000000',
      fid_vol_cnt:            '10000',
      fid_input_price_1:      '3000',
      fid_input_price_2:      '500000',
    }),
    mapRow: (row, rank, market) => {
      const code = (row.mksc_shrn_iscd ?? row.stck_shrn_iscd ?? '').trim();
      if (!code || code.length !== 6) return null;
      // KIS 투자자 순매수 TR은 orgn_ntby_qty/frgn_ntby_qty를 모두 내려준다.
      const instNet = parseInt(row.orgn_ntby_qty ?? row.ntby_qty ?? '0', 10);
      return {
        code,
        name:          (row.hts_kor_isnm ?? '').trim(),
        rank,
        value:         instNet,
        changePercent: parseFloat(row.prdy_ctrt ?? '0'),
        market,
      };
    },
  },
  // 공매도 잔고 상위 — 역방향 신호: 하락 베팅 많은 종목을 워치리스트에서 제외할 때 사용.
  'short-balance': {
    trId: 'FHPST04020000',
    apiPath: '/uapi/domestic-stock/v1/ranking/short-sale',
    params: (mrktDiv) => ({
      fid_cond_mrkt_div_code: mrktDiv,
      fid_cond_scr_div_code:  '20402',
      fid_input_iscd:         '0000',
      fid_period_div_code:    'D',       // D=일별
      fid_input_cnt_1:        '30',
      fid_trgt_cls_code:      '0',
      fid_trgt_exls_cls_code: '0',
      fid_input_price_1:      '3000',
      fid_input_price_2:      '',
      fid_vol_cnt:            '10000',
    }),
    mapRow: (row, rank, market) => {
      const code = (row.mksc_shrn_iscd ?? row.stck_shrn_iscd ?? '').trim();
      if (!code || code.length !== 6) return null;
      const shortBal = parseInt(row.stnd_shrt_wght ?? row.ssts_cntg_qty ?? row.ntby_qty ?? '0', 10);
      return {
        code,
        name:          (row.hts_kor_isnm ?? '').trim(),
        rank,
        value:         shortBal,
        changePercent: parseFloat(row.prdy_ctrt ?? '0'),
        market,
      };
    },
  },
  // 대량거래 상위 — 거래량 TR을 거래량 하한만 상향해 재사용한다.
  // (과거 fid_blng_cls_code=3 은 KIS 가 허용하지 않는 값이라 404 를 유발했다.)
  'large-volume': {
    trId: 'FHPST01710000',
    apiPath: '/uapi/domestic-stock/v1/ranking/volume',
    params: (mrktDiv) => ({
      fid_cond_mrkt_div_code: mrktDiv,
      fid_cond_scr_div_code:  '20171',
      fid_input_iscd:         '0000',
      fid_div_cls_code:       '0',
      fid_blng_cls_code:      '0',         // 0=전체 (3=대량거래는 미지원)
      fid_trgt_cls_code:      '111111111',
      fid_trgt_exls_cls_code: '000000',
      fid_input_price_1:      '3000',
      fid_input_price_2:      '500000',
      fid_vol_cnt:            '100000',    // 거래량 10만주 이상 — 대량거래 필터 역할
      fid_input_date_1:       '',
    }),
    mapRow: (row, rank, market) => {
      const code = (row.mksc_shrn_iscd ?? row.stck_shrn_iscd ?? '').trim();
      if (!code || code.length !== 6) return null;
      return {
        code,
        name:          (row.hts_kor_isnm ?? '').trim(),
        rank,
        value:         parseInt(row.acml_vol ?? '0', 10),
        changePercent: parseFloat(row.prdy_ctrt ?? '0'),
        market,
      };
    },
  },
};

// ── 메인 API ─────────────────────────────────────────────────────────────────

/**
 * KIS 랭킹 TR을 호출해 상위 종목 리스트를 돌려준다.
 * KOSPI + KOSDAQ를 각각 조회해 하나의 배열로 합친다.
 *
 * - HAS_REAL_DATA_CLIENT · KIS_IS_REAL · 오버라이드 모두 없으면 바로 빈 배열 반환.
 * - 한쪽 시장이 실패해도 다른 쪽 결과는 반환.
 * - 두 호출 모두 실패하면 빈 배열 (throw 없음) — 폴백 친화적.
 */
export async function getRanking(
  type: RankingType,
  opts: GetRankingOptions = {},
): Promise<RankingEntry[]> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 30));
  const key = cacheKey(type, limit);

  if (!opts.bypassCache) {
    const hit = _cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.data;
  }

  // ADR-0009: 장외(주말·평일 09:00 이전·15:30 이후) 에는 랭킹 TR 호출을 건너뛴다.
  //   - 캐시 hit: TTL 무시하고 그대로 반환 (장외에는 stale 해도 무해).
  //   - 캐시 miss: 네트워크 호출 스킵 후 빈 배열 반환.
  //   - bypassCache=true 는 관리자 진단용 — 장외에도 호출 강제.
  if (!opts.bypassCache && !isMarketOpen()) {
    const staleHit = _cache.get(key);
    if (staleHit) return staleHit.data;
    const now = Date.now();
    if (now - _lastOffHoursLogAt >= OFF_HOURS_LOG_INTERVAL_MS) {
      _lastOffHoursLogAt = now;
      console.info('[KisRanking] 장외 스킵', { type, limit });
    }
    return [];
  }

  if (!HAS_REAL_DATA_CLIENT && !KIS_IS_REAL && !hasKisClientOverrides()) {
    return [];
  }

  const spec = TR_SPECS[type];
  const marketEntries: RankingEntry[] = [];

  const markets: Array<{ div: 'J' | 'Q'; label: 'KOSPI' | 'KOSDAQ' }> = [
    { div: 'J', label: 'KOSPI' },
    { div: 'Q', label: 'KOSDAQ' },
  ];

  await Promise.all(
    markets.map(async ({ div, label }) => {
      try {
        const resp = await realDataKisGet(spec.trId, spec.apiPath, spec.params(div));
        const output = (resp as { output?: Record<string, string>[] } | null)?.output;
        if (!output || !Array.isArray(output)) return;

        for (let i = 0; i < Math.min(output.length, limit); i++) {
          const row = spec.mapRow(output[i], i + 1, label);
          if (row) marketEntries.push(row);
        }
      } catch (e) {
        // 개별 시장 실패는 조용히 흡수 — 호출자에게 부분 성공 반환.
        console.warn(
          `[KisRanking] ${type} ${label} 실패 (조용히 흡수):`,
          e instanceof Error ? e.message : e,
        );
      }
    }),
  );

  _cache.set(key, { data: marketEntries, expiresAt: Date.now() + CACHE_TTL_MS });
  return marketEntries;
}

/** 테스트·진단용: 캐시 초기화. */
export function resetRankingCache(): void {
  _cache.clear();
}

/** 테스트·진단용: 캐시 스냅샷(디버깅). */
export function getRankingCacheSnapshot(): Array<{ key: string; size: number; ttlMs: number }> {
  const now = Date.now();
  return Array.from(_cache.entries()).map(([key, v]) => ({
    key, size: v.data.length, ttlMs: Math.max(0, v.expiresAt - now),
  }));
}
