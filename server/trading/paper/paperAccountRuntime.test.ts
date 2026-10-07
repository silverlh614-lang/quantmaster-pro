// @responsibility Verify isolated account failures preserve signal processing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperAccountLedger } from '../../../src/types/paperAccount.js';
import { createPaperAccount } from './paperAccount.js';
import { legacyStrategyLedger, strategyTestSnapshot } from './paperStrategyFixtures.js';
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('../../persistence/paperAccountRepo.js', () => ({ loadPaperAccount: mocks.load, savePaperAccount: mocks.save }));
import { captureVirtualAccount, readVirtualAccount, startVirtualAccount, pauseVirtualAccountBuys, virtualAccountHoldings } from './paperAccountRuntime.js';

beforeEach(() => { vi.resetAllMocks(); mocks.load.mockReturnValue(null); });
describe('virtual account runtime', () => {
  it('does not auto-create an account or alter source signals', () => {
    const ledger = legacyStrategyLedger(), original = JSON.stringify(ledger);
    captureVirtualAccount(ledger, strategyTestSnapshot());
    expect(mocks.save).not.toHaveBeenCalled(); expect(JSON.stringify(ledger)).toBe(original);
  });
  it('reports persistence failure without throwing into baseline or strategy processing', () => {
    const account = createPaperAccount({ initialCash: 10000, maxPositionPct: 20, includeExploration: false }, '2026-09-18T00:59:00Z', 'id');
    mocks.load.mockReturnValue(account); mocks.save.mockImplementationOnce(() => { throw new Error('disk full'); });
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => captureVirtualAccount(legacyStrategyLedger(), strategyTestSnapshot())).not.toThrow();
      expect(readVirtualAccount().error).toContain('disk full'); expect(account.lastSnapshotAt).toBeNull(); expect(logger).toHaveBeenCalled();
      captureVirtualAccount(legacyStrategyLedger(), strategyTestSnapshot());
      expect(readVirtualAccount().error).toBeUndefined();
    } finally { logger.mockRestore(); }
  });
  it('retains account configuration across pauses and prevents resetting an existing account', () => {
    mocks.save.mockImplementation((account: PaperAccountLedger) => mocks.load.mockReturnValue(structuredClone(account)));
    const config = { initialCash: 10000, maxPositionPct: 20, includeExploration: false }, now = new Date('2026-09-18T01:00:00Z');
    const created = startVirtualAccount(config, now);
    expect(() => startVirtualAccount(config, now)).toThrow('VIRTUAL_ACCOUNT_EXISTS');
    const paused = pauseVirtualAccountBuys(created.account!.id, true, now);
    expect(paused.account).toMatchObject({ config, buyPaused: true, controls: [{ at: now.toISOString(), buyPaused: true }] });
    expect(virtualAccountHoldings()).toEqual([]);
  });
});
