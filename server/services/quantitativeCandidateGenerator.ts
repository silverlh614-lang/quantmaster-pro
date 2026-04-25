/**
 * @responsibility AI 추천 universe Tier 3 정량 폴백 — Yahoo OHLCV 기반 후보 생성 (ADR-0016, PR-37)
 *
 * Yahoo `/v8/finance/chart` 호출을 EgressGuard(PR-29) + SymbolMarketRegistry(PR-26) 게이트
 * 통과 KR 심볼만 진행. 시장 닫힘(주말/장외) 시 EgressGuard 가 503 으로 자동 차단해 빈 배열을
 * 반환하므로 호출자(`discoverUniverse`) 가 Tier 4(Naver) 로 진행한다. KIS/KRX 직접 호출 금지
 * (절대 규칙 #3). universe 모집단은 KRX 마스터 또는 SEED_UNIVERSE 같은 고유동성 코어 종목.
 */

import { guardedFetch } from '../utils/egressGuard.js';
import { classifySymbol } from '../utils/symbolMarketRegistry.js';
import { getAllStockEntries, type StockMasterEntry } from '../persistence/krxStockMasterRepo.js';
import { tryConsume } from '../persistence/aiCallBudgetRepo.js';
import type { AiUniverseMode } from './aiUniverseTypes.js';

/** Tier 3 후보 객체 — 정량 metric 포함. */
export interface QuantitativeCandidate {
  code: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ';
  /**
   * mode 별 정량 metric. 이름·범위는 mode 의존.
   * - momentum20d: 20일 종가 모멘텀 비율 (현재가 / 20일전 - 1)
   * - avgTurnoverKrw: 20일 평균 거래대금 (원)
   * - volatility20d: 20일 stdev(close) / mean(close)
   * - drawdownFromHigh: 52주 신고가 대비 하락률 (음수, 예: -0.07 = 7% 하락)
   * - beta20d: 20일 KOSPI 대비 단순 베타 근사 (개별/지수 변동성 비)
   */
  metrics: Record<string, number>;
}

export interface QuantCandidateResult {
  candidates: QuantitativeCandidate[];
  /** 가장 신선한 응답의 거래일 기준 (YYYY-MM-DD KST). 모두 stale/실패면 null. */
  tradingDateRef: string | null;
  /** EgressGuard 게이팅·응답 빈약·임계 미달 시 true → 호출자가 Tier 4 진행. */
  stale: boolean;
}

interface QuantCandidateOptions {
  /** 최종 반환 후보 수 (기본 12). */
  maxCandidates?: number;
  /**
   * 모집단 상한 — Yahoo 호출 비용 방어 (기본 50).
   * KRX 마스터가 비어있으면 SEED_UNIVERSE 24개로 대체된다.
   */
  universeLimit?: number;
}

/** 호출 비용 가드 — bucket 기본 한도 50/일. */
const YAHOO_BUCKET = 'yahoo_chart';

/**
 * SEED — KRX 마스터가 비어있을 때 fallback 으로 사용할 코어 종목.
 * `aiUniverseService.SEED_UNIVERSE` 와 별개로 본 모듈에서 자체 보관해 의존 순환을
 * 방지한다 (Tier 3 가 Tier 5 에 의존하면 graceful 분리가 깨짐).
 */
const CORE_SEED: ReadonlyArray<{ code: string; name: string; market: 'KOSPI' | 'KOSDAQ' }> = [
  { code: '005930', name: '삼성전자',     market: 'KOSPI' },
  { code: '000660', name: 'SK하이닉스',   market: 'KOSPI' },
  { code: '373220', name: 'LG에너지솔루션', market: 'KOSPI' },
  { code: '207940', name: '삼성바이오로직스', market: 'KOSPI' },
  { code: '005380', name: '현대차',       market: 'KOSPI' },
  { code: '000270', name: '기아',         market: 'KOSPI' },
  { code: '005490', name: 'POSCO홀딩스',  market: 'KOSPI' },
  { code: '035420', name: 'NAVER',        market: 'KOSPI' },
  { code: '035720', name: '카카오',       market: 'KOSPI' },
  { code: '051910', name: 'LG화학',       market: 'KOSPI' },
  { code: '006400', name: '삼성SDI',      market: 'KOSPI' },
  { code: '068270', name: '셀트리온',     market: 'KOSPI' },
  { code: '247540', name: '에코프로비엠', market: 'KOSDAQ' },
  { code: '086520', name: '에코프로',     market: 'KOSDAQ' },
  { code: '091990', name: '셀트리온헬스케어', market: 'KOSDAQ' },
  { code: '196170', name: '알테오젠',     market: 'KOSDAQ' },
  { code: '066970', name: '엘앤에프',     market: 'KOSDAQ' },
  { code: '015760', name: '한국전력',     market: 'KOSPI' },
  { code: '017670', name: 'SK텔레콤',     market: 'KOSPI' },
  { code: '033780', name: 'KT&G',         market: 'KOSPI' },
];

