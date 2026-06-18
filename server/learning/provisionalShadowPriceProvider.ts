// @responsibility provisionalShadowPriceProvider — ADR-0429 + ADR-0439 cache-first read-only price provider SSOT.
//
// ADR-0429 (initial):
// Wires Provisional Shadow performance reporting to read-only price sources.
// This module observes follow-through for ADR-0426/0427 learning samples only.
//
// ADR-0439 (PENDING_WIRING C19, 사용자 명시 ADR-0434 후속):
// `lookupCachedPrice` 4-tier wiring activation — Yahoo proxy snapshot cache
// (INTRADAY_CANDLE_CACHE / DAILY_CANDLE_CACHE / MARKET_DATA_CACHE / READ_ONLY_QUOTE).
// counterfactualShadowPriceProviderAdapter (ADR-0434) 의 헬퍼를 import 하여 drift 차단.
// cache-only 정책 보존 — maxExternalLookups default 0 그대로, *cache lookup* 만 활성화.
//
// It must not open LIVE trading, import KIS order paths, promote candidates,
// lower gate thresholds, or treat DATA_UNAVAILABLE as a loss.
// Cache-first price lookup is mandatory; external lookups must remain bounded.
//
// 핵심 불변식 (사용자 명시 절대 변경 금지):
//   1. read-only — provider 는 가격 *관측만*, 영속 변경 0
//   2. KIS 주문 함수 5종 import 0건 (정적 grep 가드)
//   3. 외부 API 폭주 차단 — default cache-only (maxExternalLookups=0)
//   4. data 부재 → DATA_UNAVAILABLE / PENDING (failed 아님)
//   5. entryPrice 부재 → INSUFFICIENT_DATA (NaN 출력 금지)
//   6. ADR-0426/0427 entries 만 대상 (ADR-0428 entry validation 정합)
//   7. counterfactualShadowPriceProviderAdapter 본체 0줄 변경 (헬퍼 import 만)
//   8. yahooProxyCacheRepo (offHoursSnapshotRepo) read-only — write 0건
//
// 가격 소스 우선순위 (사용자 §B + ADR-0439):
//   1. ENTRY_SNAPSHOT — entry.entryPrice / entry.metadata 의 lastPrice (caller 책임)
//   2. SCAN_SNAPSHOT — entry.metadata.scanQuote (옵셔널, 본 함수 내 처리)
//   3. INTRADAY_CANDLE_CACHE — Yahoo 1m/5m/15m/30m/1h × 1d (intraday horizons 우선)
//   4. DAILY_CANDLE_CACHE — Yahoo 5d/1mo/1y × 1d (daily horizons 우선)
//   5. MARKET_DATA_CACHE — Yahoo 다중 range/interval matrix (latest mode, 모든 horizon fallback)
//   6. READ_ONLY_QUOTE — entry.metadata.readOnlyQuote.lastPrice (마지막 fallback)
//   7. NONE → DATA_UNAVAILABLE / PENDING
//
// horizon → reader 라우팅 매트릭스 (ADR-0439 §C, ADR-0621 measurement eligibility 갱신):
//   - T_PLUS_30M / T_PLUS_1H → INTRADAY 전용 (INTRADAY_CANDLE_CACHE 만 OBSERVED 자격).
//       intraday miss 시 coarser fallback(MARKET_DATA/READ_ONLY_QUOTE/SCAN/ENTRY) 금지 → null →
//       DATA_UNAVAILABLE. coarser source 는 same-day-close 단일점이라 30m/1h 를 3중 카운트하는
//       follow-through 부풀림이므로 ADR-0621 가 OBSERVED 자격 박탈.
//   - SAME_DAY_CLOSE → INTRADAY → MARKET_DATA → READ_ONLY_QUOTE (종가 근사 coarser fallback 정당, 무변경).
//   - NEXT_OPEN / T_PLUS_1D_CLOSE / T_PLUS_3D_CLOSE → DAILY → MARKET_DATA → READ_ONLY_QUOTE (무변경)

import {
  isKrxTradingDay,
  toKstDateKey,
} from '../calendar/krxTradingCalendar.js';
import type {
  ProvisionalShadowHorizon,
  ProvisionalShadowPriceProvider,
  ProvisionalShadowPointStatus,
} from './provisionalShadowPerformanceReport.js';
import type { ProvisionalShadowLedgerEntry } from '../persistence/provisionalShadowLedger.js';
// ADR-0439 — counterfactual adapter 의 Yahoo proxy cache reader 헬퍼 reuse (drift 차단).
// 본 import 는 *헬퍼 함수만* 사용 — counterfactualShadowPriceProviderAdapter 본체 동작 0 변경.
import {
  readYahooSnapshotPoint,
  type ParsedYahooPoint,
} from './counterfactualShadowPriceProviderAdapter.js';

