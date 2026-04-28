/**
 * @responsibility shadowWalkForward router 단위 테스트 — ADR-0086
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  WalkForwardResults,
  WalkForwardWindow,
} from '../persistence/walkForwardResultsRepo.js';

vi.mock('../persistence/shadowWalkForwardResultsRepo.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../persistence/shadowWalkForwardResultsRepo.js',
  );
  return {
    ...actual,
    loadShadowWalkForwardResults: vi.fn(),
  };
});

vi.mock('../learning/shadowWalkForwardFramework.js', () => ({
  isShadowFrameworkDisabled: vi.fn(),
  runShadowWalkForward: vi.fn(),
}));

import * as repo from '../persistence/shadowWalkForwardResultsRepo.js';
import * as framework from '../learning/shadowWalkForwardFramework.js';
import learningRouter from './learningRouter.js';

const mockedLoad = vi.mocked(repo.loadShadowWalkForwardResults);
const mockedDisabled = vi.mocked(framework.isShadowFrameworkDisabled);
const mockedRun = vi.mocked(framework.runShadowWalkForward);

interface MockRes {
  statusCode: number;
  body: unknown;
  status(code: number): MockRes;
  json(payload: unknown): MockRes;
}

function makeRes(): MockRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
}

interface RouteHandler {
  (req: { query: Record<string, unknown> }, res: MockRes): void | Promise<void>;
}

function findHandler(method: string, path: string): RouteHandler {
  const stack = (learningRouter as unknown as { stack: Array<{
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RouteHandler }> };
  }> }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route.methods[method.toLowerCase()]) {
      return layer.route.stack[0].handle;
    }
  }
  throw new Error(`route ${method} ${path} not found`);
}

function makeWindow(degradation: number, ts: string): WalkForwardWindow {
  return {
    windowId: `shadow_${ts}`,
    inSampleStart: '2026-01-01', inSampleEnd: '2026-03-01',
    outSampleStart: '2026-03-01', outSampleEnd: '2026-04-01',
    isMetrics: { sampleSize: 20, winRate: 0.6, avgReturn: 1.5, totalReturn: 12, sharpe: 0.4, maxDrawdown: 5 },
    oosMetrics: { sampleSize: 10, winRate: 0.5, avgReturn: 1.0, totalReturn: 6, sharpe: 0.3, maxDrawdown: 4 },
    degradation,
    computedAt: ts,
  };
}

describe('learningRouter — shadow-walk-forward (ADR-0086)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.clearAllMocks(); });

  describe('GET /shadow-walk-forward', () => {
    it('정상 응답 — windows + summary + disabled', () => {
      mockedDisabled.mockReturnValue(false);
      const results: WalkForwardResults = {
        schemaVersion: 1, generatedAt: '2026-04-28T00:00:00Z',
        windows: [makeWindow(5, '2026-04-15T00:00:00Z')],
        summary: { totalWindows: 1, avgDegradation: 5, medianDegradation: 5, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' },
      };
      mockedLoad.mockReturnValue(results);
      const handler = findHandler('GET', '/shadow-walk-forward');
      const res = makeRes();
      handler({ query: {} }, res);
      expect(res.statusCode).toBe(200);
      const body = res.body as WalkForwardResults & { disabled: boolean };
      expect(body.windows).toHaveLength(1);
      expect(body.disabled).toBe(false);
    });

    it('빈 결과 — windows=[]', () => {
      mockedDisabled.mockReturnValue(false);
      mockedLoad.mockReturnValue({
        schemaVersion: 1, generatedAt: '2026-04-28T00:00:00Z', windows: [],
        summary: { totalWindows: 0, avgDegradation: 0, medianDegradation: 0, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' },
      });
      const handler = findHandler('GET', '/shadow-walk-forward');
      const res = makeRes();
      handler({ query: {} }, res);
      expect((res.body as { windows: unknown[] }).windows).toEqual([]);
    });

    it('disabled=true 플래그 전달', () => {
      mockedDisabled.mockReturnValue(true);
      mockedLoad.mockReturnValue({
        schemaVersion: 1, generatedAt: '2026-04-28T00:00:00Z', windows: [],
        summary: { totalWindows: 0, avgDegradation: 0, medianDegradation: 0, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' },
      });
      const handler = findHandler('GET', '/shadow-walk-forward');
      const res = makeRes();
      handler({ query: {} }, res);
      expect((res.body as { disabled: boolean }).disabled).toBe(true);
    });

    it('load throw → 500', () => {
      mockedDisabled.mockReturnValue(false);
      mockedLoad.mockImplementation(() => { throw new Error('disk fail'); });
      const handler = findHandler('GET', '/shadow-walk-forward');
      const res = makeRes();
      handler({ query: {} }, res);
      expect(res.statusCode).toBe(500);
      expect((res.body as { error: string }).error).toBe('shadow_walk_forward_load_failed');
    });
  });

  describe('POST /shadow-walk-forward/run', () => {
    it('정상 응답 — runShadowWalkForward 결과 그대로', async () => {
      mockedRun.mockResolvedValue({
        skipped: false,
        results: {
          schemaVersion: 1, generatedAt: '2026-04-28T00:00:00Z', windows: [],
          summary: { totalWindows: 0, avgDegradation: 0, medianDegradation: 0, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' },
        },
      });
      const handler = findHandler('POST', '/shadow-walk-forward/run');
      const res = makeRes();
      await handler({ query: {} }, res);
      expect(res.statusCode).toBe(200);
      expect((res.body as { skipped: boolean }).skipped).toBe(false);
      expect(mockedRun).toHaveBeenCalledWith({ source: 'ALL' });
    });

    it("source='REJECTION' 쿼리 propagate", async () => {
      mockedRun.mockResolvedValue({ skipped: true, reason: 'NO_RECORDS' });
      const handler = findHandler('POST', '/shadow-walk-forward/run');
      const res = makeRes();
      await handler({ query: { source: 'rejection' } }, res);
      expect(mockedRun).toHaveBeenCalledWith({ source: 'REJECTION' });
    });

    it('skipped=true (DISABLED) 응답', async () => {
      mockedRun.mockResolvedValue({ skipped: true, reason: 'DISABLED' });
      const handler = findHandler('POST', '/shadow-walk-forward/run');
      const res = makeRes();
      await handler({ query: {} }, res);
      expect(res.statusCode).toBe(200);
      expect((res.body as { skipped: boolean; reason: string }).reason).toBe('DISABLED');
    });

    it('throw → 500', async () => {
      mockedRun.mockRejectedValue(new Error('framework fail'));
      const handler = findHandler('POST', '/shadow-walk-forward/run');
      const res = makeRes();
      await handler({ query: {} }, res);
      expect(res.statusCode).toBe(500);
      expect((res.body as { error: string }).error).toBe('shadow_walk_forward_run_failed');
    });
  });
});
