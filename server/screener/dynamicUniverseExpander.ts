/**
 * dynamicUniverseExpander.ts — 아이디어 6: STOCK_UNIVERSE 동적 확장
 *
 * 매주 1회 (토요일 KST 09:00) KIS API에서:
 *   1. 52주 신고가 상위 종목 (FHPST01700000 + 신고가 필터)
 *   2. 외국인 순매수 상위 종목 (FHPST01710000 + 외국인 필터)
 *   3. 당일 등락률 중위권 +3~+7% 신흥 주도주 (FHPST01700000, Tier 1)
 *   4. 시가총액 상위 중·대형주 리프레시 (FHPST01720000, Tier 1)
 * 을 수집하여, STOCK_UNIVERSE에 없는 신흥 주도주를 임시 추가.
 *
 * - 동적 확장 종목은 메모리 캐시 + JSON 파일로 영속화
 * - 2주(14일) 후 자동 만료 → 다음 주 스캔에서 갱신
 * - 기존 STOCK_UNIVERSE 원본은 수정하지 않음
 * - getExpandedUniverse()로 정적 + 동적 병합 유니버스 제공
 *
 * Yahoo 의존도 축소: Tier 1 3종(거래량·등락률·시총) 순위가 모두 KIS로
 * 직접 추출되므로, Yahoo Finance 장애 시에도 유니버스 갱신이 유지된다.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from '../persistence/paths.js';
import { realDataKisGet, HAS_REAL_DATA_CLIENT, KIS_IS_REAL } from '../clients/kisClient.js';
import { type RankingEntry, type RankingType } from '../clients/kisRankingClient.js';
import { getShadowSafeRanking } from './shadowDataGate.js';
import { STOCK_UNIVERSE } from './stockScreener.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface DynamicStock {
  symbol: string;    // Yahoo Finance 심볼 (예: '005930.KS')
  code: string;      // 6자리 종목코드
  name: string;
  // 아이디어 5: Gemini googleSearch 대체용 KIS 순위 3종 source 추가.
  source:
    | '52W_HIGH'
    | 'FOREIGN_NET_BUY'
    | 'MID_RISER'
    | 'MARKET_CAP'
    | 'INST_NET_BUY'
    | 'LARGE_VOLUME'
    // 공매도 잔고 상위는 "하락 베팅"이 몰린 종목 — 워치리스트에 편입하는
    // 용도가 아니라 스크리너 결과에서 제외할 "반대 신호" 태그로 추후 활용.
    | 'SHORT_HEAVY';
  addedAt: string;   // ISO 8601
  expiresAt: string; // ISO 8601 — 2주 후 자동 만료
}

const DYNAMIC_UNIVERSE_FILE = path.join(DATA_DIR, 'dynamic-universe.json');
const EXPIRY_DAYS = 14;

// ── 영속화 ────────────────────────────────────────────────────────────────────

function loadDynamicUniverse(): DynamicStock[] {
  ensureDataDir();
  if (!fs.existsSync(DYNAMIC_UNIVERSE_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DYNAMIC_UNIVERSE_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveDynamicUniverse(stocks: DynamicStock[]): void {
  ensureDataDir();
  fs.writeFileSync(DYNAMIC_UNIVERSE_FILE, JSON.stringify(stocks, null, 2));
}

// ── 만료 정리 ─────────────────────────────────────────────────────────────────

function purgeExpired(stocks: DynamicStock[]): DynamicStock[] {
  const now = new Date().toISOString();
  return stocks.filter(s => s.expiresAt > now);
}

// ── KIS API 수집 ──────────────────────────────────────────────────────────────

/**
 * KIS 52주 신고가 상위 종목 수집.
 * FHPST01710000 (거래량 순위) + 52주 신고가 근접 종목 필터.
 * KIS API에서 직접 52주 신고가 순위를 제공하지 않으므로,
 * 상승률 상위 종목 중 52주 최고가를 기준으로 필터.
 */
