// @responsibility ADR-458 Gate Reclassification Dry-Run wiring 회귀 테스트 (behavioral — 실 함수 호출)
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  evaluateGateReclassificationDryRun,
  isGateReclassificationDryRunDisabled,
} from '../../learning/gateReclassificationDryRun.js';
import type { GateReclassificationApprovalItem } from '../../learning/gateReclassificationApprovalPlan.js';

// ADR-0019 분해로 dry-run wiring 이 perSymbol/steps/kisIntradayCorrection.ts 로 이동.
const KIS_INTRADAY_CORRECTION = fs.readFileSync(
  path.resolve('server/trading/signalScanner/perSymbol/steps/kisIntradayCorrection.ts'),
  'utf-8',
);

function approvalItem(over: Partial<GateReclassificationApprovalItem>): GateReclassificationApprovalItem {
  return {
    condition: 'per',
    source: 'unavailableConditions',
    proposedClass: 'SOFT_PENALTY',
    status: 'APPROVED',
    ...over,
  } as GateReclassificationApprovalItem;
}

function dryRunInput(over: Partial<Parameters<typeof evaluateGateReclassificationDryRun>[0]> = {}) {
  return {
    code: '005930',
    name: 'Samsung',
    gateScore: 6,
    rawScore: 6,
    availableMaxScore: 10,
    normalizedGateScore: 0.6,
    unavailableConditions: ['per'],
    thresholdNotMetConditions: [],
    providerDegradedConditions: [],
    originalBucket: 'DATA_BLOCKED_NEAR_MISS' as const,
    approvedItems: [],
    ...over,
  };
}

describe('ADR-458 dry-run wiring (behavioral)', () => {
  const ORIG = process.env.GATE_RECLASSIFICATION_DRY_RUN_DISABLED;
  beforeEach(() => { delete process.env.GATE_RECLASSIFICATION_DRY_RUN_DISABLED; });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.GATE_RECLASSIFICATION_DRY_RUN_DISABLED;
    else process.env.GATE_RECLASSIFICATION_DRY_RUN_DISABLED = ORIG;
  });

  it('ENV disabled gate — GATE_RECLASSIFICATION_DRY_RUN_DISABLED=true 정확 비교 + wiring(kisIntradayCorrection) 보존', () => {
    // disabled gate 동작 (skip 경로의 판정 SSOT).
    expect(isGateReclassificationDryRunDisabled()).toBe(false);
    process.env.GATE_RECLASSIFICATION_DRY_RUN_DISABLED = 'true';
    expect(isGateReclassificationDryRunDisabled()).toBe(true);
    process.env.GATE_RECLASSIFICATION_DRY_RUN_DISABLED = 'TRUE'; // 대문자 거부 (정확 비교).
    expect(isGateReclassificationDryRunDisabled()).toBe(false);
    // wiring 위치 가드 — 4 함수가 새 home(kisIntradayCorrection) 에서 disabled-skip + 호출 + 영속 + 누적.
    expect(KIS_INTRADAY_CORRECTION).toContain('isGateReclassificationDryRunDisabled()');
    expect(KIS_INTRADAY_CORRECTION).toContain('evaluateGateReclassificationDryRun');
    expect(KIS_INTRADAY_CORRECTION).toContain('upsertGateReclassificationDryRunRecord');
    expect(KIS_INTRADAY_CORRECTION).toContain('accumulateGateReclassificationDryRun');
  });

  it('승인 plan은 APPROVED item만 dry-run에 반영한다 (PENDING/REJECTED 무시 → NO_CHANGE)', () => {
    // APPROVED 매칭 → 결정 변경 (NO_CHANGE 아님).
    const approved = evaluateGateReclassificationDryRun(dryRunInput({
      approvedItems: [approvalItem({ condition: 'per', proposedClass: 'WAIT_TRIGGER' })],
    }));
    expect(approved.dryRunDecision).not.toBe('NO_CHANGE');
    expect(approved.matchedApprovedConditions).toContain('per');

    // 동일 condition 이지만 status≠APPROVED → 무시 → NO_CHANGE + score 조정 0.
    const nonApproved = evaluateGateReclassificationDryRun(dryRunInput({
      approvedItems: [
        approvalItem({ condition: 'per', proposedClass: 'WAIT_TRIGGER', status: 'PENDING_APPROVAL' }),
        approvalItem({ condition: 'per', proposedClass: 'SOFT_PENALTY', status: 'REJECTED' }),
      ],
    }));
    expect(nonApproved.dryRunDecision).toBe('NO_CHANGE');
    expect(nonApproved.matchedApprovedConditions).toHaveLength(0);
    expect(nonApproved.dryRunScoreAdjustment).toBe(0);
    // 절대 불변식 — dry-run 은 실주문 0 (executionImpact NONE / createLiveOrder false / 인간 승인 필요).
    expect(nonApproved.executionImpact).toBe('NONE');
    expect(nonApproved.createLiveOrder).toBe(false);
    expect(nonApproved.requiresHumanApproval).toBe(true);
  });

  it('wiring 위치 — kisIntradayCorrection 이 APPROVED-only filter + approvalPlan SSOT 사용', () => {
    expect(KIS_INTRADAY_CORRECTION).toContain('loadGateReclassificationApprovalPlan().items');
    expect(KIS_INTRADAY_CORRECTION).toContain(".filter((item) => item.status === 'APPROVED')");
  });

  it('KIS order API import 없음 및 live order 생성 없음', () => {
    const dryRunSrc = fs.readFileSync(path.resolve('server/learning/gateReclassificationDryRun.ts'), 'utf-8');
    const repoSrc = fs.readFileSync(path.resolve('server/persistence/gateReclassificationDryRunRepo.ts'), 'utf-8');
    expect(`${dryRunSrc}\n${repoSrc}`).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|kisPost\(/);
    expect(dryRunSrc).not.toMatch(/createLiveOrder:\s*true/);
    expect(dryRunSrc).not.toMatch(/executionImpact:\s*['"]FULL['"]|executionImpact:\s*['"]PARTIAL['"]/);
  });

  it('Gate config / threshold / Kelly 변경 함수나 normalizedGateScore live signal 연결이 없다', () => {
    const dryRunSrc = fs.readFileSync(path.resolve('server/learning/gateReclassificationDryRun.ts'), 'utf-8');
    expect(dryRunSrc).not.toMatch(/setRuntimeThresholdDelta|GATE_SCORE_THRESHOLD_BY_REGIME|positionPct|Kelly|kelly/i);
    expect(dryRunSrc).not.toMatch(/normalizedGateScore.*signalType|signalType.*normalizedGateScore/);
  });
});
