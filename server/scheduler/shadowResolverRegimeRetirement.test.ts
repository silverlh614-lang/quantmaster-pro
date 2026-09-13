// @responsibility Verify the retained historical Shadow resolver runs without regime access and preserves loss-streak execution safety.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  tick: undefined as (() => Promise<void>) | undefined,
  trades: [] as Array<Record<string, unknown>>,
  update: vi.fn(async () => {}), save: vi.fn(), regime: vi.fn(), downgrade: vi.fn(),
  hold: vi.fn(), emergency: vi.fn(), trip: vi.fn(), send: vi.fn(async () => 1), warn: vi.fn(),
}));
vi.mock('./scheduleGuard.js', () => ({ scheduledJob: (_cron: string, _policy: string, _name: string, fn: () => Promise<void>) => { boundary.tick = fn; } }));
vi.mock('../alerts/telegramClient.js', () => ({ sendTelegramAlert: boundary.send }));
vi.mock('../persistence/shadowTradeRepo.js', () => ({ loadShadowTrades: () => boundary.trades, saveShadowTrades: boundary.save }));
vi.mock('../trading/exitEngine.js', () => ({ updateShadowResults: boundary.update }));
vi.mock('../trading/entryEngine.js', () => ({ isOpenShadowStatus: (status: string) => status === 'ACTIVE' }));
vi.mock('../trading/regime/canonicalRegimeAccess.js', () => ({ resolveCanonicalRegimeLevel: boundary.regime }));
vi.mock('../state.js', () => ({ setEmergencyStop: boundary.emergency }));
vi.mock('../calendar/krxTradingCalendar.js', () => ({ isKrxTradingDay: () => true, toKstDateKey: () => '2026-09-14' }));
vi.mock('../observability/operationalWarn.js', () => ({ emitOperationalWarn: boundary.warn }));
vi.mock('../learning/learningState.js', () => ({
  getCircuitBreakerTrippedAt: () => null, getCircuitBreakerClearedAt: () => null,
  isTradingHeld: () => false, isForcedRegimeDowngradeActive: () => false,
  setForcedRegimeDowngrade: boundary.downgrade, setTradingHold: boundary.hold, tripCircuitBreaker: boundary.trip,
}));
import { registerShadowResolverJob } from './shadowResolverJob.js';

beforeEach(() => {
  vi.clearAllMocks();
  boundary.trades = [{ id: 'open-legacy', stockCode: '005930', mode: 'SHADOW', status: 'ACTIVE', entryRegime: 'R2_BULL' }];
  registerShadowResolverJob();
});

function addLosses(count: number): void {
  for (let i = 0; i < count; i++) boundary.trades.push({ status: 'HIT_STOP', exitOutcome: 'LOSS', exitTime: new Date(Date.now() - i * 1000).toISOString() });
}

describe('historical Shadow outcome job without regime policy', () => {
  it('still resolves and saves open historical entries without asking for a current regime', async () => {
    await boundary.tick!();
    expect(boundary.update).toHaveBeenCalledExactlyOnceWith(boundary.trades);
    expect(boundary.save).toHaveBeenCalledExactlyOnceWith(boundary.trades);
    expect(boundary.trades[0].entryRegime).toBe('R2_BULL');
    expect(boundary.regime).not.toHaveBeenCalled();
  });

  it('preserves the two-loss trading hold without a forced regime downgrade', async () => {
    addLosses(2);
    await boundary.tick!();
    expect(boundary.hold).toHaveBeenCalledExactlyOnceWith(30 * 60 * 1000);
    expect(boundary.downgrade).not.toHaveBeenCalled();
    expect(boundary.emergency).not.toHaveBeenCalled();
    expect(boundary.regime).not.toHaveBeenCalled();
  });

  it('preserves the three-loss emergency stop and operational warning', async () => {
    addLosses(3);
    await boundary.tick!();
    expect(boundary.trip).toHaveBeenCalledOnce();
    expect(boundary.emergency).toHaveBeenCalledExactlyOnceWith(true);
    expect(boundary.warn).toHaveBeenCalledWith(expect.objectContaining({ executionImpact: 'LIVE_ORDER_BLOCKED' }));
    expect(boundary.downgrade).not.toHaveBeenCalled();
  });
});
