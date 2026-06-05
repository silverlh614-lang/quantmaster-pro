import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { COUNTERFACTUAL_FILE, DATA_DIR, REGIME_TRANSITION_STATE_FILE } from '../persistence/paths.js';
import { collectCounterfactualMaturityStatus, collectCounterfactualStatus, counterfactualMetadataRepairDryRun, counterfactualMetadataRepairRun, counterfactualResolveDryRun, counterfactualResolveDueDryRun, counterfactualResolveDueRun, counterfactualResolveRun } from './learningSampleQuality.js';
import { COUNTERFACTUAL_RESOLVE_SCHEDULER_FILE } from './learningStorage.js';
import { loadRegimeResolvedTransitionState, REGIME_RESOLVED_TRANSITION_STATE_FILE } from './regimeResolvedTransitionStore.js';
import {
  recordCounterfactual, resolveCounterfactuals, getCounterfactualStats,
  loadCounterfactuals, recordCounterfactualCase, saveCounterfactuals,
} from './counterfactualShadow.js';

const _backup = fs.existsSync(COUNTERFACTUAL_FILE) ? fs.readFileSync(COUNTERFACTUAL_FILE, 'utf-8') : null;
const SCHEDULER_FILE = path.join(DATA_DIR, COUNTERFACTUAL_RESOLVE_SCHEDULER_FILE);
const _schedulerBackup = fs.existsSync(SCHEDULER_FILE) ? fs.readFileSync(SCHEDULER_FILE, 'utf-8') : null;
const REGIME_TRANSITION_FILE = path.join(DATA_DIR, REGIME_RESOLVED_TRANSITION_STATE_FILE);
const _regimeTransitionBackup = fs.existsSync(REGIME_TRANSITION_FILE) ? fs.readFileSync(REGIME_TRANSITION_FILE, 'utf-8') : null;
const _runtimeRegimeTransitionBackup = fs.existsSync(REGIME_TRANSITION_STATE_FILE) ? fs.readFileSync(REGIME_TRANSITION_STATE_FILE, 'utf-8') : null;

function reset() {
  // setup-drift fix: production shadowPersistenceGateway 가 source 별 in-memory fallback
  // 캐시를 유지(불변식 #2 — Shadow Learning 은 멈추면 안 됨). 파일만 unlink 하면 load() 가
  // 직전 테스트의 메모리 fallback 을 DEGRADED_FALLBACK 으로 반환해 엔트리가 누적된다.
  // saveCounterfactuals([]) 로 파일 + 메모리 fallback 둘 다 빈 상태로 정규화한다.
  saveCounterfactuals([]);
  if (fs.existsSync(COUNTERFACTUAL_FILE)) fs.unlinkSync(COUNTERFACTUAL_FILE);
  if (fs.existsSync(SCHEDULER_FILE)) fs.unlinkSync(SCHEDULER_FILE);
  if (fs.existsSync(REGIME_TRANSITION_FILE)) fs.unlinkSync(REGIME_TRANSITION_FILE);
  if (fs.existsSync(REGIME_TRANSITION_STATE_FILE)) fs.unlinkSync(REGIME_TRANSITION_STATE_FILE);
}

afterAll(() => {
  if (_backup !== null) fs.writeFileSync(COUNTERFACTUAL_FILE, _backup);
  else if (fs.existsSync(COUNTERFACTUAL_FILE)) fs.unlinkSync(COUNTERFACTUAL_FILE);
  if (_schedulerBackup !== null) fs.writeFileSync(SCHEDULER_FILE, _schedulerBackup);
  else if (fs.existsSync(SCHEDULER_FILE)) fs.unlinkSync(SCHEDULER_FILE);
  if (_regimeTransitionBackup !== null) fs.writeFileSync(REGIME_TRANSITION_FILE, _regimeTransitionBackup);
  else if (fs.existsSync(REGIME_TRANSITION_FILE)) fs.unlinkSync(REGIME_TRANSITION_FILE);
  if (_runtimeRegimeTransitionBackup !== null) fs.writeFileSync(REGIME_TRANSITION_STATE_FILE, _runtimeRegimeTransitionBackup);
  else if (fs.existsSync(REGIME_TRANSITION_STATE_FILE)) fs.unlinkSync(REGIME_TRANSITION_STATE_FILE);
});

