// @responsibility shadowDataGate 스크리너 모듈
/**
 * shadowDataGate.ts — Shadow 모드 전용 데이터 게이트 (Phase 1: Shadow-VTS Decoupling)
 *
 * 목적: Shadow 학습 루프를 VTS/KIS API 장애로부터 완전히 격리한다.
 *
 * 버그 수정이 아니라 아키텍처 격리:
 *   - LIVE 모드: KIS 랭킹 TR 직접 사용 (기존 getRanking).
 *   - Shadow 모드(KIS_IS_REAL=false): KIS 랭킹이 비어 있거나 실패하면
 *     Yahoo Finance + 정적 유니버스 기반 대체 순위를 만들어 반환한다.
 *
 * 향후 KIS API가 장애나도 Shadow 학습 루프는 멈추지 않는다.
 * 2시간 투자로 얻는 영구적 독립성.
 *
 * 사용처:
 *   dynamicUniverseExpander.expandOnEmpty() → getShadowSafeRanking()
 *   (기존 getRanking() 직접 호출은 LIVE 전용 경로에서만 유지)
 */

import { getRanking, type RankingEntry, type RankingType } from '../clients/kisRankingClient.js';
import { STOCK_UNIVERSE } from './stockScreener.js';
import { fetchYahooQuote } from './stockScreener.js';

// ── 모드 판별 ─────────────────────────────────────────────────────────────────

/**
 * 현재 실행 모드가 Shadow인지 판정.
 * AUTO_TRADE_MODE=LIVE 가 명시적으로 설정되지 않은 모든 환경은 Shadow로 간주.
 * 이는 signalScanner 의 기존 판정(`process.env.AUTO_TRADE_MODE !== 'LIVE'`)과 일치.
 */
export function isShadowMode(): boolean {
  return process.env.AUTO_TRADE_MODE !== 'LIVE';
}

/**
 * KIS가 VTS 서버를 가리키고 있는지.
 * VTS 서버는 장중 거래량 순위 TR이 자주 비어 있거나 실패한다 — Shadow 학습의
 * 단일 장애점. KIS_REAL_DATA_APP_KEY 가 설정되어 있으면 실데이터 서버로 조회가
 * 넘어가므로 "VTS-only" 상태만 격리 대상으로 본다.
 */
export function isVtsOnly(): boolean {
  const isVts = process.env.KIS_IS_REAL !== 'true';
  const hasRealDataKeys = !!(process.env.KIS_REAL_DATA_APP_KEY && process.env.KIS_REAL_DATA_APP_SECRET);
  return isVts && !hasRealDataKeys;
}

// ── Yahoo Fallback ranking ────────────────────────────────────────────────────

/**
 * Yahoo Finance 단일 쿼리로 "랭킹 엔트리"를 유도한다.
 *
 * 호출 비용을 제어하기 위해 정적 유니버스에서 maxProbe 개 샘플만 Yahoo에 문의한다.
 * (기본 60개 — KOSPI+KOSDAQ 대표종목). VTS 장애 구간에서 Shadow 샘플이 끊기지
 * 않도록 최소한의 다양성을 보장하는 것이 목적이지, Yahoo를 통해 완전한 순위를
 * 재현하는 것이 목적이 아니다.
 *
 * 반환 필드:
 *   - code/name: 정적 유니버스 원본
 *   - rank: 정렬 후 순번
 *   - value/changePercent: Yahoo quote에서 추출
 *   - market: symbol suffix로 판별
 */
