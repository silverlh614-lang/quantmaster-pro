/**
 * @responsibility ADR-0442 — health.cmd `formatKisWsSubscriptionLines` SSOT + `formatHealthMessage` 통합 회귀.
 *
 * 사용자 명시 1순위 #2 — `/health` compact 라인 wiring (운영자 슬롯 분배 가시화).
 * `formatKisWsSubscriptionSection` (ADR-0437 SSOT) 은 헤더 포함 multi-line section — `/scan_blockers` 용.
 * `/health` 는 별도 컴팩트 헬퍼 (헤더 없이 한 줄 또는 두 줄) 로 압축.
 *
 * 검증:
 *   - formatKisWsSubscriptionLines(undefined) → 빈 문자열
 *   - formatKisWsSubscriptionLines(total=0 정상) → 한 줄 출력
 *   - formatKisWsSubscriptionLines(rejected/evicted 모두 0) → 한 줄만
 *   - formatKisWsSubscriptionLines(rejected>0) → 두 줄 (└ rejected line)
 *   - formatKisWsSubscriptionLines(evicted>0) → 두 줄
 *   - formatHealthMessage 통합: kisWsSubscription 부재 시 라인 미노출
 *   - formatHealthMessage 통합: kisWsSubscription 정상 시 "실시간 슬롯:" 라인 노출
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

const krxRepoMock = vi.hoisted(() => ({
  getMasterSize: vi.fn(() => 2500),
  isMasterStale: vi.fn(() => false),
}));

vi.mock('../../../persistence/krxStockMasterRepo.js', () => krxRepoMock);

import { formatKisWsSubscriptionLines, formatHealthMessage } from './health.cmd.js';
import type { HealthSnapshot, HealthProbeResult } from '../../../health/diagnostics.js';
import type { SubscriptionDiagnosis } from '../../../clients/kisWebSocketSubscriptionManager.js';

function makeSnapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    uptimeHours: '1.0',
    memMB: 128,
    commitSha: 'abc1234',
    watchlistCount: 10,
    activePositions: 0,
    autoTradeEnabled: true,
    autoTradeMode: 'SHADOW',
    emergencyStop: false,
    dailyLossPct: 0,
    dailyLossLimit: 5,
    dailyLossLimitReached: false,
    kisConfigured: true,
    kisTokenHours: 12,
    kisTokenValid: true,
    realDataTokenHours: 0,
    krxTokenConfigured: true,
    krxTokenValid: true,
    krxCircuitState: 'CLOSED',
    krxFailures: 0,
    yahoo: {
      status: 'OK',
      detail: 'HEARTBEAT_OK',
      heartbeat: { lastSuccessAt: 0, lastFailureAt: 0, consecutiveFailures: 0 } as never,
    },
    geminiRuntime: { status: 'IDLE' } as never,
    volume: { ok: true },
    stream: { connected: true, subscribedCount: 5 } as never,
    telegramConfigured: true,
    telegramBotTokenOnly: false,
    telegramChatIdOnly: false,
    lastScanTs: 0,
    lastBuyTs: 0,
    lastScanSummary: null,
    intradayYield: null as unknown as HealthSnapshot['intradayYield'],
    verdict: '🟢 OK',
    ...overrides,
  } as HealthSnapshot;
}

const PROBES: HealthProbeResult = {
  yahoo: { severity: 'OK', message: 'Yahoo probe OK' },
  dart: { severity: 'OK', message: 'DART API 정상 응답' },
};

function makeDiag(overrides: Partial<SubscriptionDiagnosis> = {}): SubscriptionDiagnosis {
  return {
    total: 0,
    limit: 30,
    openPositionCount: 0,
    liveEligibleCount: 0,
    shadowObservableCount: 0,
    watchlistCount: 0,
    observeOnlyCount: 0,
    invalidRejectedCount: 0,
    lowPriorityRejectedCount: 0,
    evictedCount: 0,
    ...overrides,
  };
}

describe('ADR-0442 formatKisWsSubscriptionLines — compact 형식 SSOT', () => {
  it('diag undefined → 빈 문자열 (라인 미노출)', () => {
    expect(formatKisWsSubscriptionLines(undefined)).toBe('');
  });

  it('diag.total=0 정상 → 한 줄 ("실시간 슬롯: 0/30 (open 0 / live 0 / shadow 0 / watch 0 / observe 0)")', () => {
    const out = formatKisWsSubscriptionLines(makeDiag({ total: 0 }));
    expect(out).toBe('실시간 슬롯: 0/30 (open 0 / live 0 / shadow 0 / watch 0 / observe 0)');
    expect(out.split('\n').length).toBe(1);
  });

  it('rejected/evicted 모두 0 → 한 줄만 (└ rejected line 미노출)', () => {
    const out = formatKisWsSubscriptionLines(
      makeDiag({
        total: 12,
        openPositionCount: 2,
        liveEligibleCount: 3,
        shadowObservableCount: 4,
        watchlistCount: 2,
        observeOnlyCount: 1,
      }),
    );
    expect(out).toContain('실시간 슬롯: 12/30');
    expect(out).toContain('open 2');
    expect(out).toContain('live 3');
    expect(out).toContain('shadow 4');
    expect(out).toContain('watch 2');
    expect(out).toContain('observe 1');
    expect(out.split('\n').length).toBe(1);
    expect(out).not.toContain('rejected');
    expect(out).not.toContain('evicted');
  });

  it('rejected (lowPriority) > 0 → 두 줄 (└ rejected N | evicted M)', () => {
    const out = formatKisWsSubscriptionLines(
      makeDiag({
        total: 30,
        openPositionCount: 2,
        liveEligibleCount: 5,
        shadowObservableCount: 8,
        watchlistCount: 10,
        observeOnlyCount: 5,
        lowPriorityRejectedCount: 12,
        invalidRejectedCount: 0,
        evictedCount: 0,
      }),
    );
    const lines = out.split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('실시간 슬롯: 30/30');
    expect(lines[1]).toContain('└ rejected 12');
    expect(lines[1]).toContain('evicted 0');
  });

  it('invalidRejected + lowPriorityRejected 합산 표시', () => {
    const out = formatKisWsSubscriptionLines(
      makeDiag({
        total: 25,
        invalidRejectedCount: 3,
        lowPriorityRejectedCount: 7,
        evictedCount: 0,
      }),
    );
    const lines = out.split('\n');
    expect(lines.length).toBe(2);
    // 합산: 3 + 7 = 10
    expect(lines[1]).toContain('rejected 10');
  });

  it('evicted > 0 (rejected=0) → 두 줄 (rejected 0 | evicted N)', () => {
    const out = formatKisWsSubscriptionLines(
      makeDiag({
        total: 30,
        evictedCount: 4,
        invalidRejectedCount: 0,
        lowPriorityRejectedCount: 0,
      }),
    );
    const lines = out.split('\n');
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('rejected 0');
    expect(lines[1]).toContain('evicted 4');
  });

  it('rejected + evicted 모두 양수 → 두 줄 합산 표시', () => {
    const out = formatKisWsSubscriptionLines(
      makeDiag({
        total: 30,
        invalidRejectedCount: 1,
        lowPriorityRejectedCount: 5,
        evictedCount: 2,
      }),
    );
    const lines = out.split('\n');
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('rejected 6');
    expect(lines[1]).toContain('evicted 2');
  });
});

describe('ADR-0442 formatHealthMessage 통합 — kisWsSubscription wiring', () => {
  beforeEach(() => {
    krxRepoMock.getMasterSize.mockReturnValue(2500);
    krxRepoMock.isMasterStale.mockReturnValue(false);
  });

  it('kisWsSubscription 부재 → "실시간 슬롯:" 라인 미노출', () => {
    const msg = formatHealthMessage(makeSnapshot({ kisWsSubscription: undefined }), PROBES);
    expect(msg).not.toContain('실시간 슬롯:');
  });

  it('kisWsSubscription 정상 → "실시간 슬롯:" 라인 노출 + 카운트 정합', () => {
    const diag = makeDiag({
      total: 15,
      openPositionCount: 2,
      liveEligibleCount: 4,
      shadowObservableCount: 6,
      watchlistCount: 2,
      observeOnlyCount: 1,
    });
    const msg = formatHealthMessage(makeSnapshot({ kisWsSubscription: diag }), PROBES);
    expect(msg).toContain('실시간 슬롯: 15/30');
    expect(msg).toContain('open 2');
    expect(msg).toContain('live 4');
  });

  it('kisWsSubscription 정상 + rejected > 0 → "└ rejected" 라인 노출', () => {
    const diag = makeDiag({
      total: 30,
      openPositionCount: 2,
      lowPriorityRejectedCount: 8,
    });
    const msg = formatHealthMessage(makeSnapshot({ kisWsSubscription: diag }), PROBES);
    expect(msg).toContain('실시간 슬롯: 30/30');
    expect(msg).toContain('└ rejected 8');
  });
});
