import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { COUNTERFACTUAL_FILE, DATA_DIR } from '../persistence/paths.js';
import { collectCounterfactualMaturityStatus, collectCounterfactualStatus, counterfactualMetadataRepairDryRun, counterfactualMetadataRepairRun, counterfactualResolveDryRun, counterfactualResolveDueDryRun, counterfactualResolveDueRun, counterfactualResolveRun } from './learningSampleQuality.js';
import { COUNTERFACTUAL_RESOLVE_SCHEDULER_FILE } from './learningStorage.js';
import {
  recordCounterfactual, resolveCounterfactuals, getCounterfactualStats,
  loadCounterfactuals, recordCounterfactualCase,
} from './counterfactualShadow.js';

const _backup = fs.existsSync(COUNTERFACTUAL_FILE) ? fs.readFileSync(COUNTERFACTUAL_FILE, 'utf-8') : null;
const SCHEDULER_FILE = path.join(DATA_DIR, COUNTERFACTUAL_RESOLVE_SCHEDULER_FILE);
const _schedulerBackup = fs.existsSync(SCHEDULER_FILE) ? fs.readFileSync(SCHEDULER_FILE, 'utf-8') : null;

function reset() {
  if (fs.existsSync(COUNTERFACTUAL_FILE)) fs.unlinkSync(COUNTERFACTUAL_FILE);
  if (fs.existsSync(SCHEDULER_FILE)) fs.unlinkSync(SCHEDULER_FILE);
}

afterAll(() => {
  if (_backup !== null) fs.writeFileSync(COUNTERFACTUAL_FILE, _backup);
  else if (fs.existsSync(COUNTERFACTUAL_FILE)) fs.unlinkSync(COUNTERFACTUAL_FILE);
  if (_schedulerBackup !== null) fs.writeFileSync(SCHEDULER_FILE, _schedulerBackup);
  else if (fs.existsSync(SCHEDULER_FILE)) fs.unlinkSync(SCHEDULER_FILE);
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

  it('Counterfactual Maturity Bucket Accuracy v1: separates calendar buckets and validates scheduler staleness', () => {
    const now = new Date('2026-05-16T00:00:00Z');
    recordCounterfactualCase({
      stockCode: '333333', stockName: 'EightDays', priceAtSignal: 100,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'GATE_UNDER',
      sourceCandidateId: 'eight-day-case', now, maxHoldingMinutes: 8 * 24 * 60,
      hypotheticalTargetPrice: 106, hypotheticalStopPrice: 97,
    });
    const maturity = collectCounterfactualMaturityStatus(now);
    expect(maturity.nearestMaturityAt).toBe('2026-05-24T00:00:00.000Z');
    expect(maturity.remainingMinutesToNearestMaturity).toBe(8 * 24 * 60);
    expect(maturity.remainingCalendarDaysToNearestMaturity).toBe(8);
    expect(maturity.maturityTimeBasis).toBe('CALENDAR_MINUTES');
    expect(maturity.maturityBucketBreakdown.dueIn2to3CalendarDays).toBe(0);
    expect(maturity.maturityBucketBreakdown.dueIn8to14CalendarDays).toBe(1);
    expect((maturity.maturityBucketBreakdown as Record<string, number>).dueIn2to3Days).toBeUndefined();
    expect(maturity.maturityBucketTop).toBe('dueIn8to14CalendarDays');
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
