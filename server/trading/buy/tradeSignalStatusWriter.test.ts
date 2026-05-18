import { beforeEach, describe, expect, it, vi } from 'vitest';

const markAutoTradeReadyRepo = vi.fn();
const markBlockedRepo = vi.fn();
const emitOperationalWarn = vi.fn();

vi.mock('../../persistence/tradeSignalStatusRepo.js', () => ({
  markAutoTradeReady: markAutoTradeReadyRepo,
  markBlocked: markBlockedRepo,
}));

vi.mock('./operationalWarn.js', () => ({
  emitOperationalWarn,
}));

describe('tradeSignalStatusWriter', () => {
  beforeEach(() => {
    vi.resetModules();
    markAutoTradeReadyRepo.mockReset();
    markBlockedRepo.mockReset();
    emitOperationalWarn.mockReset();
  });

  it('skips writes without signalId without breaking execution lifecycle', async () => {
    const writer = await import('./tradeSignalStatusWriter.js');

    expect(writer.markAutoTradeReady({ reason: 'no id' })).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'SIGNAL_ID_MISSING',
    });
    expect(markAutoTradeReadyRepo).not.toHaveBeenCalled();
  });

  it('emits P0_BUY_STATUS_WRITE_FAILED when an important write throws', async () => {
    markAutoTradeReadyRepo.mockImplementation(() => {
      throw new Error('disk failed');
    });
    const writer = await import('./tradeSignalStatusWriter.js');

    const result = writer.markAutoTradeReady({
      signalId: 'sig-1',
      reason: 'ready',
    });

    expect(result.ok).toBe(false);
    expect(emitOperationalWarn).toHaveBeenCalledWith(expect.objectContaining({
      code: 'P0_BUY_STATUS_WRITE_FAILED',
    }));
  });

  it('maps rejected signals through the legacy BLOCKED state', async () => {
    markBlockedRepo.mockReturnValue({ id: 'sig-1', status: 'BLOCKED' });
    const writer = await import('./tradeSignalStatusWriter.js');

    const result = writer.markRejected({
      signalId: 'sig-1',
      reason: 'user reject',
    });

    expect(result.ok).toBe(true);
    expect(markBlockedRepo).toHaveBeenCalledWith({
      id: 'sig-1',
      gate: 'USER_REJECT',
      reason: 'user reject',
      now: undefined,
    });
  });
});
