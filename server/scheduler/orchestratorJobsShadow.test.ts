// @responsibility Verify independent Shadow scheduling.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mode: 'SHADOW', paused: false, emergency: true,
  scheduled: vi.fn(), cron: vi.fn(), recordRun: vi.fn(),
  scan: vi.fn(), tick: vi.fn(), heartbeat: vi.fn(),
  dailyLoss: vi.fn(), killSwitch: vi.fn(),
}));
vi.mock('node-cron', () => ({ default: { schedule: mocks.cron } }));
vi.mock('./scheduleCatalog.js', () => ({ recordScheduleRun: mocks.recordRun }));
vi.mock('../learning/missedLearningQueue.js', () => ({
  enqueueMissedLearningJob: vi.fn(), isMissedLearningQueueEnabled: () => false,
}));
vi.mock('./scheduleGuard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scheduleGuard.js')>();
  return { ...actual, scheduledJob: mocks.scheduled.mockImplementation(actual.scheduledJob) };
});
vi.mock('../state.js', () => ({
  getTradingMode: () => mocks.mode,
  getAutoTradePaused: () => mocks.paused,
  getEmergencyStop: () => mocks.emergency,
  touchHeartbeat: mocks.heartbeat,
}));
vi.mock('../trading/paper/paperExperimentRunner.js', () => ({ runPaperExperimentScan: mocks.scan }));
vi.mock('../orchestrator/tradingOrchestrator.js', () => ({ tradingOrchestrator: { tick: mocks.tick } }));
vi.mock('../alerts/telegramClient.js', () => ({ sendTelegramAlert: vi.fn() }));
vi.mock('../alerts/alertNoisePolicy.js', () => ({ evaluateAlertNoise: vi.fn() }));
vi.mock('../emergency.js', () => ({ checkDailyLossLimit: mocks.dailyLoss }));
vi.mock('../trading/killSwitch.js', () => ({ runKillSwitchCheck: mocks.killSwitch }));
vi.mock('../clients/kisClient.js', () => ({ forceRefreshKisTokens: vi.fn() }));
import { registerOrchestratorJobs } from './orchestratorJobs.js';

const callback = (name: string): (() => Promise<void>) => {
  const registration = mocks.scheduled.mock.calls.find(call => call[2] === name);
  if (!registration) throw new Error(`Missing schedule ${name}`);
  return registration[3];
};

describe('Shadow schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mode = 'SHADOW'; mocks.paused = false; mocks.emergency = true;
    mocks.scan.mockResolvedValue({}); mocks.tick.mockResolvedValue(undefined);
    registerOrchestratorJobs();
  });

  it('runs independently of legacy emergency and trading-day restrictions', async () => {
    expect(mocks.scheduled).toHaveBeenCalledWith(
      '* * * * *', 'ALWAYS_ON', 'paper_experiments', expect.any(Function), { timezone: 'UTC', recoverMissedExecutions: true },
    );
    expect(mocks.cron.mock.calls.filter(call => call[2]?.recoverMissedExecutions)).toHaveLength(1);
    await callback('paper_experiments')();
    expect(mocks.scan).toHaveBeenCalledOnce();
    expect(mocks.tick).not.toHaveBeenCalled();
    expect(mocks.dailyLoss).not.toHaveBeenCalled();
    expect(mocks.killSwitch).not.toHaveBeenCalled();
  });

  it('does not run Shadow again from the legacy market schedule', async () => {
    await callback('orchestrator_tick')();
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.tick).not.toHaveBeenCalled();
  });

  it('honors explicit pause', async () => {
    mocks.paused = true;
    await callback('paper_experiments')();
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it.each(['LIVE', 'PAPER'])('preserves virtual signals and research in %s without invoking broker orchestration', async mode => {
    mocks.mode = mode;
    await callback('paper_experiments')();
    expect(mocks.scan).toHaveBeenCalledOnce();
    expect(mocks.tick).not.toHaveBeenCalled();
    expect(mocks.dailyLoss).not.toHaveBeenCalled();
    expect(mocks.killSwitch).not.toHaveBeenCalled();
  });

  it('records a failed Shadow scan and resumes next tick without a legacy fallback', async () => {
    mocks.scan.mockRejectedValueOnce(new Error('collector failed'));
    const registration = mocks.cron.mock.calls.find(call => call[0] === '* * * * *');
    expect(registration).toBeDefined();
    const tick = registration![1] as () => Promise<void>;
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(tick()).resolves.toBeUndefined();
      expect(mocks.recordRun).toHaveBeenLastCalledWith(expect.objectContaining({
        jobName: 'paper_experiments', status: 'failure', note: 'collector failed',
      }));
      await expect(tick()).resolves.toBeUndefined();
      expect(mocks.recordRun).toHaveBeenLastCalledWith(expect.objectContaining({
        jobName: 'paper_experiments', status: 'success',
      }));
      expect(mocks.recordRun).toHaveBeenCalledTimes(2);
      expect(mocks.scan).toHaveBeenCalledTimes(2);
      expect(mocks.tick).not.toHaveBeenCalled();
      expect(mocks.dailyLoss).not.toHaveBeenCalled();
      expect(mocks.killSwitch).not.toHaveBeenCalled();
    } finally { errorLog.mockRestore(); }
  });
});
