// @responsibility Gate3 forward-return cron 단위테스트 — pending seed 갱신 + schedulerHealthy 회복(d1Updated>0) 검증

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Gate3OutcomeSeed } from '../quant/gate3OutcomeSeed.js';
import { buildGate3EvidenceWarmupStatus } from '../quant/gate3EvidenceWarmup.js';

// In-memory ledger — vi.mock 으로 disk/KIS 접근 완전 격리.
let ledger: Gate3OutcomeSeed[] = [];

vi.mock('../persistence/gate3OutcomeRepo.js', () => ({
  listPendingGate3Outcomes: () =>
    ledger.filter((s) => s.outcomeStatus === 'PENDING' || s.outcomeStatus === 'PARTIAL'),
  persistGate3OutcomeSeed: (seed: Gate3OutcomeSeed) => {
    const idx = ledger.findIndex((s) => s.id === seed.id);
    if (idx < 0) return null;
    ledger[idx] = { ...seed, marketSignal: false, providerIssue: false };
    return ledger[idx];
  },
}));

// fetchCurrentPrice 미사용 보장 — 테스트는 priceFetcher 주입만 사용.
vi.mock('../clients/kisClient.js', () => ({
  fetchCurrentPrice: vi.fn(async () => {
    throw new Error('fetchCurrentPrice should not be called when priceFetcher is injected');
  }),
}));

const sendTelegramAlert = vi.fn(async (_message: string, _opts?: unknown) => undefined);
vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: (message: string, opts?: unknown) => sendTelegramAlert(message, opts),
}));

import { runUpdateGate3ForwardReturnsJob } from './gate3ForwardReturnCron.js';

function baseSeed(overrides: Partial<Gate3OutcomeSeed> = {}): Gate3OutcomeSeed {
  return {
    id: 'gate3-outcome:2026-05-12:005930:scan:READY:vcp',
    symbol: '005930',
    sourceSnapshotId: 'scan:test',
    gate3SnapshotId: 'scan:test:gate3',
    asOf: '2026-05-12T00:00:00.000Z',
    tradeDate: '2026-05-12',
    readiness: 'READY',
    issue: 'vcp',
    route: 'SHADOW_ENTRY_ALLOWED',
    entryReferencePrice: 10_000,
    stopLoss: 9_300,
    targetPrice: 11_500,
    rrr: 2.4,
    priceConfirmation: 'BREAKOUT_CONFIRMED',
    volumeConfirmation: 'CONFIRMED',
    falseBreakoutRisk: 'LOW',
    lastTriggerStatus: 'FIRED',
    learningLabel: 'GATE3_READY_FIRED',
    forwardReturns: { d1: null, d3: null, d5: null, d10: null },
    maxForwardReturnPct: null,
    minForwardReturnPct: null,
    hitTarget: null,
    hitStop: null,
    outcomeStatus: 'PENDING',
    outcomeLabel: null,
    executionImpact: 'NONE',
    marketSignal: false,
    providerIssue: false,
    ...overrides,
  };
}

// 2026-05-12(화) 기준: d1=05-13, d3=05-15, d5=05-19, d10=05-26 영업일.
// 평가 시점 now=2026-05-22 → d1/d3/d5 도달, d10 미도달.
const NOW = new Date('2026-05-22T08:00:00.000Z');

beforeEach(() => {
  ledger = [];
  sendTelegramAlert.mockClear();
  delete process.env.GATE3_FORWARD_RETURN_CRON_ENABLED;
});

afterEach(() => {
  delete process.env.GATE3_FORWARD_RETURN_CRON_ENABLED;
});