/** 가격 소스 분류 (사용자 §C 정합, 절대 변경 금지). */
export type ProvisionalShadowPriceSource =
  | 'ENTRY_SNAPSHOT'
  | 'SCAN_SNAPSHOT'
  | 'INTRADAY_CANDLE_CACHE'
  | 'DAILY_CANDLE_CACHE'
  | 'MARKET_DATA_CACHE'
  | 'READ_ONLY_QUOTE'
  | 'NONE';

export interface ProvisionalShadowObservedPrice {
  symbol: string;
  horizon: ProvisionalShadowHorizon;
  price?: number;
  observedAtKst?: string;
  source: ProvisionalShadowPriceSource;
  status: ProvisionalShadowPointStatus;
  reason?: string;
}

/**
 * Horizon 별 entry 후 경과 시간 (밀리초). ADR-0428 HORIZON_OFFSET_MS 와 정합 — drift 차단.
 */
export const PROVISIONAL_HORIZON_OFFSET_MS: Record<ProvisionalShadowHorizon, number> = Object.freeze({
  T_PLUS_30M: 30 * 60 * 1_000,
  T_PLUS_1H: 60 * 60 * 1_000,
  SAME_DAY_CLOSE: 8 * 60 * 60 * 1_000,
  NEXT_OPEN: 24 * 60 * 60 * 1_000,
  T_PLUS_1D_CLOSE: 32 * 60 * 60 * 1_000,
  T_PLUS_3D_CLOSE: 80 * 60 * 60 * 1_000,
});

/** ENV `PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED=true` 시 항상 NONE 반환. */
export function isProvisionalPriceProviderDisabled(): boolean {
  return process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED === 'true';
}

/**
 * 외부 read-only quote 호출 한도 (ENV `PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS`,
 * default 0 — cache-only 모드).
 *
 * 사용자 §H 정합 — 외부 API 폭주 차단. ENV 명시 양수 + 본 PR 미구현 (후속 PR scope) 이라
 * 현재는 항상 0 — 외부 호출 0건.
 */
export function getMaxExternalLookups(): number {
  const raw = process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS;
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

/**
 * Horizon 도달 검증 — entry 후 경과 시간 ≥ horizon offset 일 때만 OBSERVED 시도 가능.
 */
export function isHorizonReached(
  entryAtKst: string,
  horizon: ProvisionalShadowHorizon,
  nowMs: number,
): boolean {
  const entryMs = Date.parse(entryAtKst);
  if (!Number.isFinite(entryMs)) return false;
  return nowMs - entryMs >= PROVISIONAL_HORIZON_OFFSET_MS[horizon];
}

/**
 * Horizon 별 target 시각 (KST ISO) — 사용자 §D 결정 트리 정합.
 *
 * T+30m / T+1h: entry + offset 단순 계산.
 * SAME_DAY_CLOSE: KST 15:30 (장 마감) — entry 거래일 종가.
 * NEXT_OPEN: 다음 거래일 KST 09:00.
 * T+1d / T+3d: 다음/3거래일 후 KST 15:30.
 */
export function resolveHorizonTargetTimeKst(
  entryAtKst: string,
  horizon: ProvisionalShadowHorizon,
): string | null {
  const entryMs = Date.parse(entryAtKst);
  if (!Number.isFinite(entryMs)) return null;

  if (horizon === 'T_PLUS_30M' || horizon === 'T_PLUS_1H') {
    const targetMs = entryMs + PROVISIONAL_HORIZON_OFFSET_MS[horizon];
    return new Date(targetMs).toISOString();
  }

  // 거래일 단위 — KST date key 추출
  const entryKstKey = toKstDateKey(new Date(entryMs));
  if (!entryKstKey) return null;

  if (horizon === 'SAME_DAY_CLOSE') {
    // entry 거래일의 KST 15:30 (장 마감)
    return `${entryKstKey}T15:30:00+09:00`;
  }

  // 다음 / 3 거래일 후 — KRX 휴장일/주말 자동 skip
  const tradingDayOffset = horizon === 'NEXT_OPEN' || horizon === 'T_PLUS_1D_CLOSE' ? 1 : 3;
  const targetTradingDay = findNthTradingDayAfter(entryKstKey, tradingDayOffset);
  if (!targetTradingDay) return null;

  if (horizon === 'NEXT_OPEN') {
    return `${targetTradingDay}T09:00:00+09:00`;
  }
  // T+1d / T+3d close
  return `${targetTradingDay}T15:30:00+09:00`;
}

/**
 * KRX 휴장일/주말 skip — `dateKey` 후 N 거래일 후의 date key 반환.
 *
 * `previousKrxTradingDay` 의 forward 버전. KRX_HOLIDAYS_BY_YEAR 재사용 (ADR-0411
 * `isKrxTradingDay` 위임). 14일 walk limit (장기 휴장 안전 fallback).
 */
export function findNthTradingDayAfter(dateKey: string, n: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || n <= 0) return null;
  let cursor = dateKey;
  let count = 0;
  for (let i = 0; i < n + 14; i += 1) {
    cursor = addDateKeyDays(cursor, 1);
    if (isKrxTradingDay(cursor)) {
      count += 1;
      if (count >= n) return cursor;
    }
  }
  return null;
}

