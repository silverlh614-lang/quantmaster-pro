/**
 * @responsibility decisionInputsRouter 회귀 — ADR-0046 PR-Z4
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../state.js', () => ({
  getEmergencyStop: vi.fn(),
}));
vi.mock('../telegram/buyApproval.js', () => ({
  listPendingApprovals: vi.fn(),
}));
vi.mock('../persistence/macroStateRepo.js', () => ({
  loadMacroState: vi.fn(),
}));

import { getEmergencyStop } from '../state.js';
import { listPendingApprovals } from '../telegram/buyApproval.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import decisionInputsRouter from './decisionInputsRouter.js';

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
  (req: Record<string, unknown>, res: MockRes): void | Promise<void>;
}

function findHandler(method: string, path: string): RouteHandler {
  const stack = (decisionInputsRouter as unknown as { stack: Array<{
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RouteHandler }> };
  }> }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route.methods[method.toLowerCase()]) {
      return layer.route.stack[0].handle;
    }
  }
  throw new Error(`route ${method} ${path} not found`);
}

describe('decisionInputsRouter — ADR-0046', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('정상 응답 — emergencyStop=false + pendingApprovals + macroSignals + capturedAt ISO', async () => {
    vi.mocked(getEmergencyStop).mockReturnValue(false);
    vi.mocked(listPendingApprovals).mockReturnValue([
      { tradeId: 't1', stockCode: '005930', stockName: '삼성전자', currentPrice: 70000, quantity: 10, stopLoss: 66500, targetPrice: 77000, createdAt: 0, ageMs: 60_000 },
    ]);
    vi.mocked(loadMacroState).mockReturnValue({
      mhs: 65, regime: 'YELLOW', updatedAt: '2026-04-26T13:00:00Z',
      vkospi: 22, vkospiDayChange: 1.5, vix: 18, vixHistory: [16, 17, 18],
      bearDefenseMode: false, fssAlertLevel: 'NORMAL',
    });

    const handler = findHandler('GET', '/inputs');
    const res = makeRes();
    await handler({}, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { emergencyStop: boolean; pendingApprovals: unknown[]; macroSignals: { vkospi: number }; capturedAt: string };
    expect(body.emergencyStop).toBe(false);
    expect(body.pendingApprovals).toHaveLength(1);
    expect(body.macroSignals.vkospi).toBe(22);
    expect(body.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('emergencyStop=true 직접 노출', async () => {
    vi.mocked(getEmergencyStop).mockReturnValue(true);
    vi.mocked(listPendingApprovals).mockReturnValue([]);
    vi.mocked(loadMacroState).mockReturnValue(null);
    const handler = findHandler('GET', '/inputs');
    const res = makeRes();
    await handler({}, res);
    expect((res.body as { emergencyStop: boolean }).emergencyStop).toBe(true);
  });

  it('macroState=null → macroSignals 모든 필드 undefined', async () => {
    vi.mocked(getEmergencyStop).mockReturnValue(false);
    vi.mocked(listPendingApprovals).mockReturnValue([]);
    vi.mocked(loadMacroState).mockReturnValue(null);
    const handler = findHandler('GET', '/inputs');
    const res = makeRes();
    await handler({}, res);
    const body = res.body as { macroSignals: Record<string, unknown> };
    expect(body.macroSignals.vkospi).toBeUndefined();
    expect(body.macroSignals.regime).toBeUndefined();
  });

  it('pendingApprovals 가 ageMs 내림차순 정렬 (가장 오래된 것 먼저)', async () => {
    vi.mocked(getEmergencyStop).mockReturnValue(false);
    vi.mocked(listPendingApprovals).mockReturnValue([
      { tradeId: 't1', stockCode: 'A', stockName: '신규', currentPrice: 0, quantity: 0, stopLoss: 0, targetPrice: 0, createdAt: 0, ageMs: 30_000 },
      { tradeId: 't2', stockCode: 'B', stockName: '오래됨', currentPrice: 0, quantity: 0, stopLoss: 0, targetPrice: 0, createdAt: 0, ageMs: 300_000 },
      { tradeId: 't3', stockCode: 'C', stockName: '중간', currentPrice: 0, quantity: 0, stopLoss: 0, targetPrice: 0, createdAt: 0, ageMs: 120_000 },
    ]);
    vi.mocked(loadMacroState).mockReturnValue(null);
    const handler = findHandler('GET', '/inputs');
    const res = makeRes();
    await handler({}, res);
    const body = res.body as { pendingApprovals: Array<{ stockCode: string; ageMs: number }> };
    expect(body.pendingApprovals.map((p) => p.stockCode)).toEqual(['B', 'C', 'A']);
  });

  it('listPendingApprovals throw → 500', async () => {
    vi.mocked(getEmergencyStop).mockReturnValue(false);
    vi.mocked(listPendingApprovals).mockImplementation(() => { throw new Error('boom'); });
    vi.mocked(loadMacroState).mockReturnValue(null);
    const handler = findHandler('GET', '/inputs');
    const res = makeRes();
    await handler({}, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'decision_inputs_failed' });
  });

  it('vixHistory 가 macroState 에 있으면 그대로 노출', async () => {
    vi.mocked(getEmergencyStop).mockReturnValue(false);
    vi.mocked(listPendingApprovals).mockReturnValue([]);
    vi.mocked(loadMacroState).mockReturnValue({
      mhs: 50, regime: 'GREEN', updatedAt: '2026-04-26T13:00:00Z',
      vixHistory: [15, 16, 17, 18, 28], // 마지막에 spike
    });
    const handler = findHandler('GET', '/inputs');
    const res = makeRes();
    await handler({}, res);
    const body = res.body as { macroSignals: { vixHistory: number[] } };
    expect(body.macroSignals.vixHistory).toEqual([15, 16, 17, 18, 28]);
  });
});
