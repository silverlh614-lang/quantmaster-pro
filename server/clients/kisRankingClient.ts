/**
 * kisRankingClient.ts — KIS 순위 기반 TR 단일 책임 클라이언트 (Phase A)
 *
 * 단일 책임: "순위 → 종목" 방향의 KIS 랭킹 TR 3종만 관리한다.
 *   - volume:       FHPST01710000 (거래량 상위)
 *   - fluctuation:  FHPST01700000 (등락률 상위)
 *   - market-cap:   FHPST01720000 (시가총액 상위)
 *
 * 기존 kisClient.ts의 토큰·헤더 로직은 realDataKisGet 재사용으로 그대로 가져온다.
 * kisClient를 2,000줄짜리 비대 파일로 만들지 않기 위한 분리 — 항후 flow/ws 클라이언트도
 * 같은 패턴으로 독립시킨다.
 *
 * 반환: { code, name, rank, value, changePercent }[]
 * 캐시: 메모리 5분 TTL (장중 과다 호출 방지 — 호출자가 주기적으로 두들겨도 1/300s 만큼만 실제 API)
 * 실패: 빈 배열 반환 (호출자는 기존 Yahoo/정적 유니버스로 자연스럽게 폴백)
 */

import {
  realDataKisGet,
  HAS_REAL_DATA_CLIENT,
  KIS_IS_REAL,
  hasKisClientOverrides,
} from './kisClient.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export type RankingType = 'volume' | 'fluctuation' | 'market-cap';

export interface RankingEntry {
  code: string;           // 6자리 종목코드
  name: string;           // 한글 종목명
  rank: number;           // 1부터 시작하는 순위 (KOSPI·KOSDAQ 통합 순위는 아님 — 각 시장 내 순위)
  value: number;          // 정렬 기준값 — 거래량/등락률/시가총액 등 TR에 따라 의미 상이
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
