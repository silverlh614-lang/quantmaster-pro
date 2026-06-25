// @responsibility kisRankingClient 외부 클라이언트 모듈
/**
 * kisRankingClient.ts — KIS 순위 기반 TR 단일 책임 클라이언트 (Phase A + 아이디어 5)
 *
 * 단일 책임: "순위 → 종목" 방향의 KIS 랭킹 TR 6종을 관리한다.
 *   - volume:              FHPST01710000 (거래량 상위, ADR-0652: path /quotations/volume-rank)
 *   - fluctuation:         FHPST01700000 (등락률 상위)
 *   - market-cap:          FHPST01740000 (시가총액 상위, ADR-0652: trId/scr 정정)
 *   - institutional-net-buy: FHPTJ04400000 (기관 순매수, ADR-0652: foreign-institution-total)
 *   - foreign-net-buy:     FHPTJ04400000 (외국인 순매수, ADR-0652 후속: foreign-institution-total etc_cls=1)
 *   - short-balance:       FHPST04020000 (공매도 잔고 상위)
 *   - large-volume:        FHPST01710000 (대량거래 — 거래량 TR, vol_cnt 상향)
 *
 * ADR-0652: 위 정정값은 isLeaderRankingEndpointFixEnabled() (default ON kill-switch) 하에서만
 *   적용된다. `LEADER_RANKING_ENDPOINT_FIX_ENABLED=false` 시 구(broken) 문자열로 byte-identical 롤백.
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
  getCircuitBreakerStats,
} from './kisClient.js';
import {
  getRealDataLastErrorForDiag,
  type KisRealDataErrorKind,
} from './kisClient/realDataNoiseStore.js';
import { isMarketOpen } from '../utils/marketClock.js';
import {
  isLeaderRankingParamFixEnabled,
  isLeaderRankingEndpointFixEnabled,
} from '../trading/gateConfig.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export type RankingType =
  | 'volume'
  | 'fluctuation'
  | 'market-cap'
  | 'institutional-net-buy'
  | 'foreign-net-buy'
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

// ── ADR-0652 endpoint 정정 resolver (flag 게이트 단일 지점) ──────────────────
//   KIS 공식 GitHub 1:1 검증 결과 정정된 path/trId/scr 을 isLeaderRankingEndpointFixEnabled()
//   하에서만 적용. OFF(`=false`) 시 구(broken) 문자열로 byte-identical. caller inline ENV 금지.

export interface RankingEndpointOverride {
  trId: string;
  apiPath: string;
  /** scr_div 정정이 필요한 TR(market-cap)만 채움. undefined = 기존 scr 유지. */
  scrDivOverride?: string;
}

/**
 * type(+ market div)에 대해 endpoint-fix flag 하의 권위 endpoint 를 돌려준다.
 * 정정 대상이 아닌 type(fluctuation/short-balance) 은 spec 원본을 그대로 반환한다.
 */
