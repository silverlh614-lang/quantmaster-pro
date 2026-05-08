// @responsibility ADR-454b Near-Miss Outcome Evaluation wiring 회귀 테스트
import fs from 'fs';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  __resetNearMissOutcomeLedgerForTests,
  addBusinessDays,
  getAllNearMissOutcomes,
  recordNearMissOutcome,
  summarizeNearMissOutcomeLedger,
} from '../persistence/nearMissOutcomeLedger.js';
import { evaluateNearMissOutcomes } from './nearMissOutcomeEvaluator.js';
import {
  formatNearMissOutcomeDiagnosticLine,
  formatNearMissOutcomeEvaluationReport,
} from './nearMissOutcomeFormatter.js';

const baseInput = {
  stockCode: '005930',
  stockName: '삼성전자',
  signalDate: '2026-05-08',
  signalPriceKrw: 70_000,
  bucket: 'DATA_BLOCKED_NEAR_MISS' as const,
  gateScore: 4.6,
  rawScore: 4.6,
  availableMaxScore: 7,
  normalizedGateScore: 0.66,
  normalThreshold: 5,
  unavailableConditions: ['supply_confluence'],
  thresholdNotMetConditions: ['volume_breakout'],
  providerDegradedConditions: ['sector_energy'],
  diagnosticReason: 'raw near normal, diagnostic only',
};

beforeEach(() => {
  __resetNearMissOutcomeLedgerForTests();
});

describe('ADR-454b Near-Miss Outcome Evaluation wiring', () => {
  it('due horizon 을 갱신하고 diagnosticOnly/executionImpact NONE 결과만 반환한다', async () => {
    recordNearMissOutcome(baseInput);

    const result = await evaluateNearMissOutcomes({
      now: new Date(`${addBusinessDays(baseInput.signalDate, 3)}T00:00:00.000Z`),
      priceFetcher: async () => 73_500,
    });

    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.closed).toBe(0);
    expect(result.executionImpact).toBe('NONE');
    expect(result.diagnosticOnly).toBe(true);
    expect(result.summary.observedCountByHorizon[3]).toBe(1);
    expect(result.summary.avgReturnPctByHorizon[3]).toBe(5);

    const [entry] = getAllNearMissOutcomes();
    expect(entry.horizons.find((h) => h.horizonDays === 3)?.status).toBe('OBSERVED');
    expect(entry.horizons.find((h) => h.horizonDays === 5)?.status).toBe('PENDING');
  });

  it('formatter 가 /scan_blockers compact line 과 Telegram report 에 safety 문구를 노출한다', async () => {
    recordNearMissOutcome({ ...baseInput, bucket: 'PROBING' });
    const result = await evaluateNearMissOutcomes({
      now: new Date(`${addBusinessDays(baseInput.signalDate, 10)}T00:00:00.000Z`),
      priceFetcher: async () => 63_000,
    });

    const line = formatNearMissOutcomeDiagnosticLine(summarizeNearMissOutcomeLedger());
    expect(line).toContain('Near-Miss Outcome (ADR-454b)');
    expect(line).toContain('executionImpact NONE');
    expect(line).toContain('3d -10.00%');
    expect(line).toContain('10d -10.00%');

    const report = formatNearMissOutcomeEvaluationReport(result);
    expect(report).toContain('DATA_BLOCKED_NEAR_MISS / PROBING / SHADOW_ONLY only');
    expect(report).toContain('diagnostic/learning only');
    expect(report).toContain('no live promotion');
    expect(report).toContain('no normalizedGateScore decision use');
  });

  it('핵심 안전 경계: evaluator/formatter/scheduler wiring 이 주문·엔트리·Kelly 모듈을 import 하지 않는다', () => {
    const files = [
      'server/learning/nearMissOutcomeEvaluator.ts',
      'server/learning/nearMissOutcomeFormatter.ts',
      'server/scheduler/maintenanceJobs.ts',
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
