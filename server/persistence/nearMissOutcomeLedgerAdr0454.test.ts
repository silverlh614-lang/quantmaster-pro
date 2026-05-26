// @responsibility ADR-454 Near-Miss Outcome Ledger 회귀 테스트
import { describe, expect, it, beforeEach } from 'vitest';
import {
  __resetNearMissOutcomeLedgerForTests,
  addBusinessDays,
  getAllNearMissOutcomes,
  recordNearMissOutcome,
  refreshNearMissOutcomeLedger,
  summarizeNearMissOutcomeLedger,
} from './nearMissOutcomeLedger.js';

const baseInput = {
  stockCode: '005930',
  stockName: '삼성전자',
  signalDate: '2026-05-08',
  signalPriceKrw: 70_000,
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

describe('ADR-454 Near-Miss Outcome Ledger', () => {
  it('DATA_BLOCKED_NEAR_MISS 후보를 3/5/10영업일 horizon 과 executionImpact NONE 으로 영속한다', () => {
    const result = recordNearMissOutcome({
      ...baseInput,
      bucket: 'DATA_BLOCKED_NEAR_MISS',
      now: new Date('2026-05-08T01:00:00.000Z'),
    });

    expect(result).toEqual({ recorded: true, reason: 'recorded' });
    const [entry] = getAllNearMissOutcomes();
    expect(entry.bucket).toBe('DATA_BLOCKED_NEAR_MISS');
    expect(entry.executionImpact).toBe('NONE');
    expect(entry.normalizedGateScore).toBe(0.66);
    expect(entry.horizons.map((h) => h.horizonDays)).toEqual([3, 5, 10]);
    expect(entry.horizons.map((h) => h.targetDate)).toEqual([
      addBusinessDays('2026-05-08', 3),
      addBusinessDays('2026-05-08', 5),
      addBusinessDays('2026-05-08', 10),
    ]);
  });

  it('PROBING/SHADOW_ONLY 만 추가 추적하고 EXECUTABLE/REJECTED 는 실매수 승격 없이 skip 한다', () => {
    expect(recordNearMissOutcome({ ...baseInput, bucket: 'PROBING' }).recorded).toBe(true);
    expect(recordNearMissOutcome({ ...baseInput, stockCode: '000660', bucket: 'SHADOW_ONLY' }).recorded).toBe(true);
    expect(recordNearMissOutcome({ ...baseInput, stockCode: '035420', bucket: 'EXECUTABLE' }).reason).toBe('bucket_not_tracked');
    expect(recordNearMissOutcome({ ...baseInput, stockCode: '035720', bucket: 'REJECTED' }).reason).toBe('bucket_not_tracked');
    expect(getAllNearMissOutcomes()).toHaveLength(2);
  });

  it('동일 stockCode+signalDate+bucket 은 idempotent 하게 중복 기록하지 않는다', () => {
    expect(recordNearMissOutcome({ ...baseInput, bucket: 'PROBING' }).recorded).toBe(true);
    expect(recordNearMissOutcome({ ...baseInput, bucket: 'PROBING' })).toEqual({
      recorded: false,
      reason: 'duplicate',
    });
    expect(getAllNearMissOutcomes()).toHaveLength(1);
  });

  it('만기 horizon 을 가격 조회 수익률로 갱신하고 10영업일까지 모두 관측되면 close 한다', async () => {
    recordNearMissOutcome({ ...baseInput, bucket: 'SHADOW_ONLY' });

    const partial = await refreshNearMissOutcomeLedger({
      now: new Date(`${addBusinessDays(baseInput.signalDate, 5)}T00:00:00.000Z`),
      priceFetcher: async () => 77_000,
    });
    expect(partial).toEqual({ updated: 2, updated3d: 1, updated5d: 1, updated10d: 0, skipped: 0, closed: 0 });

    const final = await refreshNearMissOutcomeLedger({
      now: new Date(`${addBusinessDays(baseInput.signalDate, 10)}T00:00:00.000Z`),
      priceFetcher: async () => 63_000,
    });
    expect(final).toEqual({ updated: 1, updated3d: 0, updated5d: 0, updated10d: 1, skipped: 0, closed: 1 });

    const [entry] = getAllNearMissOutcomes();
    expect(entry.closed).toBe(true);
    expect(entry.horizons.map((h) => h.returnPct)).toEqual([10, 10, -10]);

    const summary = summarizeNearMissOutcomeLedger();
    expect(summary.closedCount).toBe(1);
    expect(summary.observedCountByHorizon[3]).toBe(1);
    expect(summary.avgReturnPctByHorizon[10]).toBe(-10);
  });
});