/**
 * Yahoo 심볼 조립 — KRX 6자리 코드 → `005930.KS` / `247540.KQ`.
 * 마스터 entry 의 market 필드 기준. KONEX/OTHER 는 Yahoo 미지원으로 제외.
 */
function toYahooSymbol(entry: { code: string; market: string }): string | null {
  if (entry.market === 'KOSPI') return `${entry.code}.KS`;
  if (entry.market === 'KOSDAQ') return `${entry.code}.KQ`;
  return null;
}

/**
 * 모집단 구성 — KRX 마스터의 KOSPI+KOSDAQ entry 를 universeLimit 까지.
 * 마스터가 비었거나 entry 수가 universeLimit 이하면 CORE_SEED 로 보완.
 */
function buildUniverse(universeLimit: number): Array<{ code: string; name: string; market: 'KOSPI' | 'KOSDAQ' }> {
  const all = getAllStockEntries();
  const equities = all
    .filter((e): e is StockMasterEntry & { market: 'KOSPI' | 'KOSDAQ' } =>
      e.market === 'KOSPI' || e.market === 'KOSDAQ')
    .map((e) => ({ code: e.code, name: e.name, market: e.market }));
  if (equities.length === 0) {
    return CORE_SEED.slice(0, universeLimit).map((s) => ({ ...s }));
  }
  // 마스터 정렬 정보가 없으므로 시총 정렬 불가 — CORE_SEED 우선 + 마스터 순서대로.
  const seen = new Set<string>();
  const out: Array<{ code: string; name: string; market: 'KOSPI' | 'KOSDAQ' }> = [];
  for (const s of CORE_SEED) {
    if (out.length >= universeLimit) break;
    if (seen.has(s.code)) continue;
    seen.add(s.code);
    out.push({ ...s });
  }
  for (const e of equities) {
    if (out.length >= universeLimit) break;
    if (seen.has(e.code)) continue;
    seen.add(e.code);
    out.push(e);
  }
  return out;
}

interface YahooBar {
  close: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}

interface YahooBundle {
  bars: YahooBar[];
  /** 가장 최근 close timestamp 기준의 KST YYYY-MM-DD. */
  tradingDate: string | null;
  /** 52주 신고가 (있으면). */
  fiftyTwoWeekHigh: number | null;
}

/**
 * Yahoo `/v8/finance/chart/{symbol}?range=3mo&interval=1d` 호출.
 * EgressGuard 가 시장 닫힘 시 503 반환 → 본 함수 null 반환.
 */
