// @responsibility Position Card payload validator + builder SSOT — source 검증 + dedupe (ADR-0504).
/**
 * positionCardValidator.ts — Position Card payload validator + builder SSOT (ADR-0504).
 *
 * 3 export:
 *   validatePositionCardPayload   — source 정합 + count mismatch + forbidden 8 source 차단
 *   buildShadowPositionCardPayload — getOpenPositions 결과 → SHADOW payload + dedupe
 *   buildRealPositionCardPayload   — fetchKisHoldings 결과 → REAL payload (Phase 2 wiring 대상)
 *
 * 핵심 invariants:
 *   - mode='SHADOW' → 모든 positions[i].source === 'SHADOW_POSITION_LEDGER' (강제)
 *   - mode='REAL'   → 모든 positions[i].source === 'BROKER_BALANCE' (강제)
 *   - forbidden 8 source 영구 차단 (FORBIDDEN_POSITION_SOURCES SSOT)
 *   - dedupe SSOT — `${mode}:${source}:${stockCode}:${entryDate ?? 'NO_ENTRY'}`
 *   - 동일 dedupeKey 시 lot aggregate (totalQty 합산 + 가중평균 entry + earliest entryDate)
 */
import type { OpenPositionEntry } from '../persistence/shadowPositionLedger.js';
import type { KisHolding } from '../clients/kisClient/types.js';
import {
  FORBIDDEN_POSITION_SOURCES,
  type PositionCardCardType,
  type PositionCardPayload,
  type PositionCardPosition,
  type PositionCardValidationResult,
} from './positionCardTypes.js';
import { isPositionCardSourceValidationEnabled } from './positionCardEnvHelpers.js';

/**
 * dedupe SSOT — 동일 mode+source+stockCode+entryDate 시 lot aggregate.
 * entryDate 부재 시 'NO_ENTRY' literal.
 */
export function buildDedupeKey(opts: {
  mode: PositionCardPayload['mode'];
  source: PositionCardPosition['source'];
  stockCode: string;
  entryDate?: string | null;
}): string {
  return `${opts.mode}:${opts.source}:${opts.stockCode}:${opts.entryDate ?? 'NO_ENTRY'}`;
}

/**
 * Payload validator — 5 분기 결정 트리.
 *
 * 1. ENV `TELEGRAM_POSITION_CARD_VALIDATE_SOURCE=false` → skip (회귀 격리)
 * 2. mode='SHADOW' + 모든 positions[i].source === 'SHADOW_POSITION_LEDGER' 의무
 * 3. mode='REAL' + 모든 positions[i].source === 'BROKER_BALANCE' 의무
 * 4. positions.length === 0 + summary.count > 0 → POSITION_COUNT_MISMATCH
 * 5. forbidden 8 source 명시 차단 (런타임 cast 우회 검출)
 */
export function validatePositionCardPayload(
  payload: PositionCardPayload,
): PositionCardValidationResult {
  // 1. ENV 우회
  if (!isPositionCardSourceValidationEnabled()) {
    return { ok: true };
  }

  // 5. forbidden source 우선 차단 (cast 우회 검출 — TypeScript 타입 우회 시도 즉시 차단)
  for (let i = 0; i < payload.positions.length; i++) {
    const sourceStr = String(payload.positions[i].source);
    if (FORBIDDEN_POSITION_SOURCES.includes(sourceStr)) {
      return {
        ok: false,
        error: 'INVALID_POSITION_SOURCE_BLOCKED',
        details: `positions[${i}].source='${sourceStr}' is forbidden (must be 'BROKER_BALANCE' or 'SHADOW_POSITION_LEDGER')`,
      };
    }
  }

  // 2. SHADOW mode → SHADOW_POSITION_LEDGER 만 허용
  if (payload.mode === 'SHADOW') {
    const idx = payload.positions.findIndex((p) => p.source !== 'SHADOW_POSITION_LEDGER');
    if (idx >= 0) {
      return {
        ok: false,
        error: 'INVALID_SHADOW_POSITION_SOURCE',
        details: `positions[${idx}].source='${String(payload.positions[idx].source)}' (mode='SHADOW' requires 'SHADOW_POSITION_LEDGER')`,
      };
    }
  }

  // 3. REAL mode → BROKER_BALANCE 만 허용
  if (payload.mode === 'REAL') {
    const idx = payload.positions.findIndex((p) => p.source !== 'BROKER_BALANCE');
    if (idx >= 0) {
      return {
        ok: false,
        error: 'INVALID_REAL_POSITION_SOURCE',
        details: `positions[${idx}].source='${String(payload.positions[idx].source)}' (mode='REAL' requires 'BROKER_BALANCE')`,
      };
    }
  }

  // 4. count mismatch — positions 비어있는데 summary.count > 0 (drift 검출)
  if (payload.positions.length === 0 && payload.summary.count > 0) {
    return {
      ok: false,
      error: 'POSITION_COUNT_MISMATCH',
      details: `positions.length=0 but summary.count=${payload.summary.count}`,
    };
  }

  return { ok: true };
}

