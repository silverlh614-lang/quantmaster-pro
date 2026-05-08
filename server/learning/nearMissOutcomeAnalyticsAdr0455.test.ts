// @responsibility ADR-455 Near-Miss Outcome Analytics & over-strict condition detection 회귀 테스트
import fs from 'fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetNearMissOutcomeLedgerForTests,
  addBusinessDays,
  recordNearMissOutcome,
  refreshNearMissOutcomeLedger,
} from '../persistence/nearMissOutcomeLedger.js';
import {
  buildNearMissOutcomeAnalyticsReport,
  classifyNearMissConditionStrictness,
} from './nearMissOutcomeAnalytics.js';
import {
  formatNearMissOutcomeAnalyticsDiagnosticLine,
  formatNearMissOutcomeAnalyticsReport,
} from './nearMissOutcomeFormatter.js';

const signalDate = '2026-05-08';
const signalPriceKrw = 10_000;

function recordSample(
  stockCode: string,
  bucket: 'DATA_BLOCKED_NEAR_MISS' | 'PROBING' | 'SHADOW_ONLY',
  unavailableConditions: string[],
  thresholdNotMetConditions: string[],
): void {
  const result = recordNearMissOutcome({
    stockCode,
    stockName: `테스트${stockCode}`,
    signalDate,
    signalPriceKrw,
    bucket,
    diagnosticReason: 'ADR-455 analytics fixture',
    gateScore: 4.6,
    rawScore: 4.6,
    availableMaxScore: 7,
    normalizedGateScore: 0.66,
    normalThreshold: 5,
    unavailableConditions,
    thresholdNotMetConditions,
    providerDegradedConditions: ['sector_energy'],
  });
  expect(result.recorded).toBe(true);
}

beforeEach(() => {
  __resetNearMissOutcomeLedgerForTests();
});

describe('ADR-455 Near-Miss Outcome Analytics', () => {
  it('bucket 별 3/5/10d 성과와 condition 별 over-strict / good-defense 후보를 read-only 로 진단한다', async () => {
    recordSample('000001', 'DATA_BLOCKED_NEAR_MISS', ['supply_confluence'], ['volume_breakout']);
    recordSample('000002', 'DATA_BLOCKED_NEAR_MISS', ['supply_confluence'], ['volume_breakout']);
    recordSample('000003', 'PROBING', ['supply_confluence'], ['rsi_confirmation']);
    recordSample('000004', 'SHADOW_ONLY', ['old_news'], ['late_session']);
    recordSample('000005', 'SHADOW_ONLY', ['old_news'], ['late_session']);
    recordSample('000006', 'SHADOW_ONLY', ['old_news'], ['late_session']);

    const prices: Record<string, number> = {
      '000001': 10_500,
      '000002': 10_400,
      '000003': 10_600,
      '000004': 9_700,
      '000005': 9_600,
      '000006': 10_100,
    };
    await refreshNearMissOutcomeLedger({
      now: new Date(`${addBusinessDays(signalDate, 10)}T00:00:00.000Z`),
      priceFetcher: async (code) => prices[code] ?? null,
    });

    const report = buildNearMissOutcomeAnalyticsReport();
    expect(report.executionImpact).toBe('NONE');
    expect(report.diagnosticOnly).toBe(true);
    expect(report.totalEntries).toBe(6);
    expect(report.observedEntries).toBe(6);

    const dataBlocked = report.bucketAnalytics.find((row) => row.bucket === 'DATA_BLOCKED_NEAR_MISS');
    const shadowOnly = report.bucketAnalytics.find((row) => row.bucket === 'SHADOW_ONLY');
    expect(dataBlocked?.horizonStats[10]).toMatchObject({ observed: 2, avgReturnPct: 4.5, positiveCount: 2 });
    expect(shadowOnly?.horizonStats[10]).toMatchObject({ observed: 3, avgReturnPct: -2, positiveCount: 1 });

    const unavailable = report.conditionAnalytics.unavailableConditions;
    const threshold = report.conditionAnalytics.thresholdNotMetConditions;
    expect(unavailable.find((row) => row.condition === 'supply_confluence')?.verdict).toBe('OVER_STRICT_CANDIDATE');
    expect(unavailable.find((row) => row.condition === 'old_news')?.verdict).toBe('GOOD_DEFENSE');
    expect(threshold.find((row) => row.condition === 'volume_breakout')?.verdict).toBe('INSUFFICIENT_DATA');

    const compact = formatNearMissOutcomeAnalyticsDiagnosticLine(report);
    expect(compact).toContain('ADR-455');
    expect(compact).toContain('supply_confluence');
    expect(compact).toContain('over-strict?');
    expect(compact).toContain('diagnosticOnly executionImpact NONE');

    const full = formatNearMissOutcomeAnalyticsReport(report);
    expect(full).toContain('Near-Miss Outcome Analytics (ADR-455)');
    expect(full).toContain('DATA_BLOCKED_NEAR_MISS entries 2');
    expect(full).toContain('old_news 10d -2.00% win 33% n=3 good-defense');
    expect(full).toContain('no Gate/Kelly/KIS/entryEngine/thresholdSearchLoop/live-decision changes');
    expect(full).toContain('normalizedGateScore not used for live decisions');
  });

  it('min sample 미만 condition 은 완화 후보로 승격하지 않고 insufficient 로 남긴다', () => {
    expect(classifyNearMissConditionStrictness({
      observed: 2,
      avgReturnPct: 12,
      winRate: 1,
      positiveCount: 2,
    })).toBe('INSUFFICIENT_DATA');
  });

  it('핵심 안전 경계: analytics/formatter/scan_blockers 는 주문·엔트리·Kelly 모듈을 import 하지 않는다', () => {
    const files = [
      'server/learning/nearMissOutcomeAnalytics.ts',
      'server/learning/nearMissOutcomeFormatter.ts',
      'server/telegram/commands/system/scanBlockers.cmd.ts',
    ];
    const bannedImportTokens = [
      'placeKisBuyOrder',
      'placeKisOrder',
      'entryEngine',
      'thresholdSearchLoop',
      'kellyDampener',
    ];

    for (const file of files) {
      const importBlock = fs.readFileSync(file, 'utf-8')
        .split('\n')
        .filter((line) => line.startsWith('import '))
        .join('\n');
      for (const token of bannedImportTokens) {
        expect(importBlock, `${file} must not import ${token}`).not.toContain(token);
      }
    }
  });
});