async function fetchYahooBundle(symbol: string): Promise<YahooBundle | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`;
  try {
    const res = await guardedFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; volume?: (number | null)[] }> };
          meta?: { fiftyTwoWeekHigh?: number };
        }>;
      };
    };
    const r = data.chart?.result?.[0];
    if (!r) return null;
    const ts = r.timestamp ?? [];
    const q = r.indicators?.quote?.[0] ?? {};
    const closes = q.close ?? [];
    const highs = q.high ?? [];
    const lows = q.low ?? [];
    const volumes = q.volume ?? [];
    const len = Math.min(ts.length, closes.length);
    const bars: YahooBar[] = [];
    for (let i = 0; i < len; i++) {
      bars.push({
        close: typeof closes[i] === 'number' ? closes[i] : null,
        high: typeof highs[i] === 'number' ? highs[i] : null,
        low: typeof lows[i] === 'number' ? lows[i] : null,
        volume: typeof volumes[i] === 'number' ? volumes[i] : null,
      });
    }
    let tradingDate: string | null = null;
    if (ts.length > 0) {
      const lastMs = ts[ts.length - 1] * 1000;
      const kst = new Date(lastMs + 9 * 3_600_000);
      tradingDate = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
    }
    const fiftyTwoWeekHigh = typeof r.meta?.fiftyTwoWeekHigh === 'number' ? r.meta.fiftyTwoWeekHigh : null;
    return { bars, tradingDate, fiftyTwoWeekHigh };
  } catch {
    // EgressGuard 503·timeout·JSON 파싱 모두 stale 처리.
    return null;
  }
}

// ── 정량 metric 헬퍼 ─────────────────────────────────────────────────────

function lastN<T>(arr: T[], n: number): T[] {
  return arr.length <= n ? arr.slice() : arr.slice(arr.length - n);
}

function computeMomentum(bars: YahooBar[], window: number): number {
  const recent = lastN(bars, window + 1).filter((b) => b.close !== null && b.close > 0);
  if (recent.length < 2) return 0;
  const first = recent[0].close as number;
  const last = recent[recent.length - 1].close as number;
  if (first <= 0) return 0;
  return last / first - 1;
}

function computeAvgTurnover(bars: YahooBar[], window: number): number {
  const recent = lastN(bars, window).filter((b) => b.close !== null && b.volume !== null);
  if (recent.length === 0) return 0;
  let sum = 0;
  for (const b of recent) sum += (b.close as number) * (b.volume as number);
  return sum / recent.length;
}

function computeVolatility(bars: YahooBar[], window: number): number {
  const recent = lastN(bars, window).filter((b): b is YahooBar & { close: number } => b.close !== null && b.close > 0);
  if (recent.length < 2) return 0;
  const mean = recent.reduce((s, b) => s + b.close, 0) / recent.length;
  if (mean === 0) return 0;
  const variance = recent.reduce((s, b) => s + (b.close - mean) ** 2, 0) / recent.length;
  return Math.sqrt(variance) / mean;
}

function computeDrawdownFromHigh(bars: YahooBar[], fiftyTwoWeekHigh: number | null): number {
  const closes = bars.filter((b) => b.close !== null && b.close > 0).map((b) => b.close as number);
  if (closes.length === 0) return 0;
  const last = closes[closes.length - 1];
  const high = fiftyTwoWeekHigh ?? Math.max(...closes);
  if (high <= 0) return 0;
  return last / high - 1;
}

// ── mode 별 정렬 규칙 ────────────────────────────────────────────────────

function rankCandidates(
  mode: AiUniverseMode,
  metricsByCode: Map<string, { entry: { code: string; name: string; market: 'KOSPI' | 'KOSDAQ' }; metrics: Record<string, number> }>,
): QuantitativeCandidate[] {
  const items = Array.from(metricsByCode.values());

  if (mode === 'MOMENTUM') {
    // 20일 모멘텀 + 평균 거래대금 합산 랭킹
    const ranks = (key: 'momentum20d' | 'avgTurnoverKrw'): Map<string, number> => {
      const sorted = [...items].sort((a, b) => (b.metrics[key] ?? 0) - (a.metrics[key] ?? 0));
      const m = new Map<string, number>();
      sorted.forEach((it, idx) => m.set(it.entry.code, idx));
      return m;
    };
    const r1 = ranks('momentum20d');
    const r2 = ranks('avgTurnoverKrw');
    return items
      .map((it) => ({ it, score: (r1.get(it.entry.code) ?? 0) + (r2.get(it.entry.code) ?? 0) }))
      .sort((a, b) => a.score - b.score)
      .map(({ it }) => ({ ...it.entry, metrics: it.metrics }));
  }

  if (mode === 'EARLY_DETECT') {
    // 20일 변동성 하위(낮은 변동) + 신고가 대비 -5%~-15% 구간
    const filtered = items.filter((it) => {
      const dd = it.metrics.drawdownFromHigh ?? 0;
      return dd <= -0.05 && dd >= -0.15;
    });
    const pool = filtered.length > 0 ? filtered : items;
    return pool
      .sort((a, b) => (a.metrics.volatility20d ?? Infinity) - (b.metrics.volatility20d ?? Infinity))
      .map((it) => ({ ...it.entry, metrics: it.metrics }));
  }

  if (mode === 'BEAR_SCREEN') {
    // 변동성 하위 — 1차 단순 근사 (베타·최대낙폭은 후속 PR)
    return items
      .sort((a, b) => (a.metrics.volatility20d ?? Infinity) - (b.metrics.volatility20d ?? Infinity))
      .map((it) => ({ ...it.entry, metrics: it.metrics }));
  }

  if (mode === 'SMALL_MID_CAP') {
    // PR-39: KOSDAQ 우선 정렬 + 각 그룹 내 모멘텀 순. KOSDAQ 그룹이 빈 경우 KOSPI 만.
    // Naver enrichment 후 service 단에서 시총 1,000억~3조 범위 필터 가능 (PER 정밀 필터는 후속).
    const kosdaq = new Map<string, typeof items[number]>();
    const kospi = new Map<string, typeof items[number]>();
    for (const it of items) {
      if (it.entry.market === 'KOSDAQ') kosdaq.set(it.entry.code, it);
      else kospi.set(it.entry.code, it);
    }
    return [
      ...rankCandidates('MOMENTUM', kosdaq),
      ...rankCandidates('MOMENTUM', kospi),
    ];
  }

  // QUANT_SCREEN — Naver enrichment 가 PER/PBR 을 제공해야 본격 정렬 가능.
  // Tier 3 단계에서는 MOMENTUM 정렬을 그대로 사용해 candidates 를 먼저 뽑고,
  // service 가 Naver 보강 후 PER<=15 / PBR<=1.5 필터를 적용하도록 위임.
  return rankCandidates('MOMENTUM', metricsByCode);
}

/**
 * Tier 3 정량 후보 생성 — universe 모집단 × Yahoo 3개월 일봉 × mode 별 랭킹.
 * 시장 닫힘 시 EgressGuard 503 로 빈 배열 stale=true 반환 → 호출자 Tier 4 진행.
 */
export async function generateQuantitativeCandidates(
  mode: AiUniverseMode,
  options: QuantCandidateOptions = {},
): Promise<QuantCandidateResult> {
  const maxCandidates = Math.max(1, Math.min(options.maxCandidates ?? 12, 30));
  const universeLimit = Math.max(5, Math.min(options.universeLimit ?? 50, 100));

  const universe = buildUniverse(universeLimit);
  if (universe.length === 0) {
    return { candidates: [], tradingDateRef: null, stale: true };
  }

  const metricsByCode = new Map<string, { entry: typeof universe[number]; metrics: Record<string, number> }>();
  let mostRecentTradingDate: string | null = null;
  let successCount = 0;

  for (const entry of universe) {
    const symbol = toYahooSymbol(entry);
    if (!symbol) continue;
    if (classifySymbol(symbol) !== 'KRX') continue; // 안전 가드

    // 호출 예산 — 한도 도달 시 즉시 종료해 stale 처리.
    if (!tryConsume(YAHOO_BUCKET, 1)) {
      // 이미 모은 결과로 진행 가능하면 진행, 모은 게 부족하면 stale.
      break;
    }
    const bundle = await fetchYahooBundle(symbol);
    if (!bundle || bundle.bars.length < 21) continue;

    const metrics: Record<string, number> = {
      momentum20d: computeMomentum(bundle.bars, 20),
      avgTurnoverKrw: computeAvgTurnover(bundle.bars, 20),
      volatility20d: computeVolatility(bundle.bars, 20),
      drawdownFromHigh: computeDrawdownFromHigh(bundle.bars, bundle.fiftyTwoWeekHigh),
    };
    metricsByCode.set(entry.code, { entry, metrics });
    successCount++;
    if (bundle.tradingDate && (!mostRecentTradingDate || bundle.tradingDate > mostRecentTradingDate)) {
      mostRecentTradingDate = bundle.tradingDate;
    }
  }

  // graceful degradation — Yahoo 응답 < 5건이면 stale.
  if (successCount < 5) {
    return { candidates: [], tradingDateRef: null, stale: true };
  }

  const ranked = rankCandidates(mode, metricsByCode).slice(0, maxCandidates);
  return {
    candidates: ranked,
    tradingDateRef: mostRecentTradingDate,
    stale: false,
  };
}

// 테스트 전용 — pure helper export
export const __testOnly = {
  CORE_SEED,
  toYahooSymbol,
  buildUniverse,
  computeMomentum,
  computeAvgTurnover,
  computeVolatility,
  computeDrawdownFromHigh,
  rankCandidates,
};
