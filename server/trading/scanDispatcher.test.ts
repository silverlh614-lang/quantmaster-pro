// @responsibility Verify mode-based scan routing.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ mode: 'SHADOW', paper: vi.fn(), legacy: vi.fn() }));
vi.mock('../state.js', () => ({ getTradingMode: () => mocks.mode }));
vi.mock('./paper/paperExperimentRunner.js', () => ({ runPaperExperimentScan: mocks.paper }));
vi.mock('./signalScanner/index.js', () => ({ runAutoSignalScan: mocks.legacy }));
import { runAutoSignalScan } from './scanDispatcher.js';

describe('regime-free scan dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mode = 'SHADOW';
    mocks.paper.mockResolvedValue({ snapshotId: 'paper-1', openedCount: 2 });
    mocks.legacy.mockResolvedValue({ positionFull: true });
  });

  it('routes Shadow to paper without invoking legacy preflight or approval', async () => {
    expect(await runAutoSignalScan({ sellOnly: true })).toEqual({
      paperExperiment: { snapshotId: 'paper-1', openedCount: 2 },
    });
    expect(mocks.paper).toHaveBeenCalledOnce();
    expect(mocks.legacy).not.toHaveBeenCalled();
  });

  it.each(['LIVE', 'PAPER', 'MANUAL'])('keeps %s signals running without the retired regime/Kelly scanner', async mode => {
    mocks.mode = mode;
    const options = { forceBuyCodes: ['005930'] };
    expect(await runAutoSignalScan(options)).toEqual({ paperExperiment: { snapshotId: 'paper-1', openedCount: 2 } });
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(mocks.paper).toHaveBeenCalledOnce();
  });

  it('reports paper failures without falling back to broker execution', async () => {
    mocks.paper.mockRejectedValue(new Error('observation unavailable'));
    await expect(runAutoSignalScan()).rejects.toThrow('observation unavailable');
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
});
