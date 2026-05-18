import { afterEach, describe, expect, it, vi } from 'vitest';

import { readPaperTradePositions } from './paperTradePositionReader.js';

describe('paperTradePositionReader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps an unconfigured paper ledger as EMPTY, not FAILED', async () => {
    await expect(readPaperTradePositions()).resolves.toMatchObject({
      source: 'PaperTradeLedger',
      kind: 'EMPTY',
    });
  });

  it('emits P0_PAPER_LEDGER_POSITION_FAILED when the paper ledger reader fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await readPaperTradePositions({
      loadPaperPositions: () => {
        throw new Error('paper read failed');
      },
    });

    expect(result).toMatchObject({
      source: 'PaperTradeLedger',
      kind: 'FAILED',
      executionImpact: 'POSITION_QUERY_DEGRADED',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_PAPER_LEDGER_POSITION_FAILED]'),
      expect.objectContaining({ code: 'P0_PAPER_LEDGER_POSITION_FAILED' }),
    );
  });
});
