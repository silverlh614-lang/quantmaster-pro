// @responsibility Shadow futureReturn mature-miss diagnostics.

import { getSnapshot } from '../persistence/offHoursSnapshotRepo.js';
import { loadShadowLearningOnlySignals } from '../persistence/shadowLearningOnlySignalRepo.js';
import { parseYahooChartBody, readYahooSnapshotPoint, normalizeYahooSymbol } from './counterfactualShadowPriceProviderAdapter.js';
import type { ShadowLearningOnlySignal } from '../trading/shadowLearningOnlyScan.js';
import {
  isShadowFutureReturnTargetMature,
  resolveShadowFutureReturnTargetCloseKst,
  symbolCandidatesForShadowFutureReturnCache,
} from './shadowFutureReturnCacheProvider.js';
import type { ShadowFutureReturnHorizon } from './shadowFutureReturnResolver.js';

const HORIZONS: ShadowFutureReturnHorizon[] = ['1d', '3d', '5d', '20d'];

export interface ShadowReturnMissDetail {
  symbol: string;
  signalDate: string;
  horizon: ShadowFutureReturnHorizon;
  targetDate: string;
  keysChecked: string[];
  existingKeys: string[];
  pointCounts: string[];
  reason: string;
}

function isResolved(signal: ShadowLearningOnlySignal, horizon: ShadowFutureReturnHorizon): boolean {
  if (horizon === '1d') return typeof signal.futureReturn1d === 'number';
  if (horizon === '3d') return typeof signal.futureReturn3d === 'number';
  if (horizon === '5d') return typeof signal.futureReturn5d === 'number';
  return typeof signal.futureReturn20d === 'number';
}

function rangesForHorizon(horizon: ShadowFutureReturnHorizon): string[] {
  if (horizon === '20d') return ['3mo', '6mo', '1y'];
  if (horizon === '5d') return ['1mo', '3mo', '1y'];
  return ['5d', '1mo', '3mo', '1y'];
}

function buildKey(symbol: string, range: string): string {
  return `${normalizeYahooSymbol(symbol)}:${range}:1d`;
}

export function buildShadowReturnMissDetails(
  signals: ShadowLearningOnlySignal[],
  limit = 20,
): ShadowReturnMissDetail[] {
  const out: ShadowReturnMissDetail[] = [];
  for (const signal of signals) {
    for (const horizon of HORIZONS) {
      if (isResolved(signal, horizon)) continue;
      if (!isShadowFutureReturnTargetMature({
        symbol: signal.symbol,
        signalDate: signal.signalDate,
        horizon,
        signal,
      })) continue;
      const targetAt = resolveShadowFutureReturnTargetCloseKst(signal.signalDate, horizon);
      if (!targetAt) continue;

      let hit = false;
      const keysChecked: string[] = [];
      const existingKeys: string[] = [];
      const pointCounts: string[] = [];
      for (const candidate of symbolCandidatesForShadowFutureReturnCache(signal.symbol)) {
        for (const range of rangesForHorizon(horizon)) {
          const key = buildKey(candidate, range);
          if (!keysChecked.includes(key)) keysChecked.push(key);
          const snapshot = getSnapshot(key);
          if (snapshot) {
            if (!existingKeys.includes(key)) existingKeys.push(key);
            pointCounts.push(`${key}=${parseYahooChartBody(snapshot.body).length}`);
          }
          if (readYahooSnapshotPoint(candidate, targetAt, range, '1d', 'closest')) {
            hit = true;
          }
        }
      }
      if (hit) continue;
      out.push({
        symbol: signal.symbol,
        signalDate: signal.signalDate,
        horizon,
        targetDate: targetAt.slice(0, 10),
        keysChecked,
        existingKeys,
        pointCounts,
        reason: existingKeys.length > 0 ? 'snapshot exists but target point unavailable' : 'snapshot missing',
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function loadShadowReturnMissDetails(limit = 20): ShadowReturnMissDetail[] {
  return buildShadowReturnMissDetails(loadShadowLearningOnlySignals(), limit);
}
