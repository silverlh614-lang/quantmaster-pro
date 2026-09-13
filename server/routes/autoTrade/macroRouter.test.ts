// @responsibility Verify retired regime writes cannot mutate market data or send policy alerts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), refresh: vi.fn() }));
vi.mock('../../persistence/macroStateRepo.js', () => ({ loadMacroState: mocks.load, saveMacroState: mocks.save }));
vi.mock('../../persistence/fssRepo.js', () => ({ loadFssRecords: vi.fn(), upsertFssRecord: vi.fn() }));
vi.mock('../../trading/marketDataRefresh.js', () => ({ refreshMarketRegimeVars: mocks.refresh }));
import router from './macroRouter.js';
async function run(path: string, method: string, body = {}) {
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.stack.some(entry => entry.method === method))?.route;
  if (!route) throw new Error(`Missing ${method} ${path}`);
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await route.stack[0].handle({ body } as Request, res as unknown as Response, vi.fn());
  return res;
}
beforeEach(() => vi.clearAllMocks());
describe('regime retirement and data preservation', () => {
  it('rejects old regime writes without touching the saved market data', async () => {
    const res = await run('/macro/state', 'post', { mhs: 1, regime: 'RED', bearDefenseMode: true });
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'REGIME_RETIRED' }));
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('serves raw market data without presenting a stored legacy regime as current', async () => {
    mocks.load.mockReturnValue({ regime: 'RED', bearDefenseMode: true, bearRegimeTriggeredCount: 3, ips: 75, kospiDayReturn: -2, updatedAt: '2026-09-13' });
    const res = await run('/macro/state', 'get');
    expect(res.json).toHaveBeenCalledWith({ kospiDayReturn: -2, updatedAt: '2026-09-13', regimeStatus: 'RETIRED' });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('keeps explicit market-data refresh available', async () => {
    mocks.refresh.mockResolvedValue({ kospiDayReturn: 1 });
    const res = await run('/macro/refresh', 'get');
    expect(mocks.refresh).toHaveBeenCalledWith('MANUAL');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, computed: { kospiDayReturn: 1 } }));
  });
});