/** date key 산술 — `krxTradingCalendar` 의 private addDays 재구현 (export 없음). */
function addDateKeyDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * entryPrice 확보 우선순위 SSOT (사용자 §E 정합).
 *
 * 1. entry.entryPrice (literal type 인 경우 ProvisionalShadowLedgerEntry schema 외)
 * 2. entry.metadata 의 가격 hint (현재 schema 상 부재 — 후속 PR 확장 대상)
 *
 * 부재 시 undefined 반환 — 호출자가 INSUFFICIENT_DATA 처리.
 */
export function resolveEntryPrice(entry: ProvisionalShadowLedgerEntry): number | undefined {
  const candidate = (entry as ProvisionalShadowLedgerEntry & { entryPrice?: number }).entryPrice;
  if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) return candidate;
  // metadata 의 가격 hint — schema 확장 예약
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metaPrice = (entry.metadata as any)?.entryPriceHint;
  if (typeof metaPrice === 'number' && Number.isFinite(metaPrice) && metaPrice > 0) return metaPrice;
  return undefined;
}

/**
 * ENV `PROVISIONAL_CACHE_LOOKUP_DISABLED=true` (ADR-0439, default OFF) — cache lookup 비활성화.
 * ADR-0157 정확 비교 의무. 회귀 발견 시 1줄 즉시 lookupCachedPrice null 반환 동작 복원.
 */
