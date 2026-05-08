import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateReclassificationRolloutItem, GateReclassificationRolloutPlan } from '../learning/gateReclassificationRolloutPolicy.js';

let tmpDir: string;

function item(overrides: Partial<GateReclassificationRolloutItem> = {}): GateReclassificationRolloutItem {
  return {
    id: 'approval-supply__ADVISORY',
    approvalItemId: 'approval-supply',
    condition: 'supply_confluence',
    source: 'unavailableConditions',
    proposedClass: 'SOFT_PENALTY',
    rolloutStage: 'ADVISORY',
    status: 'ACTIVE',
    dryRunEvidence: {
      samples: 20,
      avgReturnPct: 3,
      winRate: 0.6,
      lossRate: 0.4,
      rescuedCount: 6,
      horizonDays: 5,
    },
    promotionReason: 'qualified advisory',
    startedAt: '2026-05-08T00:00:00.000Z',
    expiresAt: '2026-06-07T00:00:00.000Z',
    executionImpact: 'NONE',
    createLiveOrder: false,
    modifiesCoreGate: false,
    requiresHumanApproval: true,
    ...overrides,
  };
}

function plan(items: GateReclassificationRolloutItem[]): GateReclassificationRolloutPlan {
  return {
    generatedAt: '2026-05-08T00:00:00.000Z',
    items,
    activeCount: items.filter((row) => row.status === 'ACTIVE').length,
    pausedCount: items.filter((row) => row.status === 'PAUSED').length,
    maxStage: 'ADVISORY',
    operatorMessage: 'operator state only',
  };
}

async function loadRepo() {
  vi.resetModules();
  process.env.PERSIST_DATA_DIR = tmpDir;
  return import('./gateReclassificationRolloutRepo.js');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-rollout-'));
});

afterEach(() => {
  delete process.env.PERSIST_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

describe('ADR-459 gateReclassificationRolloutRepo', () => {
  it('save/load는 rollout plan을 atomic write로 저장하고 safety literal을 보존한다', async () => {
    const repo = await loadRepo();
    repo.saveGateReclassificationRolloutPlan(plan([item()]));

    const loaded = repo.loadGateReclassificationRolloutPlan();
    expect(loaded?.items).toHaveLength(1);
    expect(loaded?.items[0].executionImpact).toBe('NONE');
    expect(loaded?.items[0].createLiveOrder).toBe(false);
    expect(loaded?.items[0].modifiesCoreGate).toBe(false);
    expect(loaded?.items[0].requiresHumanApproval).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'gate-reclassification-rollout.json.tmp'))).toBe(false);
  });

  it('upsertGateReclassificationRolloutItems는 같은 id를 갱신하고 신규 id를 추가한다', async () => {
    const repo = await loadRepo();
    repo.saveGateReclassificationRolloutPlan(plan([item({ promotionReason: 'old' })]));

    repo.upsertGateReclassificationRolloutItems([
      item({ promotionReason: 'new' }),
      item({
        id: 'approval-volume__SHADOW_SCORE',
        approvalItemId: 'approval-volume',
        condition: 'volume_breakout',
        rolloutStage: 'SHADOW_SCORE',
        promotionReason: 'second',
      }),
    ]);

    const loaded = repo.loadGateReclassificationRolloutPlan();
    expect(loaded?.items).toHaveLength(2);
    expect(loaded?.items.find((row) => row.id === 'approval-supply__ADVISORY')?.promotionReason).toBe('new');
    expect(loaded?.activeCount).toBe(2);
  });

  it('손상 JSON은 null fallback으로 운영 상태 로드를 중단하지 않는다', async () => {
    const repo = await loadRepo();
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'gate-reclassification-rollout.json'), '{ broken json !!!', 'utf-8');

    expect(repo.loadGateReclassificationRolloutPlan()).toBeNull();
  });

  it('repo id builder는 policy id builder와 동일하며 KIS API를 import하지 않는다', async () => {
    const repo = await loadRepo();
    expect(repo.buildGateReclassificationRolloutId('a/b', 'WEIGHTED')).toBe('a_b__WEIGHTED');

    const src = fs.readFileSync(path.resolve('server/persistence/gateReclassificationRolloutRepo.ts'), 'utf-8');
    expect(src).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|kisPost\(/);
    expect(src).not.toMatch(/createLiveOrder:\s*true/);
    expect(src).not.toMatch(/modifiesCoreGate:\s*true/);
  });
});