/**
 * SHADOW Payload builder — getOpenPositions 결과 → PositionCardPayload.
 * 동일 dedupeKey 시 lot aggregate (totalQty 합산 + 가중평균 entry + earliest entryDate).
 */
export async function buildShadowPositionCardPayload(opts: {
  cardType: PositionCardCardType;
  positions: OpenPositionEntry[];
  enrich?: (entry: OpenPositionEntry) => Promise<Partial<PositionCardPosition>>;
}): Promise<PositionCardPayload> {
  // dedupeKey 별 group 합성 (lot aggregate)
  const groups = new Map<string, { entries: OpenPositionEntry[]; enriched: Array<Partial<PositionCardPosition>> }>();

  for (const entry of opts.positions) {
    const key = buildDedupeKey({
      mode: 'SHADOW',
      source: 'SHADOW_POSITION_LEDGER',
      stockCode: entry.trade.stockCode,
      entryDate: entry.trade.signalTime,
    });
    if (!groups.has(key)) {
      groups.set(key, { entries: [], enriched: [] });
    }
    const enriched = opts.enrich ? await opts.enrich(entry).catch(() => ({})) : {};
    const g = groups.get(key);
    if (g) {
      g.entries.push(entry);
      g.enriched.push(enriched);
    }
  }

  const positions: PositionCardPosition[] = [];
  for (const [, g] of groups) {
    if (g.entries.length === 0) continue;
    const first = g.entries[0];

    // lot aggregate: 가중평균 entry + earliest entryDate + totalQty 합산
    let totalQty = 0;
    let weightedEntrySum = 0;
    let earliestEntry: string | null = null;
    let currentPriceAgg: number | null = null;
    let pnlPctAgg: number | null = null;

    for (let i = 0; i < g.entries.length; i++) {
      const e = g.entries[i];
      const enr = g.enriched[i] ?? {};
      const qty = e.qty;
      totalQty += qty;
      const entryPrice =
        typeof enr.avgEntryPrice === 'number' && enr.avgEntryPrice > 0
          ? enr.avgEntryPrice
          : e.trade.shadowEntryPrice;
      if (entryPrice > 0) {
        weightedEntrySum += entryPrice * qty;
      }
      const eDate = enr.entryDate ?? e.trade.signalTime;
      if (eDate && (earliestEntry === null || eDate < earliestEntry)) {
        earliestEntry = eDate;
      }
      // currentPrice / pnlPct 는 첫 entry 기준 (모두 동일 stockCode 라 동일)
      if (currentPriceAgg === null && enr.currentPrice !== undefined) {
        currentPriceAgg = enr.currentPrice ?? null;
      }
      if (pnlPctAgg === null && enr.pnlPct !== undefined) {
        pnlPctAgg = enr.pnlPct ?? null;
      }
    }

    const avgEntryPrice = totalQty > 0 ? weightedEntrySum / totalQty : null;

    positions.push({
      stockCode: first.trade.stockCode,
      stockName: first.trade.stockName,
      source: 'SHADOW_POSITION_LEDGER',
      qty: totalQty,
      avgEntryPrice,
      currentPrice: currentPriceAgg,
      pnlPct: pnlPctAgg,
      entryDate: earliestEntry,
      lotId: g.entries.length > 1 ? `agg:${g.entries.length}` : null,
    });
  }

  return {
    cardType: opts.cardType,
    mode: 'SHADOW',
    positions,
    summary: {
      count: positions.length,
      aggregateCount: opts.positions.length,
    },
    executionImpact: 'NONE',
  };
}

/**
 * REAL Payload builder — fetchKisHoldings 결과 → PositionCardPayload.
 * Phase 2 LIVE wiring 대상 (positionsRouter REAL mode).
 */
export function buildRealPositionCardPayload(opts: {
  cardType: PositionCardCardType;
  holdings: KisHolding[];
}): PositionCardPayload {
  const positions: PositionCardPosition[] = opts.holdings
    .filter((h) => h.hldgQty > 0)
    .map((h) => ({
      stockCode: h.pdno,
      stockName: h.prdtName,
      source: 'BROKER_BALANCE' as const,
      qty: h.hldgQty,
      avgEntryPrice: h.pchsAvgPric > 0 ? h.pchsAvgPric : null,
      currentPrice: h.prpr,
      pnlPct: null, // KIS 가 evluPflsAmt 만 제공, % 는 호출자 산출
      entryDate: null, // KIS 잔고에 진입일 정보 없음
      lotId: null,
    }));

  return {
    cardType: opts.cardType,
    mode: 'REAL',
    positions,
    summary: {
      count: positions.length,
      aggregateCount: opts.holdings.length,
    },
    executionImpact: 'LIVE',
  };
}