async function yahooFallbackRanking(
  type: RankingType,
  limit: number,
  maxProbe = 60,
): Promise<RankingEntry[]> {
  const samples = STOCK_UNIVERSE.slice(0, maxProbe);
  const quotes = await Promise.allSettled(samples.map(s => fetchYahooQuote(s.symbol)));

  const rows: Array<{
    code: string;
    name: string;
    value: number;
    changePercent: number;
    volume: number;
    market: 'KOSPI' | 'KOSDAQ';
  }> = [];

  for (let i = 0; i < samples.length; i++) {
    const q = quotes[i];
    if (q.status !== 'fulfilled' || !q.value) continue;
    const s = samples[i];
    const market: 'KOSPI' | 'KOSDAQ' = s.symbol.endsWith('.KQ') ? 'KOSDAQ' : 'KOSPI';
    rows.push({
      code: s.code,
      name: s.name,
      volume: q.value.volume,
      changePercent: q.value.changePercent,
      value: 0, // 정렬 기준 아래에서 type 별로 채움
      market,
    });
  }

  // 정렬 기준 — KIS 원본 TR 의미에 맞춰 근사.
  let sorter: (a: (typeof rows)[number], b: (typeof rows)[number]) => number;
  switch (type) {
    case 'fluctuation':
    case 'large-volume':
      sorter = (a, b) => b.changePercent - a.changePercent;
      break;
    case 'volume':
    case 'institutional-net-buy':
    case 'short-balance':
      sorter = (a, b) => b.volume - a.volume;
      break;
    case 'market-cap':
      // Yahoo meta.marketCap은 fetchYahooQuote에 노출되지 않음 → 유니버스 순서 유지.
      sorter = () => 0;
      break;
    default:
      sorter = (a, b) => b.volume - a.volume;
  }
  rows.sort(sorter);

  return rows.slice(0, limit).map<RankingEntry>((r, idx) => ({
    code: r.code,
    name: r.name,
    rank: idx + 1,
    value: type === 'fluctuation' || type === 'large-volume' ? r.changePercent : r.volume,
    changePercent: r.changePercent,
    market: r.market,
  }));
}

// ── 공개 API ───────────────────────────────────────────────────────────────────

export interface ShadowSafeRankingOptions {
  limit?: number;
  /** 테스트·진단용: Yahoo 프로브 샘플 수(기본 60). */
  maxProbe?: number;
  /** 테스트·진단용: Shadow 판정을 강제한다. 미지정 시 환경변수 기반 자동판정. */
  forceShadow?: boolean;
}

/**
 * Shadow 모드에서 안전한 랭킹 조회.
 *
 * 1) KIS ranking을 먼저 시도 (LIVE/VTS/real-data 모두 동일 경로).
 * 2) Shadow & VTS-only 조건이면서 결과가 비어 있거나 예외 시 Yahoo 폴백으로 자동 전환.
 * 3) LIVE 모드에서는 KIS 결과를 그대로 반환 — 장애가 있으면 실거래 루프가 감지해야 함.
 *
 * 이 함수는 getRanking() 의 호환 드롭인 대체가 아니다. 호출자는 "Shadow 학습
 * 데이터가 필요한 구간" 에서만 사용해야 한다 (예: dynamicUniverseExpander).
 */
export async function getShadowSafeRanking(
  type: RankingType,
  opts: ShadowSafeRankingOptions = {},
): Promise<RankingEntry[]> {
  const limit = opts.limit ?? 30;
  const shadow = opts.forceShadow ?? isShadowMode();

  let primary: RankingEntry[] = [];
  try {
    primary = await getRanking(type, { limit });
  } catch (e) {
    console.warn(
      `[ShadowDataGate] getRanking ${type} 예외 — Shadow 폴백 검토:`,
      e instanceof Error ? e.message : e,
    );
  }

  if (primary.length > 0) return primary;

  if (!shadow || !isVtsOnly()) {
    // LIVE 또는 real-data keys 사용 중 — 빈 배열은 "진짜 데이터 없음" 이므로 상위에 전달.
    return primary;
  }

  // Shadow + VTS-only → Yahoo 폴백
  try {
    const fallback = await yahooFallbackRanking(type, limit, opts.maxProbe);
    if (fallback.length > 0) {
      console.log(
        `[ShadowDataGate] VTS 랭킹 ${type} 비어있음 — Yahoo 폴백 ${fallback.length}개 (Shadow 격리).`,
      );
    }
    return fallback;
  } catch (e) {
    console.warn(
      `[ShadowDataGate] Yahoo 폴백 ${type} 실패 (조용히 흡수):`,
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}
