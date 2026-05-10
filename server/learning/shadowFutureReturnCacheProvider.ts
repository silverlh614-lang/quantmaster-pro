// @responsibility PATCH-D cache-backed price provider for ShadowLearningOnlySignal future returns.
/**
 * Cache-backed read-only provider for shadow future-return resolver.
 *
 * It reuses existing Yahoo snapshot cache helpers and KRX calendar logic.
 * This module does not fetch external data and does not import KIS/order paths.
 */

import {
  loadResolveAndSaveShadowFutureReturns,
  type ShadowFuturePriceProvider,
  type ShadowFutureReturnHorizon,
} from './shadowFutureReturnResolver.js';
import { isKrxTradingDay, toKstDateKey } from '../calendar/krxTradingCalendar.js';
import { readYahooSnapshotPoint } from './counterfactualShadowPriceProviderAdapter.js';

const HORIZON_TRADING_DAY_OFFSET: Record<ShadowFutureReturnHorizon, number> = {
  '1d': 1,
  '3d': 3,
  '5d': 5,
  '20d': 20,
};

function dateKeyToUtcNoon(dateKey: string): Date {
  return new Date(`${dateKey}T03:00:00.000Z`);
}

function addDateKeyDays(dateKey: string, days: number): string {
  const d = dateKeyToUtcNoon(dateKey);
  d.setUTCDate(d.getUTCDate() + days);
  return toKstDateKey(d);
}

export function findNthKrxTradingDayAfter(dateKey: string, n: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || n <= 0) return null;
  let cursor = dateKey;
  let count = 0;
  const maxWalk = n * 3 + 20;
  for (let i = 0; i < maxWalk; i += 1) {
    cursor = addDateKeyDays(cursor, 1);
    if (isKrxTradingDay(cursor)) {
      count += 1;
      if (count >= n) return cursor;
    }
  }
  return null;
}

export function resolveShadowFutureReturnTargetCloseKst(
  signalDate: string,
  horizon: ShadowFutureReturnHorizon,
): string | null {
  const signalDateKey = signalDate.slice(0, 10);
  const offset = HORIZON_TRADING_DAY_OFFSET[horizon];
  const targetDateKey = findNthKrxTradingDayAfter(signalDateKey, offset);
  if (!targetDateKey) return null;
  return `${targetDateKey}T15:30:00+09:00`;
}

function rangeCandidatesForHorizon(horizon: ShadowFutureReturnHorizon): string[] {
  if (horizon === '20d') return ['3mo', '6mo', '1y'];
  if (horizon === '5d') return ['1mo', '3mo', '1y'];
  return ['5d', '1mo', '3mo', '1y'];
}

export function createShadowFutureReturnCachePriceProvider(): ShadowFuturePriceProvider {
  return ({ symbol, signalDate, horizon }) => {
    const targetAtKst = resolveShadowFutureReturnTargetCloseKst(signalDate, horizon);
    if (!targetAtKst) return null;
    for (const range of rangeCandidatesForHorizon(horizon)) {
      const point = readYahooSnapshotPoint(symbol, targetAtKst, range, '1d', 'closest');
      if (point && Number.isFinite(point.price) && point.price > 0) {
        return {
          price: point.price,
          observedAt: point.observedAtKst,
        };
      }
    }
    return null;
  };
}

export async function loadResolveAndSaveShadowFutureReturnsFromCache() {
  return loadResolveAndSaveShadowFutureReturns(createShadowFutureReturnCachePriceProvider());
}
