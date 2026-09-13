// @responsibility Verify retired empty-scan diagnostics do not execute the old regime classifier.
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const mocks = vi.hoisted(() => ({
  runPostmortem: vi.fn(() => { throw new Error('REGIME_CLASSIFIER_MUST_NOT_RUN'); }),
}));
vi.mock('../orchestrator/emptyScanPostmortem.js', () => ({
  runPostmortem: mocks.runPostmortem,
  getLastPostmortemReport: vi.fn(),
  getEmptyScanCount: vi.fn(),
}));
import router from './diagnosticRouter.js';

describe('retired empty-scan diagnostic endpoint', () => {
  it('returns 410 without classifying the current market or running old policy', async () => {
    const route = router.stack.find(layer => layer.route?.path === '/diagnostics/empty-scan-postmortem')?.route;
    expect(route).toBeDefined();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await route!.stack[0].handle({} as Request, res as unknown as Response, vi.fn());
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'REGIME_RETIRED' }));
    expect(mocks.runPostmortem).not.toHaveBeenCalled();
  });
});