describe('counterfactualShadow', () => {
  beforeEach(reset);

  it('record: 같은 날 중복 스킵', () => {
    const now = new Date('2026-04-22T00:00:00Z');
    const a = recordCounterfactual({
      stockCode: '005930', stockName: '삼성전자',
      priceAtSignal: 10_000, gateScore: 5, regime: 'R2_BULL',
      conditionKeys: ['momentum'], skipReason: 'GATE_UNDER', now,
    });
    const dup = recordCounterfactual({
      stockCode: '005930', stockName: '삼성전자',
      priceAtSignal: 10_500, gateScore: 5, regime: 'R2_BULL',
      conditionKeys: [], skipReason: 'GATE_UNDER', now,
    });
    expect(a).not.toBeNull();
    expect(dup).toBeNull();
    expect(loadCounterfactuals()).toHaveLength(1);
  });


  it('Counterfactual Truth v1: suppresses duplicate idempotency keys and keeps count invariant', () => {
    const now = new Date('2026-04-22T00:00:00Z');
    const first = recordCounterfactualCase({
      stockCode: '005930', stockName: '삼성전자', priceAtSignal: 10_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: ['momentum'],
      skipReason: 'GATE_UNDER', blockedReason: 'GATE_UNDER',
      sourceCandidateId: 'candidate-1', strategyId: 's1', now,
      hypotheticalTargetPrice: 11_000, hypotheticalStopPrice: 9_500, maxHoldingMinutes: 1,
    });
    const dup = recordCounterfactualCase({
      stockCode: '005930', stockName: '삼성전자', priceAtSignal: 10_100,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: ['momentum'],
      skipReason: 'GATE_UNDER', blockedReason: 'GATE_UNDER',
      sourceCandidateId: 'candidate-1', strategyId: 's1', now,
      hypotheticalTargetPrice: 11_000, hypotheticalStopPrice: 9_500, maxHoldingMinutes: 1,
    });
    expect(first.created).toBe(true);
    expect(dup.duplicateSuppressed).toBe(true);
    expect(loadCounterfactuals()).toHaveLength(1);
    const status = collectCounterfactualStatus(now);
    expect(status.builtUniqueCount).toBe(1);
    expect(status.duplicateSuppressedCount).toBe(1);
    expect(status.countInvariantValid).toBe(true);
    expect(status.metricWarnings).not.toContain('BUILT_UNIQUE_GT_CANDIDATE');
    expect(status.metricWarnings).not.toContain('COUNTERFACTUAL_BUILT_GT_CANDIDATE');
    expect(status.metricInfos).toContain('COUNTERFACTUAL_DUPLICATE_SUPPRESSED:1');
    expect(status.duplicateSuppressionStatus).toBe('OK');
    expect(status.executionImpact).toBe('NONE');
    expect(status.brokerOrdersCreated).toBe(0);
    expect(status.promotionAllowed).toBe(false);
  });

  it('Counterfactual Truth v1: resolve run emits labelBreakdown and labels resolved returns', () => {
    const signal = new Date('2026-04-22T00:00:00Z');
    recordCounterfactualCase({
      stockCode: '000660', stockName: 'SK하이닉스', priceAtSignal: 100_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'GATE_UNDER',
      sourceCandidateId: 'candidate-2', now: signal,
      hypotheticalTargetPrice: 105_000, hypotheticalStopPrice: 98_000, maxHoldingMinutes: 1,
    });
    const rows = loadCounterfactuals();
    rows[0].pricePath = [
      { at: '2026-04-22T00:02:00Z', price: 101_000, high: 101_000, low: 99_500 },
      { at: '2026-04-22T00:03:00Z', price: 105_500, high: 105_500, low: 100_000 },
    ];
    fs.writeFileSync(COUNTERFACTUAL_FILE, JSON.stringify(rows, null, 2));
    const dry = counterfactualResolveDryRun(new Date('2026-04-22T00:10:00Z'));
    expect(dry.scannedBuiltUnique).toBe(1);
    expect(dry.pendingOutcomeCount).toBe(1);
    expect(dry.expectedLabelable).toBe(1);
    const resolved = counterfactualResolveRun(new Date('2026-04-22T00:10:00Z'));
    expect(resolved.labelBreakdown.MISSED_WIN).toBe(1);
    expect(resolved.labeled).toBe(1);
    expect(resolved.stillPending).toBe(0);
    expect(resolved.executionImpact).toBe('NONE');
    expect(resolved.brokerOrdersCreated).toBe(0);
  });

  it('Counterfactual Target/Stop Backfill v1: repairs missing target/stop and enables recovered diagnostic labels', () => {
    const signal = new Date('2026-04-22T00:00:00Z');
    recordCounterfactualCase({
      stockCode: '035420', stockName: 'NAVER', priceAtSignal: 200_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'GATE_UNDER',
      sourceCandidateId: 'candidate-missing-target-stop', now: signal,
      maxHoldingMinutes: 1,
    });
    const rows = loadCounterfactuals();
    rows[0].pricePath = [
      { at: '2026-04-22T00:02:00Z', price: 203_000, high: 204_000, low: 199_000 },
      { at: '2026-04-22T00:04:00Z', price: 212_500, high: 212_500, low: 202_000 },
    ];
    fs.writeFileSync(COUNTERFACTUAL_FILE, JSON.stringify(rows, null, 2));

    const dry = counterfactualMetadataRepairDryRun(new Date('2026-04-22T00:10:00Z'));
    expect(dry.scannedBuiltUnique).toBe(1);
    expect(dry.missingTargetPrice).toBe(1);
    expect(dry.missingStopPrice).toBe(1);
    expect(dry.recoverableTargetStop).toBe(1);
    expect(loadCounterfactuals()[0].hypotheticalTargetPrice).toBeUndefined();

    const repaired = counterfactualMetadataRepairRun(new Date('2026-04-22T00:10:00Z'));
    expect(repaired.bothRecovered).toBe(1);
    expect(repaired.executionImpact).toBe('NONE');
    expect(repaired.brokerOrdersCreated).toBe(0);
    expect(repaired.promotionAllowed).toBe(false);
    const saved = loadCounterfactuals()[0];
    expect(saved.hypotheticalTargetPrice).toBeGreaterThan(0);
    expect(saved.hypotheticalStopPrice).toBeGreaterThan(0);
    expect(saved.sourceConfidence).not.toBe('HIGH');
    expect(saved.recoverySource).toBe('DEFAULT_R_MULTIPLE_FALLBACK');
    expect(saved.diagnosticOnly).toBe(true);
    expect(saved.promotionEligible).toBe(false);
    expect(saved.autoApply).toBe(false);

    const resolveDry = counterfactualResolveDryRun(new Date('2026-04-22T00:10:00Z'));
    expect(resolveDry.missingTargetPrice).toBe(0);
    expect(resolveDry.missingStopPrice).toBe(0);
    expect(resolveDry.resolvableNow).toBe(1);
    expect(resolveDry.quarantined).toBe(0);
    const resolved = counterfactualResolveRun(new Date('2026-04-22T00:10:00Z'));
    expect(resolved.labeled).toBe(1);
    expect(resolved.labelBreakdown.MISSED_WIN).toBe(1);
    expect(loadCounterfactuals()[0].labelSource).toBe('RECOVERED_TARGET_STOP');
  });

  it('Counterfactual Metadata Repair: recovers missing hypothetical entry price before labeling', () => {
    const signal = new Date('2026-04-22T00:00:00Z');
    recordCounterfactualCase({
      stockCode: '066570', stockName: 'LG전자', priceAtSignal: 100_000,
      gateScore: 5, regime: 'R6_DEFENSE', conditionKeys: [], skipReason: 'R6_DEFENSE_BLOCK',
      sourceCandidateId: 'missing-entry-case', now: signal,
      hypotheticalTargetPrice: 106_000, hypotheticalStopPrice: 97_000, maxHoldingMinutes: 1,
    });
    const rows = loadCounterfactuals();
    delete rows[0].hypotheticalEntryPrice;
    rows[0].pricePath = [{ at: '2026-04-22T00:02:00Z', price: 107_000, high: 107_000, low: 99_000 }];
    fs.writeFileSync(COUNTERFACTUAL_FILE, JSON.stringify(rows, null, 2));

    const dry = counterfactualMetadataRepairDryRun(new Date('2026-04-22T00:10:00Z'));
    expect(dry.missingEntryPrice).toBe(1);
    expect(dry.recoverableEntry).toBe(1);

    const repaired = counterfactualMetadataRepairRun(new Date('2026-04-22T00:10:00Z'));
    expect(repaired.entryRecovered).toBe(1);
    expect(repaired.missingEntryPrice).toBe(0);
    const saved = loadCounterfactuals()[0];
    expect(saved.hypotheticalEntryPrice).toBe(100_000);
    expect(saved.entryPriceRecovered).toBe(true);
    expect(saved.diagnosticOnly).toBe(true);
    expect(saved.promotionEligible).toBe(false);
    expect(saved.autoApply).toBe(false);
  });

  it('Counterfactual due resolve runs metadata repair first so matured R6 entries can be labeled', () => {
    const signal = new Date('2026-04-22T00:00:00Z');
    recordCounterfactualCase({
      stockCode: '017670', stockName: 'SK텔레콤', priceAtSignal: 50_000,
      gateScore: 5, regime: 'R6_DEFENSE', conditionKeys: [], skipReason: 'R6_DEFENSE_BLOCK',
      sourceCandidateId: 'r6-matured-missing-target-stop', now: signal, maxHoldingMinutes: 1,
    });
    const rows = loadCounterfactuals();
    rows[0].pricePath = [{ at: '2026-04-22T00:02:00Z', price: 53_500, high: 53_500, low: 49_500 }];
    fs.writeFileSync(COUNTERFACTUAL_FILE, JSON.stringify(rows, null, 2));

    const dueRun = counterfactualResolveDueRun(new Date('2026-04-22T00:10:00Z'));
    expect(dueRun.metadataRepairedBeforeResolve).toBeGreaterThan(0);
    expect(dueRun.metadataTargetStopRecoveredBeforeResolve).toBe(1);
    expect(dueRun.labeled).toBe(1);
    expect(dueRun.labelBreakdown.MISSED_WIN).toBe(1);
    expect(loadCounterfactuals()[0].outcomeStatus).toBe('LABELED');
    expect(dueRun.executionImpact).toBe('NONE');
    expect(dueRun.promotionAllowed).toBe(false);
  });

  it('Counterfactual Maturity Scheduler v1: resolves only matured cases and keeps waiting cases pending', () => {
    const baseTime = new Date('2026-04-22T00:00:00Z');
    recordCounterfactualCase({
      stockCode: '111111', stockName: 'Matured', priceAtSignal: 100,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'GATE_UNDER',
      sourceCandidateId: 'matured-case', now: baseTime, maxHoldingMinutes: 1,
    });
    recordCounterfactualCase({
      stockCode: '222222', stockName: 'Waiting', priceAtSignal: 100,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'GATE_UNDER',
      sourceCandidateId: 'waiting-case', now: baseTime, maxHoldingMinutes: 60,
      hypotheticalTargetPrice: 106, hypotheticalStopPrice: 97,
    });
    const rows = loadCounterfactuals();
    rows[0].pricePath = [{ at: '2026-04-22T00:02:00Z', price: 110, high: 110, low: 99 }];
    rows[1].pricePath = [{ at: '2026-04-22T00:02:00Z', price: 110, high: 110, low: 99 }];
    fs.writeFileSync(COUNTERFACTUAL_FILE, JSON.stringify(rows, null, 2));
    counterfactualMetadataRepairRun(new Date('2026-04-22T00:10:00Z'));

    const maturity = collectCounterfactualMaturityStatus(new Date('2026-04-22T00:10:00Z'));
    expect(maturity.totalBuiltUnique).toBe(2);
    expect(maturity.maturedNowCount).toBe(1);
    expect(maturity.waitingCount).toBe(1);
    expect(maturity.nearestMaturityAt).toBeTruthy();
    expect(maturity.nextResolveAt).toBe('2026-04-22T00:10:00.000Z');
    expect(new Date(maturity.nextRunAt!).getTime()).toBeGreaterThanOrEqual(new Date('2026-04-22T00:10:00Z').getTime());
    expect(maturity.resolverSchedulerRegistered).toBe(true);
    expect(maturity.bucketSum).toBe(maturity.pendingOutcomeCount);
    expect(maturity.bucketSumMatchesPending).toBe(true);

    const dueDry = counterfactualResolveDueDryRun(new Date('2026-04-22T00:10:00Z'));
    expect(dueDry.scannedPending).toBe(2);
    expect(dueDry.maturedNowCount).toBe(1);
    expect(dueDry.resolvableNow).toBe(1);
    expect(dueDry.expectedStillPending).toBe(1);
    expect(dueDry.waitingForHoldingPeriod).toBe(1);

    const dueRun = counterfactualResolveDueRun(new Date('2026-04-22T00:10:00Z'));
    expect(dueRun.labeled).toBe(1);
    expect(dueRun.stillPending).toBe(1);
    expect(dueRun.labelBreakdown.MISSED_WIN).toBe(1);
    const saved = loadCounterfactuals();
    expect(saved.find((e) => e.stockCode === '111111')?.labelSource).toBe('RECOVERED_TARGET_STOP');
    expect(saved.find((e) => e.stockCode === '111111')?.diagnosticOnly).toBe(true);
    expect(saved.find((e) => e.stockCode === '222222')?.outcomeStatus).toBe('PENDING');
    const transition = loadRegimeResolvedTransitionState();
    expect(transition.lastResolvedCount).toBe(1);
    expect(transition.lastResolvedByRegime.R2_EARLY).toBe(1);
    expect(transition.attributionRecalcNeeded).toBe(true);
    expect(transition.executionImpact).toBe('NONE');
    expect(transition.brokerOrdersCreated).toBe(0);
    expect(transition.promotionAllowed).toBe(false);
    expect(dueRun.executionImpact).toBe('NONE');
    expect(dueRun.brokerOrdersCreated).toBe(0);
    expect(dueRun.promotionAllowed).toBe(false);
  });

  it('resolveCounterfactuals: 30일 경과 시 return30d 채움', async () => {
    const signal = new Date('2026-01-01T00:00:00Z');
    recordCounterfactual({
      stockCode: '005930', stockName: '삼성전자',
      priceAtSignal: 10_000, gateScore: 5, regime: 'R2_BULL',
      conditionKeys: [], skipReason: 'GATE_UNDER', now: signal,
    });
    const now = new Date('2026-02-05T00:00:00Z'); // 35일 경과
    const res = await resolveCounterfactuals(async () => 11_000, now);
    expect(res.resolved30d).toBe(1);
    const entries = loadCounterfactuals();
    expect(entries[0].return30d).toBeCloseTo(10, 1);
  });

  it('R6 counterfactual outcome tracking keeps entry regime after recovery transition', () => {
    const signal = new Date('2026-05-18T00:00:00Z');
    recordCounterfactualCase({
      stockCode: '017670', stockName: 'SK Telecom', priceAtSignal: 50_000,
      gateScore: 5, regime: 'R6_DEFENSE', conditionKeys: [], skipReason: 'R6_DEFENSE_BLOCK',
      sourceCandidateId: 'r6-transition-sample', now: signal,
      hypotheticalTargetPrice: 53_000, hypotheticalStopPrice: 48_500, maxHoldingMinutes: 1,
      entryRegime: 'R6_DEFENSE',
      entryEffectiveState: 'R6_DEFENSE',
      transitionPath: ['R6_DEFENSE', 'R6_RECOVERY_WATCH'],
      r6LatchDecayAtEntry: 0,
      mhsAtEntry: 70,
      biasAtEntry: 'BULL',
      supplyScoreAtEntry: 77,
      programFlowAtEntry: 12_300_000,
    });
    const rows = loadCounterfactuals();
    rows[0].pricePath = [
      { at: '2026-05-18T00:02:00Z', price: 51_000, high: 51_500, low: 49_500 },
      { at: '2026-05-18T00:04:00Z', price: 53_200, high: 53_200, low: 50_500 },
    ];
    fs.writeFileSync(COUNTERFACTUAL_FILE, JSON.stringify(rows, null, 2));
    fs.writeFileSync(REGIME_TRANSITION_STATE_FILE, JSON.stringify({
      currentRegime: 'R5_CAUTION',
      rawRegime: 'R5_CAUTION',
      effectiveRegime: 'R5_CAUTION',
      r6RecoveryStatus: 'R5_STABILIZING',
      r6StateMachineState: 'R5_STABILIZING',
      latchDecayPercent: 40,
    }, null, 2));

    const resolved = counterfactualResolveDueRun(new Date('2026-05-18T00:10:00Z'));
    expect(resolved.labeled).toBe(1);
    expect(resolved.labelBreakdown.MISSED_WIN).toBe(1);
    const saved = loadCounterfactuals()[0];
    expect(saved.entryRegime).toBe('R6_DEFENSE');
    expect(saved.entryEffectiveState).toBe('R6_DEFENSE');
    expect(saved.exitRegime).toBe('R5_STABILIZING');
    expect(saved.resolvedAfterRegimeTransition).toBe(true);
    expect(saved.transitionPath).toEqual(['R6_DEFENSE', 'R6_RECOVERY_WATCH', 'R5_STABILIZING', 'R5_CAUTION']);
    expect(saved.mhsAtEntry).toBe(70);
    expect(saved.biasAtEntry).toBe('BULL');
    expect(saved.supplyScoreAtEntry).toBe(77);
    expect(saved.programFlowAtEntry).toBe(12_300_000);
    expect(saved.outcomeR).toBeGreaterThan(0);
    expect(saved.maturityWindow).toBe('TARGET_HIT');
    expect(saved.resolvedAt).toBe('2026-05-18T00:10:00.000Z');
    expect(saved.outcomeResolvedAt).toBe('2026-05-18T00:10:00.000Z');

    const transition = loadRegimeResolvedTransitionState();
    expect(transition.lastResolvedByRegime.R6_DEFENSE).toBe(1);
    expect(transition.attributionRecalcNeeded).toBe(true);
    expect(transition.executionImpact).toBe('NONE');
    expect(transition.promotionAllowed).toBe(false);
  });

  it('Counterfactual Maturity Bucket Accuracy v1: separates calendar buckets and validates scheduler staleness', () => {
    const now = new Date('2026-05-16T00:00:00Z');
    recordCounterfactualCase({
      stockCode: '333333', stockName: 'EightDays', priceAtSignal: 100,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'GATE_UNDER',
      sourceCandidateId: 'eight-day-case', now, maxHoldingMinutes: 8 * 24 * 60,
      hypotheticalTargetPrice: 106, hypotheticalStopPrice: 97,
    });
    for (const n of [1, 2]) {
      recordCounterfactualCase({
        stockCode: `44444${n}`, stockName: `After14Days${n}`, priceAtSignal: 100,
        gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'GATE_UNDER',
        sourceCandidateId: `after14-day-case-${n}`, now, maxHoldingMinutes: 20 * 24 * 60,
        hypotheticalTargetPrice: 106, hypotheticalStopPrice: 97,
      });
    }
    const maturity = collectCounterfactualMaturityStatus(now);
    expect(maturity.nearestMaturityAt).toBe('2026-05-24T00:00:00.000Z');
    expect(maturity.remainingMinutesToNearestMaturity).toBe(8 * 24 * 60);
    expect(maturity.remainingCalendarDaysToNearestMaturity).toBe(8);
    expect(maturity.maturityTimeBasis).toBe('CALENDAR_MINUTES');
    expect(maturity.maturityBucketBreakdown.dueIn2to3CalendarDays).toBe(0);
    expect(maturity.maturityBucketBreakdown.dueIn8to14CalendarDays).toBe(1);
    expect(maturity.maturityBucketBreakdown.dueAfter14CalendarDays).toBe(2);
    expect((maturity.maturityBucketBreakdown as Record<string, number>).dueIn2to3Days).toBeUndefined();
    expect((maturity as unknown as Record<string, unknown>).maturityBucketTop).toBeUndefined();
    expect(maturity.nearestMaturityBucket).toBe('dueIn8to14CalendarDays');
    expect(maturity.largestMaturityBucket).toBe('dueAfter14CalendarDays');
    expect(maturity.largestMaturityBucketCount).toBe(2);
    expect(maturity.bucketSum).toBe(maturity.pendingOutcomeCount);
    expect(maturity.bucketSumMatchesPending).toBe(true);
    expect(maturity.executionImpact).toBe('NONE');
    expect(maturity.brokerOrdersCreated).toBe(0);
    expect(maturity.promotionAllowed).toBe(false);

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SCHEDULER_FILE, JSON.stringify({ nextRunAt: '2026-05-15T00:00:00.000Z', schedulerStatus: 'SCHEDULED' }, null, 2));
    const stale = collectCounterfactualMaturityStatus(now);
    expect(stale.schedulerStatus).toBe('STALE');
    expect(new Date(stale.nextRunAt!).getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(stale.nextRunAt).toBe(stale.nearestMaturityAt);
  });

  it('getCounterfactualStats: 빈 데이터 → null', () => {
    expect(getCounterfactualStats(30)).toBeNull();
  });
});
