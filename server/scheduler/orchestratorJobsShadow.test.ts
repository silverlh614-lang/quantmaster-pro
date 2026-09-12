// @responsibility Verify independent Shadow scheduling.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mode: 'SHADOW', paused: false, emergency: true,
  scheduled: vi.fn(), scan: vi.fn(), tick: vi.fn(), heartbeat: vi.fn(),
  dailyLoss: vi.fn(), killSwitch: vi.fn(),
}));
vi.mock('./scheduleGuard.js', () => ({ scheduledJob: mocks.scheduled }));
vi.mock('../state.js', () => ({
  getTradingMode: () => mocks.mode,
  getAutoTradePaused: () => mocks.paused,
  getEmergencyStop: () => mocks.emergency,
  touchHeartbeat: mocks.heartbeat,
}));
vi.mock('../trading/scanDispatcher.js', () => ({ runAutoSignalScan: mocks.scan }));
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
      '* * * * *', 'ALWAYS_ON', 'paper_experiments', expect.any(Function), { timezone: 'UTC' },
    );
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

  it.each(['LIVE', 'PAPER'])('does not create experiments from the %s schedule', async mode => {
    mocks.mode = mode;
    await callback('paper_experiments')();
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it('contains a paper failure without invoking a legacy fallback', async () => {
    mocks.scan.mockRejectedValue(new Error('collector failed'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(callback('paper_experiments')()).resolves.toBeUndefined();
      expect(warning).toHaveBeenCalledWith('[PaperExperiments] scan failed:', 'collector failed');
      expect(mocks.tick).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });
});