export function isProvisionalCacheLookupDisabled(): boolean {
  return process.env.PROVISIONAL_CACHE_LOOKUP_DISABLED === 'true';
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * SCAN_SNAPSHOT lookup — entry.metadata.scanQuote 또는 entry.scanSnapshot 옵셔널 활용.
 *
 * ADR-0439 §B 우선순위 #2 — entry creation 시점 캡처된 quote 가 있으면 horizon 미도달 직전
 * 가격으로 활용. 실제로는 entry creation 시점 가격이라 horizon 별 가격이 아니므로 본 PR 은
 * 보수적 — `entry.metadata.scanQuote.lastPrice` 가 있을 때만 SCAN_SNAPSHOT 부착.
 *
 * 부재 시 null — 다음 우선순위 (INTRADAY/DAILY/MARKET_DATA/READ_ONLY_QUOTE) 진행.
 */
function lookupScanSnapshot(
  entry: ProvisionalShadowLedgerEntry,
): { price: number; observedAtKst: string; source: ProvisionalShadowPriceSource } | null {
  const meta = (entry as ProvisionalShadowLedgerEntry & {
    metadata?: { scanQuote?: { lastPrice?: number; observedAtKst?: string } };
  }).metadata;
  const quote = meta?.scanQuote;
  if (!isPositiveFinite(quote?.lastPrice)) return null;
  return {
    price: quote.lastPrice,
    observedAtKst: quote.observedAtKst ?? entry.createdAtKst,
    source: 'SCAN_SNAPSHOT',
  };
}

/**
 * INTRADAY_CANDLE_CACHE reader — Yahoo proxy snapshot 1d range × 1m/5m/15m/30m/1h interval 순회.
 * counterfactualShadowPriceProviderAdapter 패턴 차용.
 *
 * targetAtKst 시점 at-or-after closest point 반환. cache 부재 시 null.
 */
function provisionalIntradayReader(
  symbol: string,
  targetAtKst: string,
): { price: number; observedAtKst: string; source: ProvisionalShadowPriceSource } | null {
  for (const interval of ['1m', '5m', '15m', '30m', '1h']) {
    const point: ParsedYahooPoint | null = readYahooSnapshotPoint(
      symbol,
      targetAtKst,
      '1d',
      interval,
      'closest',
    );
    if (point && isPositiveFinite(point.price)) {
      return {
        price: point.price,
        observedAtKst: point.observedAtKst,
        source: 'INTRADAY_CANDLE_CACHE',
      };
    }
  }
  return null;
}

/**
 * DAILY_CANDLE_CACHE reader — Yahoo proxy snapshot 5d/1mo/1y range × 1d interval 순회.
 *
 * NEXT_OPEN/T_PLUS_1D_CLOSE/T_PLUS_3D_CLOSE 같은 daily horizon 의 우선 source.
 */
function provisionalDailyReader(
  symbol: string,
  targetAtKst: string,
): { price: number; observedAtKst: string; source: ProvisionalShadowPriceSource } | null {
  for (const range of ['5d', '1mo', '1y']) {
    const point: ParsedYahooPoint | null = readYahooSnapshotPoint(
      symbol,
      targetAtKst,
      range,
      '1d',
      'closest',
    );
    if (point && isPositiveFinite(point.price)) {
      return {
        price: point.price,
        observedAtKst: point.observedAtKst,
        source: 'DAILY_CANDLE_CACHE',
      };
    }
  }
  return null;
}

/**
 * MARKET_DATA_CACHE reader — Yahoo 다중 range/interval matrix, latest mode.
 *
 * INTRADAY/DAILY 모두 miss 한 경우의 마지막 cache fallback. 정확 horizon target 매칭이
 * 아닌 *최신 cached point* 반환 — 정확도 ↓ 이지만 INSUFFICIENT_DATA 보다는 가용.
 */
function provisionalMarketDataReader(
  symbol: string,
  targetAtKst: string,
): { price: number; observedAtKst: string; source: ProvisionalShadowPriceSource } | null {
  for (const [range, interval] of [
    ['1d', '1m'],
    ['1d', '5m'],
    ['5d', '1d'],
    ['1mo', '1d'],
    ['1y', '1d'],
  ] as const) {
    const point: ParsedYahooPoint | null = readYahooSnapshotPoint(
      symbol,
      targetAtKst,
      range,
      interval,
      'latest',
    );
    if (point && isPositiveFinite(point.price)) {
      return {
        price: point.price,
        observedAtKst: point.observedAtKst,
        source: 'MARKET_DATA_CACHE',
      };
    }
  }
  return null;
}

/**
 * READ_ONLY_QUOTE reader — entry.metadata.readOnlyQuote.lastPrice 활용.
 *
 * 모든 cache miss 후 마지막 fallback. lastPrice ≤0 또는 NaN 거부.
 */
function provisionalReadOnlyQuoteReader(
  entry: ProvisionalShadowLedgerEntry,
): { price: number; observedAtKst: string; source: ProvisionalShadowPriceSource } | null {
  const meta = (entry as ProvisionalShadowLedgerEntry & {
    metadata?: { readOnlyQuote?: { lastPrice?: number; observedAtKst?: string } };
  }).metadata;
  const quote = meta?.readOnlyQuote;
  if (!isPositiveFinite(quote?.lastPrice)) return null;
  return {
    price: quote.lastPrice,
    observedAtKst: quote.observedAtKst ?? entry.createdAtKst,
    source: 'READ_ONLY_QUOTE',
  };
}

function isIntradayHorizon(horizon: ProvisionalShadowHorizon): boolean {
  return (
    horizon === 'T_PLUS_30M' ||
    horizon === 'T_PLUS_1H' ||
    horizon === 'SAME_DAY_CLOSE'
  );
}

/**
 * ADR-0621 measurement eligibility 술어 — `isIntradayHorizon` 과 별개 (SRP 분리).
 *
 * `isIntradayHorizon` 은 reader 라우팅 책임(INTRADAY reader 우선 시도)을 가지나, 본 술어는
 * "이 horizon 은 INTRADAY_CANDLE_CACHE 가 아니면 OBSERVED 부적격"이라는 측정 자격 책임을 가진다.
 *
 * T_PLUS_30M / T_PLUS_1H 만 true — coarser fallback(MARKET_DATA/READ_ONLY_QUOTE/SCAN/ENTRY)은
 * same-day-close 단일점이라 follow-through 부풀림을 유발하므로 OBSERVED 자격 박탈.
 * SAME_DAY_CLOSE 는 의도적으로 false — 종가 근사 coarser fallback 정당(현행 유지).
 */
function requiresIntradayCandleSource(horizon: ProvisionalShadowHorizon): boolean {
  return horizon === 'T_PLUS_30M' || horizon === 'T_PLUS_1H';
}

/**
 * Cache-only price lookup SSOT (ADR-0439).
 *
 * 결정 트리 (사용자 §C, 절대 변경 금지):
 *   0. ENV `PROVISIONAL_CACHE_LOOKUP_DISABLED=true` → null (legacy ADR-0429 동작 복원)
 *   1. SCAN_SNAPSHOT — entry.metadata.scanQuote.lastPrice 가용 시 우선
 *   2. horizon target time 산출 실패 → null
 *   3. INTRADAY (intraday horizons 우선) → DAILY (daily horizons 우선) → MARKET_DATA → READ_ONLY_QUOTE 순회
 *   4. 모두 miss → null (caller 가 DATA_UNAVAILABLE 처리)
 *
 * 외부 의존성 0 — getSnapshot (offHoursSnapshotRepo) read-only, fetch/axios 0건.
 * KIS 주문 함수 import 0건 (정적 grep 가드).
 *
 * ENTRY_SNAPSHOT 처리는 caller (createProvisionalShadowPriceProvider) 측 책임 — 본 함수는
 * cache lookup 만 담당. SCAN_SNAPSHOT 은 entry.metadata.scanQuote 가 있으면 활용.
 */
export function lookupCachedPrice(
  entry: ProvisionalShadowLedgerEntry,
  horizon: ProvisionalShadowHorizon,
): { price: number; observedAtKst: string; source: ProvisionalShadowPriceSource } | null {
  if (isProvisionalCacheLookupDisabled()) return null;

  // 1. SCAN_SNAPSHOT — entry creation 시점 캡처 quote 우선.
  //    ADR-0621: T+30m/T+1h 는 entry-time 단일점(SCAN_SNAPSHOT)으로 OBSERVED 되면 follow-through
  //    부풀림이므로 INTRADAY_CANDLE_CACHE 외 source 자격 박탈 — scan 선반환을 게이트한다.
  if (!requiresIntradayCandleSource(horizon)) {
    const scan = lookupScanSnapshot(entry);
    if (scan) return scan;
  }

  // 2. horizon target time
  const targetAtKst = resolveHorizonTargetTimeKst(entry.createdAtKst, horizon);
  if (!targetAtKst) return null;

  const symbol = entry.symbol;

  // 3. horizon 별 reader 순회
  if (isIntradayHorizon(horizon)) {
    const intraday = provisionalIntradayReader(symbol, targetAtKst);
    if (intraday) return intraday; // source = INTRADAY_CANDLE_CACHE (정당)
    // ADR-0621: T+30m/T+1h 는 intraday miss 시 coarser fallback 금지 → 즉시 short-circuit.
    //   MARKET_DATA/READ_ONLY_QUOTE 는 same-day-close 단일점이라 30m/1h 를 3중 카운트하는
    //   부풀림 — null 반환으로 caller(performance report)가 DATA_UNAVAILABLE 처리.
    //   SAME_DAY_CLOSE 는 게이트 미적용 → 종가 근사 coarser fallback 계속(현행 유지).
    if (requiresIntradayCandleSource(horizon)) return null;
  } else {
    const daily = provisionalDailyReader(symbol, targetAtKst);
    if (daily) return daily;
  }

  // 4. MARKET_DATA fallback (모든 horizon)
  const marketData = provisionalMarketDataReader(symbol, targetAtKst);
  if (marketData) return marketData;

  // 5. READ_ONLY_QUOTE 마지막 fallback
  const quote = provisionalReadOnlyQuoteReader(entry);
  if (quote) return quote;

  return null;
}

export interface CreateProvisionalShadowPriceProviderInput {
  /** entries 가 ledger 와 일치하지 않을 수 있는 mock/test 시나리오 — 직접 주입 가능. */
  entries?: ProvisionalShadowLedgerEntry[];
  /** Override 한도 — 본 PR 미구현, 후속 PR scope. */
  maxExternalLookups?: number;
}

/**
 * Cache-first read-only priceProvider 팩토리 (사용자 §C 정합).
 *
 * ADR-0428 ProvisionalShadowPriceProvider 시그니처 (단일 함수) 호환.
 *
 * 결정 트리:
 *   1. ENV DISABLED → status=DATA_UNAVAILABLE source=NONE
 *   2. entry 미발견 → DATA_UNAVAILABLE
 *   3. entryPrice 부재 → DATA_UNAVAILABLE (caller INSUFFICIENT_DATA 처리)
 *   4. horizon 미도달 → PENDING (호출자가 ADR-0428 buildReport 단에서도 검증)
 *   5. cached price 가용 → OBSERVED
 *   6. 외부 lookup 한도 0 (default) → DATA_UNAVAILABLE
 *   7. 외부 lookup 한도 > 0 → 후속 PR scope (현재 항상 0)
 *
 * 외부 의존성 0 — KIS 주문 함수 import 0건, fetch/axios 호출 0건.
 */
export function createProvisionalShadowPriceProvider(
  input: CreateProvisionalShadowPriceProviderInput = {},
): ProvisionalShadowPriceProvider {
  const entriesIndex = new Map<string, ProvisionalShadowLedgerEntry>();
  for (const e of input.entries ?? []) {
    // entry 등록 — symbol 만으로는 multi-scan 충돌이라 createdAtKst+symbol 복합
    const key = `${e.symbol}:${e.createdAtKst}`;
    entriesIndex.set(key, e);
  }

  return async (symbol, horizon, entryAtKst) => {
    if (isProvisionalPriceProviderDisabled()) {
      return {
        available: false,
        reason: 'PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED',
        status: 'DATA_UNAVAILABLE',
      };
    }

    const key = `${symbol}:${entryAtKst}`;
    const entry = entriesIndex.get(key);
    if (!entry) {
      return {
        available: false,
        reason: 'entry not found in provider index',
        status: 'DATA_UNAVAILABLE',
      };
    }

    // entryPrice 부재 — caller (buildReport) 가 INSUFFICIENT_DATA 분기로 처리
    const entryPrice = resolveEntryPrice(entry);
    if (entryPrice === undefined) {
      return {
        available: false,
        reason: 'entryPrice not available — INSUFFICIENT_DATA',
        status: 'DATA_UNAVAILABLE',
      };
    }

    // cached price lookup (현재 항상 null — 후속 PR 에서 candle/cache wiring)
    const cached = lookupCachedPrice(entry, horizon);
    if (cached !== null) {
      return {
        available: true,
        price: cached.price,
        observedAtKst: cached.observedAtKst,
      };
    }

    // 외부 lookup 한도 — default 0 (cache-only). 본 PR 은 항상 0.
    const maxExternal = input.maxExternalLookups ?? getMaxExternalLookups();
    if (maxExternal === 0) {
      return {
        available: false,
        reason: 'cache miss — external lookup disabled (cache-only mode)',
        status: 'DATA_UNAVAILABLE',
      };
    }

    // 외부 lookup 활성 — 후속 PR scope (현재 도달 0)
    return {
      available: false,
      reason: 'external lookup not implemented — ADR-0429 후속 PR scope',
      status: 'DATA_UNAVAILABLE',
    };
  };
}

/**
 * Object 형태 alias — 사용자 §C 권장 객체 시그니처. ADR-0428 함수 시그니처와 동등.
 */
export interface ProvisionalShadowPriceProviderObject {
  getObservedPrice(input: {
    symbol: string;
    entryAtKst: string;
    entryPrice?: number;
    horizon: ProvisionalShadowHorizon;
    nowKst?: string;
  }): Promise<ProvisionalShadowObservedPrice>;
}

/**
 * 사용자 §C 권장 객체 시그니처 → ADR-0428 함수 시그니처 어댑터.
 *
 * 호출자가 객체 인터페이스를 선호할 경우 본 함수 사용.
 */
export function wrapAsProviderObject(
  provider: ProvisionalShadowPriceProvider,
): ProvisionalShadowPriceProviderObject {
  return {
    async getObservedPrice(input) {
      const result = await provider(input.symbol, input.horizon, input.entryAtKst);
      if (result.available) {
        return {
          symbol: input.symbol,
          horizon: input.horizon,
          price: result.price,
          observedAtKst: result.observedAtKst,
          source: 'ENTRY_SNAPSHOT',
          status: 'OBSERVED',
        };
      }
      return {
        symbol: input.symbol,
        horizon: input.horizon,
        source: 'NONE',
        status: result.status ?? 'DATA_UNAVAILABLE',
        reason: result.reason,
      };
    },
  };
}