export function resolveRankingEndpoint(
  type: RankingType,
  _mrktDiv: 'J' | 'Q',
): RankingEndpointOverride {
  const base = TR_SPECS[type];
  const fixOn = isLeaderRankingEndpointFixEnabled();
  if (!fixOn) {
    return { trId: base.trId, apiPath: base.apiPath };
  }
  switch (type) {
    case 'volume':
    case 'large-volume':
      // FIX = PATH ONLY. tr_id FHPST01710000 unchanged, scr 20171 unchanged.
      return { trId: base.trId, apiPath: '/uapi/domestic-stock/v1/quotations/volume-rank' };
    case 'market-cap':
      // FIX = tr_id + scr. path /ranking/market-cap unchanged.
      return { trId: 'FHPST01740000', apiPath: base.apiPath, scrDivOverride: '20174' };
    case 'institutional-net-buy':
    case 'foreign-net-buy':
      // FIX = full migration. path + trId (+ params/mapRow handled inline in spec).
      //   foreign-net-buy 는 institutional 과 동일 foreign-institution-total TR 을 쓰되
      //   spec params 의 fid_etc_cls_code 만 1(외국인)/2(기관) 로 분기한다.
      return {
        trId: 'FHPTJ04400000',
        apiPath: '/uapi/domestic-stock/v1/quotations/foreign-institution-total',
      };
    default:
      return { trId: base.trId, apiPath: base.apiPath };
  }
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
  // 기관 순매수 상위.
  //   trId/apiPath 는 ADR-0652 endpoint-fix flag 하에서 resolveRankingEndpoint 가
  //   FHPTJ04400000 + /quotations/foreign-institution-total 로 정정한다(아래는 OFF 기준 구값).
  'institutional-net-buy': {
    trId: 'FHPST01600000',
    apiPath: '/uapi/domestic-stock/v1/ranking/investor',
    // ADR-0652 — endpoint-fix ON 시: foreign-institution-total 권위 param 사용
    //   (fid_cond_mrkt_div_code:'V' 고정, fid_input_iscd 는 div J→'0001'/Q→'1001',
    //    fid_etc_cls_code:'2'=기관). 이 분기는 ADR-0651 W2 sort param 분기를 supersede 한다.
    // OFF(endpoint-fix=false) 시: 기존 ADR-0651 W2 (param-fix flag) 분기 그대로 — byte-identical.
    params: (mrktDiv): Record<string, string> => {
      if (isLeaderRankingEndpointFixEnabled()) {
        return {
          fid_cond_mrkt_div_code: 'V',                        // foreign-institution-total 고정
          fid_cond_scr_div_code:  '16449',
          fid_input_iscd:         mrktDiv === 'Q' ? '1001' : '0001',  // 0001=KOSPI / 1001=KOSDAQ
          fid_div_cls_code:       '0',                        // 0=수량정렬
          fid_rank_sort_cls_code: '0',                        // 0=순매수
          fid_etc_cls_code:       '2',                        // 2=기관
        };
      }
      return isLeaderRankingParamFixEnabled()
        ? {
          fid_cond_mrkt_div_code: mrktDiv,
          fid_cond_scr_div_code:  '20160',
          fid_input_iscd:         '0000',
          fid_inqr_dvsn_cls_code: '0',       // 0=순매수
          fid_div_cls_code:       '0',
          fid_rank_sort_cls_code: '1',       // 1=외국인 (검증된 working sort — 응답이 기관 orgn_ntby_qty 도 포함)
          fid_input_cnt_1:        '40',
          fid_trgt_cls_code:      '111111111',
          fid_trgt_exls_cls_code: '000000',
          fid_vol_cnt:            '50000',
          fid_input_price_1:      '3000',
          fid_input_price_2:      '500000',
        }
        : {
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
        };
    },
    // ADR-0652 — foreign-institution-total 출력 필드명은 KIS docs 미확정.
    //   방어적 ?? 체인: code 없으면 null(graceful). 구 investor TR 응답과도 호환.
    mapRow: (row, rank, market) => {
      const code = (row.mksc_shrn_iscd ?? row.stck_shrn_iscd ?? '').trim();
      if (!code || code.length !== 6) return null;
      const instNet = parseInt(
        row.orgn_ntby_qty ?? row.orgn_ntby_tr_pbmn ?? row.ntby_qty ?? '0',
        10,
      );
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
  // 외국인 순매수 상위 (ADR-0652 후속).
  //   trId/apiPath 는 endpoint-fix flag 하에서 resolveRankingEndpoint 가
  //   institutional-net-buy 와 동일하게 FHPTJ04400000 + /quotations/foreign-institution-total 로
  //   정정한다. institutional 과 유일한 차이는 fid_etc_cls_code:'1'(외국인) + mapRow value=frgn_ntby_qty.
  //   이 type 은 정본(endpoint-fix ON) 전용 — OFF 시 expander 가 호출하지 않으며(구 volume 대용 유지),
  //   getRanking 직접 호출 시에도 graceful 하게 구 investor TR(외국인 sort)로 byte-identical 동작.
  'foreign-net-buy': {
    trId: 'FHPST01600000',
    apiPath: '/uapi/domestic-stock/v1/ranking/investor',
    // ADR-0652 후속 — endpoint-fix ON 시: foreign-institution-total 권위 param (외국인).
    //   institutional spec 미러링 + fid_etc_cls_code:'1'(외국인).
    // OFF 시: 기존 investor TR 외국인 sort(rank_sort_cls_code:'1') — graceful byte-identical.
    params: (mrktDiv): Record<string, string> => {
      if (isLeaderRankingEndpointFixEnabled()) {
        return {
          fid_cond_mrkt_div_code: 'V',                        // foreign-institution-total 고정
          fid_cond_scr_div_code:  '16449',
          fid_input_iscd:         mrktDiv === 'Q' ? '1001' : '0001',  // 0001=KOSPI / 1001=KOSDAQ
          fid_div_cls_code:       '0',                        // 0=수량정렬
          fid_rank_sort_cls_code: '0',                        // 0=순매수
          fid_etc_cls_code:       '1',                        // 1=외국인
        };
      }
      return {
        fid_cond_mrkt_div_code: mrktDiv,
        fid_cond_scr_div_code:  '20160',
        fid_input_iscd:         '0000',
        fid_inqr_dvsn_cls_code: '0',       // 0=순매수
        fid_div_cls_code:       '0',
        fid_rank_sort_cls_code: '1',       // 1=외국인
        fid_input_cnt_1:        '30',
        fid_trgt_cls_code:      '111111111',
        fid_trgt_exls_cls_code: '000000',
        fid_vol_cnt:            '10000',
        fid_input_price_1:      '3000',
        fid_input_price_2:      '500000',
      };
    },
    // ADR-0652 후속 — 정본 confirm 필드: value=frgn_ntby_qty(외국인 순매수 수량).
    //   방어적 ?? 체인(거래대금→ntby_qty fallback). code 없으면 null(graceful).
    mapRow: (row, rank, market) => {
      const code = (row.mksc_shrn_iscd ?? row.stck_shrn_iscd ?? '').trim();
      if (!code || code.length !== 6) return null;
      const frgnNet = parseInt(
        row.frgn_ntby_qty ?? row.frgn_ntby_tr_pbmn ?? row.ntby_qty ?? '0',
        10,
      );
      return {
        code,
        name:          (row.hts_kor_isnm ?? '').trim(),
        rank,
        value:         frgnNet,
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
        // ADR-0652 — endpoint-fix flag 하의 권위 trId/apiPath/scr 해석 (단일 지점 resolver).
        //   OFF 시 spec 원본과 byte-identical.
        const ep = resolveRankingEndpoint(type, div);
        const params = spec.params(div);
        if (ep.scrDivOverride) {
          params.fid_cond_scr_div_code = ep.scrDivOverride;
        }
        // ADR-0651 W3 — circuit 키 격리. leader/발굴 랭킹 경로(본 getRanking 단일 진입)는
        //   `${trId}#LEADER` namespaced circuit 키로 fetch 해, leader 404 가 동일 trId 를
        //   직접 쓰는 screener(stockScreener.ts realDataKisGet, __circuitKey 미지정 → 원본 trId)
        //   circuit 을 trip/blackhole 하지 않게 한다. wire `tr_id` 헤더는 resolved trId 사용.
        //   probe·cron 양 경로 일관 격리. screener circuit byte-equivalent.
        const resp = await realDataKisGet(ep.trId, ep.apiPath, {
          ...params,
          __circuitKey: `${ep.trId}#LEADER`,
        });
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

// ── leader 랭킹 진단 프로브 (관측 전용 — /leader_refresh 0건 원인 가시화) ────────
//   장중 수동 트리거가 "0건"만 토하고 *왜*를 못 보여주던 사각지대 해소.
//   bypassCache=true 강제로 5분 캐시·ADR-0009 장외 스킵을 우회해 real-data 경로의
//   실응답 수를 직접 측정한다. 매매 결정 직접 사용 0 — 발굴 캐시 갱신 side effect 만.

/**
 * /leader_refresh 가 fetch 하는 LEADER_SOURCES 3종 랭킹 키 (dynamicUniverseExpander 와 정합).
 * endpoint-fix OFF 기준 정적 목록 — FOREIGN 소스가 volume 대용인 구 동작. (back-compat export)
 */
export const LEADER_RANKING_TYPES: readonly RankingType[] = [
  'market-cap',
  'institutional-net-buy',
  'volume',
] as const;

/**
 * endpoint-fix flag 에 맞춘 LEADER 랭킹 키 — probe 가 *실제 fetch 키*와 정합하도록.
 *   ON  : FOREIGN 소스가 정본 'foreign-net-buy'(실 외국인 순매수) 로 발굴(dynamicUniverseExpander 정합).
 *   OFF : FOREIGN 소스가 'volume' 대용(byte-identical 롤백).
 * 관측 전용 — 매매 결정 직접 사용 0.
 */
export function resolveLeaderRankingTypes(): readonly RankingType[] {
  const foreignKey: RankingType = isLeaderRankingEndpointFixEnabled() ? 'foreign-net-buy' : 'volume';
  return ['market-cap', 'institutional-net-buy', foreignKey] as const;
}

export interface LeaderRankingProbeRow {
  type: RankingType;
  trId: string;
  /** bypassCache 강제 후 합산 entry 수(KOSPI+KOSDAQ). 0 = real-data 빈 응답/차단. */
  count: number;
  /** 해당 trId circuit open 잔여(ms). 0 = 정상. >0 = 차단 중(빈 응답 원인). */
  circuitOpenForMs: number;
  /**
   * 비-chart realData GET 의 마지막 *진단용* 실패 분류(passive). 403→AUTH_OR_TOKEN /
   * 5xx→TRANSIENT_SERVER_500 등. undefined = 실패 stamp 없음(성공/미호출). 관측 전용.
   */
  lastErrorKind?: KisRealDataErrorKind;
  /** 마지막 진단용 실패 HTTP status (403/500/404…). undefined = stamp 없음. */
  lastHttpStatus?: number;
  /**
   * ADR-0651 W1 additive — KIS 응답 바디 압축 1줄(rt_cd/msg_cd/msg1). 403(권한) vs
   * param 거부를 실거부 사유로 구분. undefined = stamp 없음. 관측·표시 전용(불변식 #6).
   */
  lastKisMsg?: string;
}

export interface LeaderRankingProbe {
  marketOpen: boolean;
  hasRealDataClient: boolean;
  kisIsReal: boolean;
  hasOverrides: boolean;
  rows: LeaderRankingProbeRow[];
}

/**
 * leader 랭킹 3종을 bypassCache=true 로 강제 조회해 per-key 실응답 수 + circuit 상태를 반환.
 * 관측 전용: getRanking 성공 시 5분 캐시 충전 side effect 는 수동 트리거 의도와 정합.
 * @internal 호출자(텔레그램 /leader_refresh)가 verdict 해석·표시 책임.
 */
export async function probeLeaderRanking(): Promise<LeaderRankingProbe> {
  const stats = getCircuitBreakerStats();
  const openByTr = new Map(stats.map((s) => [s.trId, s.openFor]));
  const rows: LeaderRankingProbeRow[] = [];
  for (const type of resolveLeaderRankingTypes()) {
    const spec = TR_SPECS[type];
    // ADR-0652 — probe 도 resolved endpoint(정정된 trId/apiPath)로 circuit·diag 를 읽어
    //   getRanking 의 실제 fetch 키와 정합한다(OFF 시 spec 원본과 동일).
    const ep = resolveRankingEndpoint(type, 'J');
    const trId = ep.trId;
    let count = 0;
    try {
      count = (await getRanking(type, { bypassCache: true, limit: 30 })).length;
    } catch {
      // 개별 키 실패는 0 으로 흡수 — 프로브는 throw 없이 전체 결과를 돌려준다.
      count = 0;
    }
    // Patch-LEADER-PROBE-LASTERR-DIAG — getRanking 호출 직후 endpoint(apiPath) 의
    //   passive last-error stamp 를 read. http.ts 가 비-chart 실패 시 status 를 보존.
    //   성공 시 stamp 가 해제되므로 정상 응답이면 자연히 undefined.
    const diag = getRealDataLastErrorForDiag(ep.apiPath);
    rows.push({
      type,
      trId,
      count,
      // ADR-0651 W3 — leader 경로는 namespaced circuit 키(`${trId}#LEADER`)를 쓰므로
      //   probe 도 동일 키로 circuit 잔여를 읽는다(screener 의 원본 trId circuit 과 분리 관측).
      circuitOpenForMs: openByTr.get(`${trId}#LEADER`) ?? openByTr.get(trId) ?? 0,
      ...(diag ? { lastErrorKind: diag.errorKind } : {}),
      ...(diag?.httpStatus !== undefined ? { lastHttpStatus: diag.httpStatus } : {}),
      ...(diag?.kisMsg !== undefined ? { lastKisMsg: diag.kisMsg } : {}),
    });
  }
  return {
    marketOpen: isMarketOpen(),
    hasRealDataClient: HAS_REAL_DATA_CLIENT,
    kisIsReal: KIS_IS_REAL,
    hasOverrides: hasKisClientOverrides(),
    rows,
  };
}
