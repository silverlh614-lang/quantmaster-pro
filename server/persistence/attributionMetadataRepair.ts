/**
 * @responsibility counterfactual attribution 레코드의 결손 stop/target 메타를 shadow 원천에서 append-only backfill
 *
 * Patch 2 gap (d): COUNTERFACTUAL/SHADOW 레코드 중 stopPrice/targetPrice 가 결손된 건을
 * shadow-trades 원장(ServerShadowTrade.stopLoss/targetPrice)에서 채운다.
 *
 * 불변식 (9대 #2 — Shadow 불멈춤):
 *   - append-only: 기존 표본 삭제·재라벨·qtyRatio 변경 절대 금지.
 *   - stopPrice/targetPrice 가 이미 있는 레코드는 무수정 (idempotent).
 *   - 매칭 원천이 없으면 해당 레코드는 그대로 둔다 (강제 추정 금지).
 *   - 집계/라벨 경로에 자동 배선하지 않는다 (measurement·정합 보존 전용).
 */

import {
  loadAttributionRecords,
  saveAttributionRecords,
  type ServerAttributionRecord,
} from './attributionRepo.js';
import { loadShadowTrades, type ServerShadowTrade } from './shadowTradeRepo.js';

const COUNTERFACTUAL_PREFIXES = ['ghost:', 'counterfactual:'];

/** ghost:/counterfactual: prefix 를 제거한 원천 tradeId 후보를 반환. */
function strippedIds(tradeId: string): string[] {
  const ids = new Set<string>([tradeId]);
  for (const prefix of COUNTERFACTUAL_PREFIXES) {
    if (tradeId.startsWith(prefix)) ids.add(tradeId.slice(prefix.length));
  }
  return [...ids];
}

/** 본 레코드가 counterfactual/shadow lane 인지 (live 누수 방지 — LIVE 는 repair 대상 아님). */
function isCounterfactualLane(rec: ServerAttributionRecord): boolean {
  if (rec.evidenceSource === 'COUNTERFACTUAL' || rec.evidenceSource === 'SHADOW') return true;
  if (rec.evidenceSource) return false; // 명시 LIVE/BLOCKED/DIAGNOSTIC → repair 제외
  return COUNTERFACTUAL_PREFIXES.some((p) => rec.tradeId.startsWith(p));
}

function needsRepair(rec: ServerAttributionRecord): boolean {
  return rec.stopPrice === undefined || rec.targetPrice === undefined;
}

export interface RepairCounterfactualMetadataResult {
  scanned: number;
  /** counterfactual/shadow lane 이면서 stop 또는 target 결손인 레코드 수 */
  missingBefore: number;
  /** 실제로 backfill 된 레코드 수 */
  repaired: number;
  /** 원천 매칭 실패로 결손이 남은 레코드 수 */
  unresolved: number;
}

/**
 * counterfactual/shadow attribution 레코드의 결손 stop/target 을 shadow 원장에서 backfill.
 * append-only — 기존 필드/라벨/표본 수는 불변. 반환 통계는 read-only 진단에 활용.
 */
export function repairCounterfactualMetadata(): RepairCounterfactualMetadataResult {
  const records = loadAttributionRecords();
  const shadowTrades = loadShadowTrades();

  // shadow id → trade lookup.
  const byId = new Map<string, ServerShadowTrade>();
  for (const t of shadowTrades) {
    if (t.id) byId.set(t.id, t);
  }

  let missingBefore = 0;
  let repaired = 0;
  let unresolved = 0;

  const next = records.map((rec) => {
    if (!isCounterfactualLane(rec) || !needsRepair(rec)) return rec;
    missingBefore++;

    let source: ServerShadowTrade | undefined;
    for (const candidate of strippedIds(rec.tradeId)) {
      source = byId.get(candidate);
      if (source) break;
    }

    if (!source) {
      unresolved++;
      return rec; // 원천 부재 — 강제 추정 금지, 그대로 보존.
    }

    const patched: ServerAttributionRecord = { ...rec };
    let changed = false;
    if (patched.stopPrice === undefined && Number.isFinite(source.stopLoss)) {
      patched.stopPrice = source.stopLoss;
      changed = true;
    }
    if (patched.targetPrice === undefined && Number.isFinite(source.targetPrice)) {
      patched.targetPrice = source.targetPrice;
      changed = true;
    }
    if (changed) {
      repaired++;
      return patched;
    }
    unresolved++; // 원천은 있으나 채울 유효값 없음.
    return rec;
  });

  if (repaired > 0) {
    saveAttributionRecords(next);
  }

  return { scanned: records.length, missingBefore, repaired, unresolved };
}

/**
 * read-only 진단: counterfactual/shadow lane 레코드의 stop/target 결손 현황.
 * 데이터를 변경하지 않는다 (learningPulse 진단 섹션 전용).
 */
export function inspectCounterfactualMetadataHealth(): {
  counterfactualSamples: number;
  missingStop: number;
  missingTarget: number;
  missingEither: number;
} {
  const records = loadAttributionRecords();
  let counterfactualSamples = 0;
  let missingStop = 0;
  let missingTarget = 0;
  let missingEither = 0;
  for (const rec of records) {
    if (!isCounterfactualLane(rec)) continue;
    counterfactualSamples++;
    const noStop = rec.stopPrice === undefined;
    const noTarget = rec.targetPrice === undefined;
    if (noStop) missingStop++;
    if (noTarget) missingTarget++;
    if (noStop || noTarget) missingEither++;
  }
  return { counterfactualSamples, missingStop, missingTarget, missingEither };
}