describe('runUpdateGate3ForwardReturnsJob', () => {
  it('도달한 horizon(d1/d3/d5)을 갱신하고 미도달 d10 은 유지한다 (Happy path)', async () => {
    ledger = [baseSeed()];

    const res = await runUpdateGate3ForwardReturnsJob({
      now: NOW,
      priceFetcher: async () => 10_800, // +8%
    });

    expect(res.skipped).toBe(false);
    expect(res.pending).toBe(1);
    expect(res.seedsWithDueHorizon).toBe(1);
    expect(res.symbolsQueried).toBe(1);
    expect(res.seedsUpdated).toBe(1);

    const updated = ledger[0];
    expect(updated.forwardReturns.d1).toBeCloseTo(8, 4);
    expect(updated.forwardReturns.d3).toBeCloseTo(8, 4);
    expect(updated.forwardReturns.d5).toBeCloseTo(8, 4);
    expect(updated.forwardReturns.d10).toBeNull(); // 미도달
    expect(updated.marketSignal).toBe(false);
    expect(updated.providerIssue).toBe(false);

    // 갱신 후 schedulerHealthy 회복 방향: d1Updated>0, WARN_FORWARD_RETURN_UPDATE_MISSING 해소.
    const status = buildGate3EvidenceWarmupStatus(ledger, { now: NOW });
    expect(status.d1Updated).toBeGreaterThan(0);
    expect(status.warnings).not.toContain('WARN_FORWARD_RETURN_UPDATE_MISSING');

    expect(sendTelegramAlert).toHaveBeenCalledTimes(1);
  });

  it('종가 조회 실패 시 해당 seed 를 skip 하고 marketSignal 로 변환하지 않는다 (providerIssue, 실패 경로)', async () => {
    ledger = [baseSeed()];

    const res = await runUpdateGate3ForwardReturnsJob({
      now: NOW,
      priceFetcher: async () => {
        throw new Error('KIS 408 timeout');
      },
    });

    expect(res.skipped).toBe(false);
    expect(res.seedsWithDueHorizon).toBe(1);
    expect(res.symbolsFailed).toBe(1);
    expect(res.seedsUpdated).toBe(0);

    // seed 미변경 — 다음 실행 재시도 대상으로 PENDING 유지.
    expect(ledger[0].forwardReturns.d1).toBeNull();
    expect(ledger[0].outcomeStatus).toBe('PENDING');
    expect(ledger[0].marketSignal).toBe(false);
    expect(ledger[0].providerIssue).toBe(false);
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });

  it('갱신 대상 horizon 이 없으면 KIS 호출 0건으로 무음 처리한다', async () => {
    // tradeDate 오늘(now)과 동일 → d1 목표일 미도달.
    ledger = [baseSeed({ tradeDate: '2026-05-22' })];
    const priceFetcher = vi.fn(async () => 10_800);

    const res = await runUpdateGate3ForwardReturnsJob({ now: NOW, priceFetcher });

    expect(res.seedsWithDueHorizon).toBe(0);
    expect(res.seedsUpdated).toBe(0);
    expect(priceFetcher).not.toHaveBeenCalled(); // quota 보호
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });

  it('동일 symbol 다수 seed 는 per-symbol 캐시로 KIS 호출 1회만 수행한다 (quota 보호)', async () => {
    ledger = [
      baseSeed({ id: 'a', issue: 'vcp' }),
      baseSeed({ id: 'b', issue: 'pullback' }),
    ];
    const priceFetcher = vi.fn(async () => 10_500);

    const res = await runUpdateGate3ForwardReturnsJob({ now: NOW, priceFetcher });

    expect(priceFetcher).toHaveBeenCalledTimes(1); // 005930 1회만
    expect(res.symbolsQueried).toBe(1);
    expect(res.seedsUpdated).toBe(2);
  });

  it('ENV GATE3_FORWARD_RETURN_CRON_ENABLED=false 시 즉시 skip (1줄 롤백)', async () => {
    process.env.GATE3_FORWARD_RETURN_CRON_ENABLED = 'false';
    ledger = [baseSeed()];
    const priceFetcher = vi.fn(async () => 10_800);

    const res = await runUpdateGate3ForwardReturnsJob({ now: NOW, priceFetcher });

    expect(res.skipped).toBe(true);
    expect(res.seedsUpdated).toBe(0);
    expect(priceFetcher).not.toHaveBeenCalled();
    expect(ledger[0].forwardReturns.d1).toBeNull();
  });
});
