// @responsibility Verify engine activity comes from current observation and strategy ledgers while control meanings stay unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const mocks = vi.hoisted(() => ({
  baseline: vi.fn(), strategy: vi.fn(), emergency: false, paused: false, mode: 'LIVE',
  setEmergency: vi.fn(), setPaused: vi.fn(), setBlock: vi.fn(), setManage: vi.fn(),
  legacyScan: vi.fn(() => { throw new Error('LEGACY_SCAN_RETIRED'); }),
  legacyTrades: vi.fn(() => { throw new Error('LEGACY_TRADES_RETIRED'); }),
}));
vi.mock('../../persistence/paperExperimentRepo.js', () => ({ loadPaperExperimentLedger: mocks.baseline }));
vi.mock('../../persistence/paperStrategyRepo.js', () => ({ loadPaperStrategyLedger: mocks.strategy }));
vi.mock('../../persistence/shadowTradeRepo.js', () => ({ loadShadowTrades: mocks.legacyTrades }));
vi.mock('../../orchestrator/adaptiveScanScheduler.js', () => ({ getLastScanAt: mocks.legacyScan }));
vi.mock('../../state.js', () => ({
  getEmergencyStop: () => mocks.emergency, setEmergencyStop: mocks.setEmergency,
  getAutoTradePaused: () => mocks.paused, setAutoTradePaused: mocks.setPaused,
  getTradingMode: () => mocks.mode, getLastHeartbeat: () => 0, getLastHeartbeatSource: () => null,
  getKillSwitchLast: () => null, getManualBlockNewBuy: () => false, setManualBlockNewBuy: mocks.setBlock,
  getManualManageOnly: () => false, setManualManageOnly: mocks.setManage,
}));
vi.mock('../../orchestrator/tradingOrchestrator.js', () => ({ tradingOrchestrator: { getStatus: () => ({
  computedState: 'REGULAR', handlerRanAt: { oldTick: '1999-01-01T00:00:00Z' },
}) } }));
vi.mock('../../trading/killSwitch.js', () => ({ assessKillSwitch: () => ({ triggered: false }) }));
vi.mock('../../clients/kisStreamClient.js', () => ({ isStreamConnected: () => true }));
vi.mock('../engineStreamBus.js', () => ({ attachEngineStream: vi.fn(), publishEngineStatus: vi.fn() }));
vi.mock('../../persistence/alertsFeedRepo.js', () => ({ listAlertFeed: vi.fn(), countUnreadSince: vi.fn() }));
vi.mock('../../alerts/alertAuditLog.js', () => ({ readAlertAuditRange: vi.fn() }));
vi.mock('../../alerts/weeklyHygieneAudit.js', () => ({ computeWeeklyHygiene: vi.fn() }));
vi.mock('../../alerts/ackTracker.js', () => ({ countPendingAcks: vi.fn(), listPendingAcks: vi.fn() }));
vi.mock('../../alerts/adrGapCalculator.js', () => ({ getLatestAdrGapState: vi.fn() }));
vi.mock('../../alerts/preMarketSignal.js', () => ({ getLatestPreMarketReport: vi.fn() }));
vi.mock('../../alerts/dxyMonitor.js', () => ({ getLatestDxyReport: vi.fn() }));
vi.mock('../../alerts/sectorEtfMomentum.js', () => ({ getLatestSectorEtfReport: vi.fn() }));
import router, { buildEngineStatusSnapshot } from './engineRouter.js';
const NOW = new Date('2026-09-13T15:03:00.000Z'); // KST 09/14 00:03
const LAST = '2026-09-13T15:02:00.000Z';
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTO_TRADE_ENABLED', 'true');
  mocks.emergency = false; mocks.paused = false; mocks.mode = 'LIVE';
  mocks.baseline.mockReturnValue({ schemaVersion: 1, experiments: [{ tradingDate: '2026-09-14' }], lastRun: { asOf: LAST } });
  mocks.strategy.mockReturnValue({ schemaVersion: 1, lastRun: { asOf: LAST }, latestDecisions: [], trades: [
    { id: 'opened-today', entryAt: '2026-09-13T15:01:00Z', status: 'OPEN', exit: null },
    { id: 'closed-today', entryAt: '2026-09-12T02:00:00Z', status: 'CLOSED', exit: { effectiveAt: '2026-09-13T15:00:00Z', decisionAt: LAST } },
    { id: 'closed-yesterday-observed-today', entryAt: '2026-09-11T02:00:00Z', status: 'CLOSED', exit: { effectiveAt: '2026-09-13T14:59:00Z', decisionAt: LAST } },
  ] });
});
afterEach(() => vi.unstubAllEnvs());
async function post(path: string) {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.stack.some((entry) => entry.method === 'post'))?.route;
  if (!route) throw new Error(`Missing POST ${path}`);
  const res = { json: vi.fn() };
  await route.stack[0].handle({ body: {} } as Request, res as unknown as Response, vi.fn());
  return res;
}

