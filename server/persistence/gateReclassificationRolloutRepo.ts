/**
 * @responsibility ADR-459 Gate Reclassification Rollout persistence repo.
 *
 * Stores operator rollout state separately from approval/dry-run evidence and from all live
 * execution configuration. Atomic write plus damaged JSON fallback keeps diagnostics safe.
 */
import fs from 'fs';
import {
  GATE_RECLASSIFICATION_ROLLOUT_FILE,
  ensureDataDir,
} from './paths.js';
import type {
  GateReclassificationRolloutItem,
  GateReclassificationRolloutPlan,
  GateReclassificationRolloutStage,
} from '../learning/gateReclassificationRolloutPolicy.js';
import {
  buildGateReclassificationRolloutId as buildPolicyRolloutId,
  clampMaxStage,
} from '../learning/gateReclassificationRolloutPolicy.js';

function isRolloutPlan(value: unknown): value is GateReclassificationRolloutPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<GateReclassificationRolloutPlan>;
  return typeof plan.generatedAt === 'string'
    && Array.isArray(plan.items)
    && typeof plan.activeCount === 'number'
    && typeof plan.pausedCount === 'number'
    && typeof plan.maxStage === 'string'
    && typeof plan.operatorMessage === 'string';
}

function normalizeItem(item: GateReclassificationRolloutItem): GateReclassificationRolloutItem {
  const rolloutStage = clampMaxStage(item.rolloutStage);
  return {
    ...item,
    id: buildPolicyRolloutId(item.approvalItemId, rolloutStage),
    rolloutStage,
    executionImpact: 'NONE',
    createLiveOrder: false,
    modifiesCoreGate: false,
    requiresHumanApproval: true,
  };
}

function recalcPlan(plan: GateReclassificationRolloutPlan): GateReclassificationRolloutPlan {
  const items = plan.items.map(normalizeItem);
  const activeCount = items.filter((item) => item.status === 'ACTIVE').length;
  const pausedCount = items.filter((item) => item.status === 'PAUSED').length;
  const stageRank: Record<GateReclassificationRolloutStage, number> = {
    OBSERVE: 0,
    SHADOW_SCORE: 1,
    ADVISORY: 2,
    WEIGHTED: 3,
    GATED: 4,
    CORE: 5,
  };
  const maxStage = items.reduce<GateReclassificationRolloutStage>((max, item) => (
    stageRank[item.rolloutStage] > stageRank[max] ? item.rolloutStage : max
  ), 'OBSERVE');
  return { ...plan, items, activeCount, pausedCount, maxStage };
}

function atomicWrite(plan: GateReclassificationRolloutPlan): void {
  ensureDataDir();
  const tmp = `${GATE_RECLASSIFICATION_ROLLOUT_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(recalcPlan(plan), null, 2), 'utf-8');
  fs.renameSync(tmp, GATE_RECLASSIFICATION_ROLLOUT_FILE);
}

export function loadGateReclassificationRolloutPlan(): GateReclassificationRolloutPlan | null {
  ensureDataDir();
  if (!fs.existsSync(GATE_RECLASSIFICATION_ROLLOUT_FILE)) return null;
  try {
    const raw = fs.readFileSync(GATE_RECLASSIFICATION_ROLLOUT_FILE, 'utf-8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRolloutPlan(parsed)) return null;
    return recalcPlan(parsed);
  } catch {
    return null;
  }
}

export function saveGateReclassificationRolloutPlan(plan: GateReclassificationRolloutPlan): void {
  atomicWrite(plan);
}

export function upsertGateReclassificationRolloutItems(items: GateReclassificationRolloutItem[]): void {
  const existing = loadGateReclassificationRolloutPlan();
  const byId = new Map<string, GateReclassificationRolloutItem>();
  for (const item of existing?.items ?? []) {
    const normalized = normalizeItem(item);
    byId.set(normalized.id, normalized);
  }
  for (const item of items) {
    const normalized = normalizeItem(item);
    byId.set(normalized.id, normalized);
  }
  const generatedAt = new Date().toISOString();
  const plan: GateReclassificationRolloutPlan = {
    generatedAt,
    items: [...byId.values()].sort((a, b) => a.condition.localeCompare(b.condition) || a.rolloutStage.localeCompare(b.rolloutStage)),
    activeCount: 0,
    pausedCount: 0,
    maxStage: 'OBSERVE',
    operatorMessage: existing?.operatorMessage ?? 'ADR-459 rollout repo stores operating state only; it does not modify live gate policy.',
  };
  atomicWrite(plan);
}

export function buildGateReclassificationRolloutId(
  approvalItemId: string,
  rolloutStage: GateReclassificationRolloutStage,
): string {
  return buildPolicyRolloutId(approvalItemId, rolloutStage);
}

export function __resetGateReclassificationRolloutPlanForTests(): void {
  try {
    if (fs.existsSync(GATE_RECLASSIFICATION_ROLLOUT_FILE)) fs.unlinkSync(GATE_RECLASSIFICATION_ROLLOUT_FILE);
    const tmp = `${GATE_RECLASSIFICATION_ROLLOUT_FILE}.tmp`;
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch {
    // test cleanup only
  }
}
