// @responsibility PATCH-0183 preflight learning recorder SSOT — Shadow/Universe learning recorders only.
/**
 * Extracted recorder helpers for preflight blocked-day learning.
 *
 * This module is intentionally side-effect limited:
 * - records ShadowLearningOnly scans for blocked preflight situations
 * - records CounterfactualUniverseLearning snapshots for preflight abort context
 * - never imports KIS order functions
 * - never mutates Gate/Kelly/order/live execution behavior
 * - recorder failures are catch-isolated and must not affect preflight abort flow
 */

import {
  isShadowLearningOnBlockedDaysEnabled,
  runShadowLearningOnlyScan,
  type ShadowLearningOnlyScanReason,
} from '../shadowLearningOnlyScan.js';
import type { SupplyHealthSnapshot } from '../../learning/supplyHealthLearning.js';
import type { WatchlistEntry } from '../../persistence/watchlistRepo.js';
import {
  deriveUniverseLearningReason,
  recordCounterfactualUniverseLearningSnapshot,
} from './counterfactualUniverseLearningWiring.js';
import type { CounterfactualUniverseLearningReason } from '../../persistence/counterfactualUniverseLearningRepo.js';

export type PreflightUniverseLearningStage =
  | 'BEFORE_UNIVERSE_BUILD'
  | 'AFTER_UNIVERSE_BUILD'
  | 'AFTER_CANDIDATE_SCAN'
  | 'BEFORE_BUYLIST_LOOP';

export interface PreflightUniverseLearningSnapshotInput {
  stage: PreflightUniverseLearningStage;
  primaryReason: string;
  watchlist?: WatchlistEntry[];
  regime?: string;
  marketSnapshot?: {
    riskMode?: string;
    sellOnly?: boolean;
    r6Defense?: boolean;
    emergencyStop?: boolean;
    regime?: string;
    vkospiLevel?: number;
    marketHealth?: string;
  };
  notes?: string[];
}

export async function captureSupplyHealthSnapshot(): Promise<SupplyHealthSnapshot | undefined> {
  if (process.env.NODE_ENV === 'test' && process.env.SUPPLY_HEALTH_LEARNING_ENABLED !== 'true') {
    return undefined;
  }
  try {
    const mod = await import('../../telegram/commands/system/supplyHealth.cmd.js');
    return await mod.buildSupplyHealthSnapshot();
  } catch (e) {
    console.warn('[SupplyHealth] snapshot capture failed:', e);
    return undefined;
  }
}

/**
 * ADR-0183: blocked-day shadow learning recorder.
 *
 * This must remain learning-only. It never allows real orders and never throws into
 * preflight control flow.
 */
export async function recordBlockedDayShadowScan(
  reason: ShadowLearningOnlyScanReason,
): Promise<void> {
  if (!isShadowLearningOnBlockedDaysEnabled()) return;
  try {
    const kstScanDate = new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const supplyHealthSnapshot = await captureSupplyHealthSnapshot();
    await runShadowLearningOnlyScan({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason,
      scanDate: kstScanDate,
      ...(supplyHealthSnapshot ? { supplyHealthSnapshot } : {}),
    });
  } catch (e) {
    console.warn(`[ShadowLearningOnly] scan 실패 (${reason}):`, e);
  }
}

/**
 * ADR-0433: preflight abort universe-level learning snapshot recorder.
 *
 * Responsibility split:
 * - recordBlockedDayShadowScan = per-symbol hypothetical buy judgment
 * - recordPreflightUniverseLearningSnapshot = preflight context/universe preservation
 */
export async function recordPreflightUniverseLearningSnapshot(
  input: PreflightUniverseLearningSnapshotInput,
): Promise<void> {
  try {
    const reasons: CounterfactualUniverseLearningReason[] = [
      deriveUniverseLearningReason(input.primaryReason),
    ];
    const watchlist = input.watchlist ?? [];
    const universeSize = watchlist.length;
    const candidates = watchlist.map((w, i) => ({
      symbol: w.code,
      name: w.name,
      sector: w.sector,
      source: 'watchlist',
      rank: i + 1,
    }));
    recordCounterfactualUniverseLearningSnapshot({
      preflightStage: input.stage,
      blockedBy: [input.primaryReason],
      reasons,
      regime: input.regime,
      universeSize,
      candidateCount: universeSize,
      candidates,
      marketSnapshot: input.marketSnapshot,
      notes: input.notes,
    });
  } catch (e) {
    console.warn('[CounterfactualUniverseLearning] preflight snapshot 영속 실패 — 격리 (abort 흐름 보호)', e);
  }
}