async function fetch52WeekHighStocks(): Promise<Omit<DynamicStock, 'addedAt' | 'expiresAt'>[]> {
  if (!HAS_REAL_DATA_CLIENT && !KIS_IS_REAL) return [];

  try {
    // 상승률 상위 종목 조회 (KOSPI + KOSDAQ)
    const results: Omit<DynamicStock, 'addedAt' | 'expiresAt'>[] = [];

    for (const mrktDiv of ['J', 'Q']) {  // J=KOSPI, Q=KOSDAQ
      const data = await realDataKisGet(
        'FHPST01700000',
        '/uapi/domestic-stock/v1/ranking/fluctuation',
        {
          fid_cond_mrkt_div_code: mrktDiv,
          fid_cond_scr_div_code: '20170',
          fid_input_iscd: '0000',
          fid_rank_sort_cls_code: '0',          // 상승률 내림차순
          fid_input_cnt_1: '0',
          fid_prc_cls_code: '1',                // 52주 신고가
          fid_input_price_1: '5000',            // 5,000원 이상
          fid_input_price_2: '',
          fid_vol_cnt: '10000',                 // 거래량 1만주 이상
          fid_trgt_cls_code: '0',
          fid_trgt_exls_cls_code: '0',
          fid_div_cls_code: '0',
          fid_rsfl_rate1: '',
          fid_rsfl_rate2: '',
        },
      );

      const output = (data as { output?: Record<string, string>[] } | null)?.output;
      if (!output || !Array.isArray(output)) continue;

      const suffix = mrktDiv === 'J' ? '.KS' : '.KQ';
      for (const item of output.slice(0, 15)) {
        const code = item.mksc_shrn_iscd ?? item.stck_shrn_iscd ?? '';
        const name = item.hts_kor_isnm ?? '';
        if (!code || code.length !== 6) continue;
        results.push({
          symbol: `${code}${suffix}`,
          code,
          name,
          source: '52W_HIGH',
        });
      }
    }

    console.log(`[DynamicExpander] 52주 신고가 후보: ${results.length}개`);
    return results;
  } catch (e) {
    console.error('[DynamicExpander] 52주 신고가 수집 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * KIS 외국인 순매수 상위 종목 수집.
 * FHPST01710000 — 거래량 상위 중 외국인 순매수가 양수인 종목.
 */
async function fetchForeignNetBuyStocks(): Promise<Omit<DynamicStock, 'addedAt' | 'expiresAt'>[]> {
  if (!HAS_REAL_DATA_CLIENT && !KIS_IS_REAL) return [];

  try {
    const results: Omit<DynamicStock, 'addedAt' | 'expiresAt'>[] = [];

    for (const mrktDiv of ['J', 'Q']) {
      const data = await realDataKisGet(
        'FHPST01710000',
        '/uapi/domestic-stock/v1/ranking/volume',
        {
          fid_cond_mrkt_div_code: mrktDiv,
          fid_cond_scr_div_code: '20171',
          fid_input_iscd: '0000',
          fid_div_cls_code: '0',
          fid_blng_cls_code: '0',
          fid_trgt_cls_code: '111111111',
          fid_trgt_exls_cls_code: '000000',
          fid_input_price_1: '5000',
          fid_input_price_2: '',
          fid_vol_cnt: '50000',                 // 거래량 5만주 이상
          fid_input_date_1: '',
        },
      );

      const output = (data as { output?: Record<string, string>[] } | null)?.output;
      if (!output || !Array.isArray(output)) continue;

      const suffix = mrktDiv === 'J' ? '.KS' : '.KQ';
      for (const item of output.slice(0, 20)) {
        const code = item.mksc_shrn_iscd ?? item.stck_shrn_iscd ?? '';
        const name = item.hts_kor_isnm ?? '';
        const foreignNet = parseInt(item.frgn_ntby_qty ?? '0', 10);
        if (!code || code.length !== 6) continue;
        if (foreignNet <= 0) continue;  // 외국인 순매수 양수만

        results.push({
          symbol: `${code}${suffix}`,
          code,
          name,
          source: 'FOREIGN_NET_BUY',
        });
      }
    }

    console.log(`[DynamicExpander] 외국인 순매수 후보: ${results.length}개`);
    return results;
  } catch (e) {
    console.error('[DynamicExpander] 외국인 순매수 수집 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Tier 1 ②: 당일 등락률 +3~+7% 중위권 상승 종목 수집.
 * 신고가·과열(+8% 이상)은 기존 스테이지 필터에서 걸러지므로,
 * "새 주도주 초기 신호" 구간만 유니버스에 선편입한다.
 * FHPST01700000 등락률 순위 + 등락률 레인지 필터.
 */
async function fetchMidRangeRisers(): Promise<Omit<DynamicStock, 'addedAt' | 'expiresAt'>[]> {
  if (!HAS_REAL_DATA_CLIENT && !KIS_IS_REAL) return [];

  try {
    const results: Omit<DynamicStock, 'addedAt' | 'expiresAt'>[] = [];

    for (const mrktDiv of ['J', 'Q']) {
      const data = await realDataKisGet(
        'FHPST01700000',
        '/uapi/domestic-stock/v1/ranking/fluctuation',
        {
          fid_cond_mrkt_div_code: mrktDiv,
          fid_cond_scr_div_code: '20170',
          fid_input_iscd: '0000',
          fid_rank_sort_cls_code: '0',          // 상승률 내림차순
          fid_input_cnt_1: '0',
          fid_prc_cls_code: '0',                // 0 = 전체 (신고가 제약 없음)
          fid_input_price_1: '5000',
          fid_input_price_2: '',
          fid_vol_cnt: '50000',                 // 거래량 5만주 이상
          fid_trgt_cls_code: '0',
          fid_trgt_exls_cls_code: '0',
          fid_div_cls_code: '0',
          fid_rsfl_rate1: '3',                  // 등락률 하한 +3%
          fid_rsfl_rate2: '7',                  // 등락률 상한 +7%
        },
      );

      const output = (data as { output?: Record<string, string>[] } | null)?.output;
      if (!output || !Array.isArray(output)) continue;

      const suffix = mrktDiv === 'J' ? '.KS' : '.KQ';
      for (const item of output.slice(0, 15)) {
        const code = item.mksc_shrn_iscd ?? item.stck_shrn_iscd ?? '';
        const name = item.hts_kor_isnm ?? '';
        if (!code || code.length !== 6) continue;
        const rate = parseFloat(item.prdy_ctrt ?? '0');
        // 응답 필터가 누락되어도 코드 레벨 재검증 — 과열 차단
        if (!Number.isFinite(rate) || rate < 3 || rate > 7) continue;
        results.push({
          symbol: `${code}${suffix}`,
          code,
          name,
          source: 'MID_RISER',
        });
      }
    }

    console.log(`[DynamicExpander] 중위권 상승 후보: ${results.length}개`);
    return results;
  } catch (e) {
    console.error('[DynamicExpander] 중위권 상승 수집 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Tier 1 ③: 시가총액 상위 종목 수집 — 중·대형주 유니버스 자동 리프레시.
 * FHPST01720000 시가총액 순위 상위 30 (KOSPI+KOSDAQ 통합).
 * 주간 1회 갱신으로 정적 유니버스의 경직성을 해소.
 */
async function fetchMarketCapLeaders(): Promise<Omit<DynamicStock, 'addedAt' | 'expiresAt'>[]> {
  if (!HAS_REAL_DATA_CLIENT && !KIS_IS_REAL) return [];

  try {
    const results: Omit<DynamicStock, 'addedAt' | 'expiresAt'>[] = [];

    for (const mrktDiv of ['J', 'Q']) {
      const data = await realDataKisGet(
        'FHPST01720000',
        '/uapi/domestic-stock/v1/ranking/market-cap',
        {
          fid_cond_mrkt_div_code: mrktDiv,
          fid_cond_scr_div_code: '20172',
          fid_input_iscd: '0000',
          fid_div_cls_code: '0',
          fid_input_price_1: '',
          fid_input_price_2: '',
          fid_vol_cnt: '',
          fid_trgt_cls_code: '0',
          fid_trgt_exls_cls_code: '0',
        },
      );

      const output = (data as { output?: Record<string, string>[] } | null)?.output;
      if (!output || !Array.isArray(output)) continue;

      const suffix = mrktDiv === 'J' ? '.KS' : '.KQ';
      for (const item of output.slice(0, 30)) {
        const code = item.mksc_shrn_iscd ?? item.stck_shrn_iscd ?? '';
        const name = item.hts_kor_isnm ?? '';
        if (!code || code.length !== 6) continue;
        results.push({
          symbol: `${code}${suffix}`,
          code,
          name,
          source: 'MARKET_CAP',
        });
      }
    }

    console.log(`[DynamicExpander] 시가총액 상위 후보: ${results.length}개`);
    return results;
  } catch (e) {
    console.error('[DynamicExpander] 시가총액 상위 수집 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

// ── 메인 확장 로직 ────────────────────────────────────────────────────────────

/**
 * 주간 동적 유니버스 확장 실행.
 * 1. 기존 동적 목록에서 만료 종목 제거
 * 2. KIS API로 52주 신고가 + 외국인 순매수 상위 수집
 * 3. 정적 STOCK_UNIVERSE에 없는 신규 종목만 추가
 * 4. 결과를 JSON 파일로 저장 + Telegram 알림
 */
export async function runDynamicUniverseExpansion(): Promise<number> {
  const staticCodes = new Set(STOCK_UNIVERSE.map(s => s.code));

  // 기존 동적 목록 로드 & 만료 정리
  let dynamicStocks = purgeExpired(loadDynamicUniverse());
  const existingDynamicCodes = new Set(dynamicStocks.map(s => s.code));

  // KIS API 수집 (병렬) — Tier 1 3종 + 기존 2종
  const [highStocks, foreignStocks, midRisers, marketCapLeaders] = await Promise.all([
    fetch52WeekHighStocks(),
    fetchForeignNetBuyStocks(),
    fetchMidRangeRisers(),
    fetchMarketCapLeaders(),
  ]);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const addedAt = now.toISOString();
  let newCount = 0;

  // 병합: 정적 유니버스에 없고 + 기존 동적 목록에도 없는 종목만 추가
  const allCandidates = [...highStocks, ...foreignStocks, ...midRisers, ...marketCapLeaders];
  for (const c of allCandidates) {
    if (staticCodes.has(c.code)) continue;
    if (existingDynamicCodes.has(c.code)) continue;
    dynamicStocks.push({ ...c, addedAt, expiresAt });
    existingDynamicCodes.add(c.code);
    newCount++;
  }

  saveDynamicUniverse(dynamicStocks);
  console.log(
    `[DynamicExpander] 완료 — 신규 ${newCount}개 추가, 전체 동적 ${dynamicStocks.length}개 ` +
    `(정적 ${STOCK_UNIVERSE.length}개 + 동적 = ${STOCK_UNIVERSE.length + dynamicStocks.length}개 유니버스)`,
  );

  // Telegram 알림
  if (newCount > 0) {
    const sourceLabel: Record<DynamicStock['source'], string> = {
      '52W_HIGH':        '52주신고가',
      'FOREIGN_NET_BUY': '외국인순매수',
      'MID_RISER':       '중위권상승(+3~7%)',
      'MARKET_CAP':      '시총상위',
      'INST_NET_BUY':    '기관순매수상위',
      'LARGE_VOLUME':    '대량거래상위',
      'SHORT_HEAVY':     '공매도잔고상위',
    };
    const newStockLines = allCandidates
      .filter(c => !staticCodes.has(c.code))
      .slice(0, 15)
      .map(c => `  ${c.name}(${c.code}) [${sourceLabel[c.source]}]`)
      .join('\n');

    await sendTelegramAlert(
      `🔭 <b>[동적 유니버스 확장]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `정적: ${STOCK_UNIVERSE.length}개 | 동적: ${dynamicStocks.length}개 (+${newCount})\n` +
      `만료: ${EXPIRY_DAYS}일 후 자동 제거\n\n` +
      `<b>신규 편입 종목:</b>\n${newStockLines}\n` +
      `━━━━━━━━━━━━━━━━━━━━`,
      {
        priority: 'NORMAL',
        dedupeKey: 'dynamic-universe-weekly',
        cooldownMs: 6 * 24 * 60 * 60 * 1000,  // 6일 쿨다운 (주 1회)
      },
    ).catch(console.error);
  }

  return newCount;
}

// ── 빈 스캔 트리거 확장 ───────────────────────────────────────────────────────

/**
 * 빈 스캔 연속 감지 시 즉시 호출 — "유니버스 확장" 오버라이드 액션의 구동부.
 *
 * 정기 runDynamicUniverseExpansion()은 주 1회 스케줄이라 운용자가 "지금" 확장하고
 * 싶을 때 기다릴 수 없다. 이 메서드는:
 *   1. KIS API로 52주 신고가 + 외국인 순매수 상위를 즉시 수집
 *   2. TTL을 단축(기본 3일)하여 오버라이드의 일시성을 반영
 *   3. Telegram 알림 없이 조용히 실행 (호출자가 응답 포맷 책임)
 *
 * @param ttlDays 동적 편입 만료 기간 (기본 3일 — 빈 스캔 대응 임시성)
 * @returns 신규 편입 종목 수
 */
export async function expandOnEmpty(ttlDays = 3): Promise<number> {
  const staticCodes = new Set(STOCK_UNIVERSE.map(s => s.code));
  let dynamicStocks = purgeExpired(loadDynamicUniverse());
  const existingDynamicCodes = new Set(dynamicStocks.map(s => s.code));

  // Phase A + 아이디어 5: 6개 KIS 랭킹 TR을 병렬 호출.
  // 각 호출은 자체 5분 캐시·시장별 부분 실패 허용·전체 실패 시 빈 배열.
  // allSettled로 감싸서 한 랭킹이 throw해도 나머지 결과와 정적 유니버스로 자연 폴백.
  // 기관 순매수/대량거래 상위를 편입함으로써 "지금 뜨는 종목" 질문이 googleSearch 없이 해결.
  const RANKING_KEYS: RankingType[] = [
    'volume', 'fluctuation', 'market-cap',
    'institutional-net-buy', 'large-volume',
  ];
  // Phase 1: Shadow-VTS decoupling — Shadow 모드에서 VTS 랭킹이 비어도
  // Yahoo 폴백으로 자동 전환. LIVE 모드에서는 동작 변경 없음.
  const settled = await Promise.allSettled(
    RANKING_KEYS.map(k => getShadowSafeRanking(k, { limit: 30 })),
  );
  const [volume, fluctuation, marketCap, instNetBuy, largeVolume] = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.warn(
      `[DynamicExpander] expandOnEmpty ${RANKING_KEYS[i]} 실패 (흡수):`,
      r.reason instanceof Error ? r.reason.message : r.reason,
    );
    return [] as RankingEntry[];
  });

  const toDynamic = (e: RankingEntry, source: DynamicStock['source']): Omit<DynamicStock, 'addedAt' | 'expiresAt'> => ({
    symbol: `${e.code}${e.market === 'KOSPI' ? '.KS' : '.KQ'}`,
    code:   e.code,
    name:   e.name,
    source,
  });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const addedAt = now.toISOString();
  let newCount = 0;

  // 5개 랭킹 → 기존 DynamicStock.source 카테고리로 매핑.
  //   volume               → FOREIGN_NET_BUY (거래량 상위 = 수급 유입 근사)
  //   fluctuation          → MID_RISER      (등락률 +3~+7% 필터)
  //   market-cap           → MARKET_CAP
  //   institutional-net-buy → INST_NET_BUY  (기관 순매수 양수만)
  //   large-volume         → LARGE_VOLUME   (대량거래 상위)
  // 중복은 Set 기반 기존 루프에서 자연 제거 — 같은 코드가 여러 랭킹에 걸쳐도
  // 첫 등장 source 만 반영 (중복 편입 방지).
  const merged: Array<Omit<DynamicStock, 'addedAt' | 'expiresAt'>> = [
    ...volume.map(e => toDynamic(e, 'FOREIGN_NET_BUY')),
    ...fluctuation
      // 기존 expandOnEmpty의 +3~+7% 중위권 필터를 클라이언트 레벨로 이관.
      .filter(e => e.changePercent >= 3 && e.changePercent <= 7)
      .map(e => toDynamic(e, 'MID_RISER')),
    ...marketCap.map(e => toDynamic(e, 'MARKET_CAP')),
    ...instNetBuy
      // 기관 순매수량(value)이 양수인 종목만 편입.
      .filter(e => e.value > 0)
      .map(e => toDynamic(e, 'INST_NET_BUY')),
    ...largeVolume.map(e => toDynamic(e, 'LARGE_VOLUME')),
  ];

  for (const c of merged) {
    if (staticCodes.has(c.code)) continue;
    if (existingDynamicCodes.has(c.code)) continue;
    dynamicStocks.push({ ...c, addedAt, expiresAt });
    existingDynamicCodes.add(c.code);
    newCount++;
  }

  saveDynamicUniverse(dynamicStocks);
  console.log(
    `[DynamicExpander] expandOnEmpty 완료 — 신규 ${newCount}개 (TTL ${ttlDays}일), ` +
    `전체 동적 ${dynamicStocks.length}개 (vol ${volume.length}·flc ${fluctuation.length}·mc ${marketCap.length}` +
    `·inst ${instNetBuy.length}·lrgVol ${largeVolume.length})`,
  );
  return newCount;
}

// ── 확장 유니버스 제공 ────────────────────────────────────────────────────────

/**
 * 정적 STOCK_UNIVERSE + 동적 확장 종목 병합 반환.
 * 중복 제거 (코드 기준). 만료 종목은 자동 제외.
 */
export function getExpandedUniverse(): { symbol: string; code: string; name: string }[] {
  const staticCodes = new Set(STOCK_UNIVERSE.map(s => s.code));
  const dynamicStocks = purgeExpired(loadDynamicUniverse());

  const expanded = [...STOCK_UNIVERSE];
  for (const d of dynamicStocks) {
    if (staticCodes.has(d.code)) continue;
    expanded.push({ symbol: d.symbol, code: d.code, name: d.name });
  }

  return expanded;
}
