// @responsibility provisionalShadowPriceProvider — ADR-0429 cache-first read-only price provider SSOT.
//
// ADR-0429:
// Wires Provisional Shadow performance reporting to read-only price sources.
// This module observes follow-through for ADR-0426/0427 learning samples only.
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
//
// 가격 소스 우선순위 (사용자 §B):
//   1. ENTRY_SNAPSHOT — entry.entryPrice / entry.metadata 의 lastPrice
//   2. SCAN_SNAPSHOT — entry.metadata.scanQuote (옵셔널)
//   3. INTRADAY_CANDLE_CACHE — 후속 PR scope (현재 NONE)
//   4. DAILY_CANDLE_CACHE — 후속 PR scope (현재 NONE)
//   5. MARKET_DATA_CACHE — 후속 PR scope (현재 NONE)
//   6. READ_ONLY_QUOTE — ENV 명시 활성 + maxExternalLookups 제한 (default 0)
//   7. NONE → DATA_UNAVAILABLE / PENDING

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
 * Entry snapshot 가격 lookup — 본 PR 의 *유일 가용 source*.
 *
 * 후속 PR 에서 candle/cache 추가 시 본 함수가 source 선택 우선순위 SSOT.
 *
 * 현재 동작:
 *   - horizon === SAME_DAY_CLOSE 일 때 entry.metadata.entryPriceHint 또는 entryPrice 가
 *     intraday 가격이라 *근사값* 만 가능 — 본 PR 은 항상 NONE 반환 (후속 PR scope).
 *   - 다른 horizon 도 entry 시점 가격 = horizon 시점 가격 가정 부적절 → NONE.
 *
 * 즉 본 PR 은 *시그니처 SSOT + entry validation* 만 활성화하고 실제 가격 lookup 은
 * 후속 PR 의 candle/cache wiring 후 활성화. 운영 환경 영향 — 모든 horizon DATA_UNAVAILABLE
 * 또는 PENDING (외부 호출 0).
 */
export function lookupCachedPrice(
  _entry: ProvisionalShadowLedgerEntry,
  _horizon: ProvisionalShadowHorizon,
): { price: number; observedAtKst: string; source: ProvisionalShadowPriceSource } | null {
  // 후속 PR scope — candle/quote cache wiring 후 활성화
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
