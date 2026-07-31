/**
 * @responsibility ADR-0177 Learning Sanity Dashboard endpoint 회귀 테스트
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShadowLearningOnlySignal } from '../trading/shadowLearningOnlyScan.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import type {
  GateAttributionResult,
  SafetyGateAttributionOptions,
} from '../learning/safetyGateAttribution.js';
import type {
  DeltaCategoryResult,
  ShadowVsLiveDeltaInput,
} from '../learning/shadowVsLiveDelta.js';

vi.mock('../persistence/shadowLearningOnlySignalRepo.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../persistence/shadowLearningOnlySignalRepo.js',
  );
  return { ...actual, loadShadowLearningOnlySignals: vi.fn() };
});

vi.mock('../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../persistence/shadowTradeRepo.js',
  );
  return { ...actual, loadShadowTrades: vi.fn() };
});

vi.mock('../learning/safetyGateAttribution.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../learning/safetyGateAttribution.js',
  );
  return { ...actual, computeSafetyGateAttribution: vi.fn() };
});

vi.mock('../learning/shadowVsLiveDelta.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../learning/shadowVsLiveDelta.js',
  );
  return { ...actual, computeShadowVsLiveDelta: vi.fn() };
});

import * as shadowSignalRepo from '../persistence/shadowLearningOnlySignalRepo.js';
import * as shadowTradeRepo from '../persistence/shadowTradeRepo.js';
import * as safetyGate from '../learning/safetyGateAttribution.js';
import * as shadowDelta from '../learning/shadowVsLiveDelta.js';
import learningRouter from './learningRouter.js';

const mockedLoadSignals = vi.mocked(shadowSignalRepo.loadShadowLearningOnlySignals);
const mockedLoadTrades = vi.mocked(shadowTradeRepo.loadShadowTrades);
const mockedComputeSafety = vi.mocked(safetyGate.computeSafetyGateAttribution);
const mockedComputeDelta = vi.mocked(shadowDelta.computeShadowVsLiveDelta);

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

function makeSignal(overrides: Partial<ShadowLearningOnlySignal> = {}): ShadowLearningOnlySignal {
  return {
    symbol: '005930', signalDate: '2026-04-15',
    blockedReason: 'FOMC_BLOCK',
    wouldHaveBought: true,
    hypotheticalEntryPrice: 70000,
    hypotheticalStopLoss: 64000,
    hypotheticalTargetPrice: 80000,
    signalGrade: 'STRONG_BUY',
    gateScore: 22,
    regime: 'R2_BULL',
    macroBlockReason: 'FOMC PRE_1',
    dataQualityStatus: 'OK',
    outcome: 'PENDING',
    ...overrides,
    learningOnly: true,
    executionImpact: 'NONE',
  };
}

function makeTrade(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 't_1', stockCode: '005930', stockName: '삼성전자',
    signalTime: '2026-04-15T00:00:00.000Z',
    signalPrice: 70000, shadowEntryPrice: 70000,
    quantity: 10, stopLoss: 64000, targetPrice: 80000,
    status: 'ACTIVE', triggeredAt: '2026-04-15T00:00:00.000Z',
    ...overrides,
  } as ServerShadowTrade;
}

describe('ADR-0177 Learning Sanity Dashboard endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /safety-gate-attribution', () => {
    it('정상 응답 — 7 GateName entry array', () => {
      const fakeResults: GateAttributionResult[] = [
        { gate: 'FOMC', avoidedLoss: 100, missedGain: 50, netGateImpact: 50,
          blockedWinnerCount: 1, blockedLoserCount: 2, gatePrecision: 0.667, sampleSize: 3 },
      ];
      mockedLoadSignals.mockReturnValue([makeSignal()]);
      mockedComputeSafety.mockReturnValue(fakeResults);

      const handler = findHandler('GET', '/safety-gate-attribution');
      const res = makeRes();
      handler({ query: {} }, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(fakeResults);
      expect(mockedComputeSafety).toHaveBeenCalledWith(
        [makeSignal()],
        { lookbackDays: 90, futureReturnHorizon: 5 },
      );
    });

    it('ENV OFF — 함수 빈 배열 반환 시 [] 응답', () => {
      mockedLoadSignals.mockReturnValue([]);
      mockedComputeSafety.mockReturnValue([]);
      const handler = findHandler('GET', '/safety-gate-attribution');
      const res = makeRes();
      handler({ query: {} }, res);
      expect(res.body).toEqual([]);
    });

    it('days=30 + horizon=20 query parsing', () => {
      mockedLoadSignals.mockReturnValue([]);
      mockedComputeSafety.mockReturnValue([]);
      const handler = findHandler('GET', '/safety-gate-attribution');
      const res = makeRes();
      handler({ query: { days: '30', horizon: '20' } }, res);
      expect(mockedComputeSafety).toHaveBeenCalledWith(
        [],
        { lookbackDays: 30, futureReturnHorizon: 20 },
      );
    });

    it('days=0 무효 — default 90 fallback', () => {
      mockedLoadSignals.mockReturnValue([]);
      mockedComputeSafety.mockReturnValue([]);
      const handler = findHandler('GET', '/safety-gate-attribution');
      const res = makeRes();
      handler({ query: { days: '0' } }, res);
      const opts = (mockedComputeSafety.mock.calls[0]?.[1] as SafetyGateAttributionOptions);
      expect(opts.lookbackDays).toBe(90);
    });

    it('days=400 초과 — default 90 fallback', () => {
      mockedLoadSignals.mockReturnValue([]);
      mockedComputeSafety.mockReturnValue([]);
      const handler = findHandler('GET', '/safety-gate-attribution');
      const res = makeRes();
      handler({ query: { days: '400' } }, res);
      const opts = (mockedComputeSafety.mock.calls[0]?.[1] as SafetyGateAttributionOptions);
      expect(opts.lookbackDays).toBe(90);
    });

    it('horizon=2 무효 — default 5 fallback', () => {
      mockedLoadSignals.mockReturnValue([]);
      mockedComputeSafety.mockReturnValue([]);
      const handler = findHandler('GET', '/safety-gate-attribution');
      const res = makeRes();
      handler({ query: { horizon: '2' } }, res);
      const opts = (mockedComputeSafety.mock.calls[0]?.[1] as SafetyGateAttributionOptions);
      expect(opts.futureReturnHorizon).toBe(5);
    });

    it('throw → 500', () => {
      mockedLoadSignals.mockImplementation(() => { throw new Error('boom'); });
      const handler = findHandler('GET', '/safety-gate-attribution');
      const res = makeRes();
      handler({ query: {} }, res);
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'safety_gate_attribution_failed' });
    });
  });

  describe('GET /shadow-vs-live-delta', () => {
    it('정상 응답 — 5 DeltaCategory entry array', () => {
      const fakeResults: DeltaCategoryResult[] = [
        { category: 'SHADOW_BUY_LIVE_BLOCKED', sampleSize: 3,
          shadowReturnSum: 15, liveReturnSum: 0, missedAlpha: 15, missedAlphaAvg: 5,
          unresolvedExcluded: 0 },
      ];
      mockedLoadSignals.mockReturnValue([makeSignal()]);
      mockedLoadTrades.mockReturnValue([makeTrade()]);
      mockedComputeDelta.mockReturnValue(fakeResults);

      const handler = findHandler('GET', '/shadow-vs-live-delta');
      const res = makeRes();
      handler({ query: {} }, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(fakeResults);
      const callInput = mockedComputeDelta.mock.calls[0]?.[0] as ShadowVsLiveDeltaInput;
      expect(callInput.shadowSignals).toEqual([makeSignal()]);
      expect(callInput.liveTrades).toEqual([makeTrade()]);
      expect(callInput.options).toEqual({ lookbackDays: 90, futureReturnHorizon: 5 });
    });

    it('ENV OFF — 함수 빈 배열 반환 시 [] 응답', () => {
      mockedLoadSignals.mockReturnValue([]);
      mockedLoadTrades.mockReturnValue([]);
      mockedComputeDelta.mockReturnValue([]);
      const handler = findHandler('GET', '/shadow-vs-live-delta');
      const res = makeRes();
      handler({ query: {} }, res);
      expect(res.body).toEqual([]);
    });

    it('days=180 + horizon=3 query parsing', () => {
      mockedLoadSignals.mockReturnValue([]);
      mockedLoadTrades.mockReturnValue([]);
      mockedComputeDelta.mockReturnValue([]);
      const handler = findHandler('GET', '/shadow-vs-live-delta');
      const res = makeRes();
      handler({ query: { days: '180', horizon: '3' } }, res);
      const callInput = mockedComputeDelta.mock.calls[0]?.[0] as ShadowVsLiveDeltaInput;
      expect(callInput.options).toEqual({ lookbackDays: 180, futureReturnHorizon: 3 });
    });

    it('days="abc" 무효 — default 90 fallback', () => {
      mockedLoadSignals.mockReturnValue([]);
      mockedLoadTrades.mockReturnValue([]);
      mockedComputeDelta.mockReturnValue([]);
      const handler = findHandler('GET', '/shadow-vs-live-delta');
      const res = makeRes();
      handler({ query: { days: 'abc' } }, res);
      const callInput = mockedComputeDelta.mock.calls[0]?.[0] as ShadowVsLiveDeltaInput;
      expect(callInput.options?.lookbackDays).toBe(90);
    });

    it('horizon=10 무효 — default 5 fallback', () => {
      mockedLoadSignals.mockReturnValue([]);
      mockedLoadTrades.mockReturnValue([]);
      mockedComputeDelta.mockReturnValue([]);
      const handler = findHandler('GET', '/shadow-vs-live-delta');
      const res = makeRes();
      handler({ query: { horizon: '10' } }, res);
      const callInput = mockedComputeDelta.mock.calls[0]?.[0] as ShadowVsLiveDeltaInput;
      expect(callInput.options?.futureReturnHorizon).toBe(5);
    });

    it('throw → 500', () => {
      mockedLoadTrades.mockImplementation(() => { throw new Error('boom'); });
      mockedLoadSignals.mockReturnValue([]);
      const handler = findHandler('GET', '/shadow-vs-live-delta');
      const res = makeRes();
      handler({ query: {} }, res);
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'shadow_vs_live_delta_failed' });
    });
  });

  describe('정적 invariant 가드', () => {
    it('두 신규 endpoint 모두 GET 메서드만 등록', () => {
      const stack = (learningRouter as unknown as { stack: Array<{
        route?: { path: string; methods: Record<string, boolean> };
      }> }).stack;
      const safetyLayer = stack.find((l) => l.route?.path === '/safety-gate-attribution');
      const deltaLayer = stack.find((l) => l.route?.path === '/shadow-vs-live-delta');
      expect(safetyLayer?.route?.methods).toEqual({ get: true });
      expect(deltaLayer?.route?.methods).toEqual({ get: true });
    });
  });
});