describe('current paper activity snapshot', () => {
  it('uses persisted observation time and actual virtual trade events across the KST date boundary', () => {
    const status = buildEngineStatusSnapshot(NOW);
    expect(status).toMatchObject({ lastRun: LAST, lastScanAt: LAST, lastBuySignalAt: '2026-09-13T15:01:00.000Z',
      activitySource: 'PAPER_STRATEGY', observationsRunning: true, observationStatus: 'ACTIVE', observationAgeMs: 60000,
      todayStats: { scans: null, scanCountAvailable: false, buys: 1, exits: 1 } });
    expect(mocks.baseline).toHaveBeenCalledOnce();
    expect(mocks.strategy).toHaveBeenCalledOnce();
    expect(mocks.legacyScan).not.toHaveBeenCalled();
    expect(mocks.legacyTrades).not.toHaveBeenCalled();
    expect(mocks.setEmergency).not.toHaveBeenCalled();
  });
  it('separates healthy observations from disabled live engine controls', () => {
    vi.stubEnv('AUTO_TRADE_ENABLED', 'false'); mocks.emergency = true;
    expect(buildEngineStatusSnapshot(NOW)).toMatchObject({ running: false, emergencyStop: true, observationsRunning: true, mode: 'LIVE' });
  });
  it('marks a soft pause without erasing the last successful activity', () => {
    mocks.paused = true;
    expect(buildEngineStatusSnapshot(NOW)).toMatchObject({ observationsRunning: false, observationStatus: 'PAUSED', lastScanAt: LAST });
  });
  it('does not call old scan handlers active when the new ledger has never run', () => {
    mocks.baseline.mockReturnValue({ schemaVersion: 1, experiments: [], lastRun: null });
    mocks.strategy.mockReturnValue({ schemaVersion: 1, trades: [], latestDecisions: [], lastRun: null });
    expect(buildEngineStatusSnapshot(NOW)).toMatchObject({ lastRun: null, lastScanAt: null, lastBuySignalAt: null,
      observationsRunning: false, observationStatus: 'WAITING', todayStats: { scans: null, buys: 0, exits: 0 } });
  });
  it('reports old completed observations as stale', () => {
    expect(buildEngineStatusSnapshot(new Date('2026-09-13T15:13:00Z'))).toMatchObject({ observationsRunning: false, observationStatus: 'STALE' });
  });
  it('reports an unreadable strategy ledger without replacing unknown counts with zero', () => {
    mocks.strategy.mockImplementation(() => { throw new Error('damaged strategy ledger'); });
    expect(buildEngineStatusSnapshot(NOW)).toMatchObject({ observationsRunning: true, lastScanAt: LAST,
      activityErrors: ['PAPER_STRATEGY_LEDGER_UNREADABLE'], todayStats: { buys: null, exits: null } });
  });
  it('keeps readable strategy events when the observation ledger is unavailable', () => {
    mocks.baseline.mockImplementation(() => { throw new Error('damaged baseline ledger'); });
    expect(buildEngineStatusSnapshot(NOW)).toMatchObject({ observationsRunning: false, observationStatus: 'UNAVAILABLE',
      activityErrors: ['PAPER_EXPERIMENT_LEDGER_UNREADABLE'], todayStats: { buys: 1, exits: 1 } });
  });
});

describe('existing control meaning', () => {
  it('toggle still changes the emergency stop only', async () => {
    const res = await post('/auto-trade/engine/toggle');
    expect(mocks.setEmergency).toHaveBeenCalledWith(true);
    expect(mocks.setPaused).not.toHaveBeenCalled();
    expect(mocks.setBlock).not.toHaveBeenCalled();
    expect(mocks.setManage).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ running: false, emergencyStop: true });
  });
  it('emergency-stop remains an unconditional stop, never a toggle', async () => {
    mocks.emergency = true;
    const res = await post('/auto-trade/engine/emergency-stop');
    expect(mocks.setEmergency).toHaveBeenCalledWith(true);
    expect(res.json).toHaveBeenCalledWith({ running: false, emergencyStop: true });
  });
});
