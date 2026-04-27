/**
 * tranchesRouterGuard.test.ts — PR-52 H1 회귀 가드.
 *
 * `POST /auto-trade/tranches/run` 엔드포인트는 분할 매수 트랜치를 즉시 실행한다.
 * AUTO_TRADE_ENABLED=false 상태에서 호출되면 LIVE 분할 매수 2·3차 실주문이
 * 발송되는 잠재 위험이 있어 명시적 403 응답으로 차단한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../trading/trancheExecutor.js', () => ({
  trancheExecutor: {
    checkPendingTranches: vi.fn(),
    getPendingTranches: vi.fn(() => []),
  },
}));

vi.mock('../../trading/ocoCloseLoop.js', () => ({
  getActiveOcoOrders: vi.fn(() => []),
  getAllOcoOrders: vi.fn(() => []),
}));

interface MockRes {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
}

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('tranchesRouter POST /auto-trade/tranches/run AUTO_TRADE_ENABLED 가드 (PR-52 H1)', () => {
  const originalEnv = { ...process.env };
  let router: typeof import('./tranchesRouter.js')['default'];
  let trancheExecutor: typeof import('../../trading/trancheExecutor.js')['trancheExecutor'];

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./tranchesRouter.js');
    router = mod.default;
    const trancheMod = await import('../../trading/trancheExecutor.js');
    trancheExecutor = trancheMod.trancheExecutor;
    vi.mocked(trancheExecutor.checkPendingTranches).mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function getRunHandler(): (req: unknown, res: MockRes) => Promise<unknown> {
    interface RouterInternals {
      stack: Array<{
        route?: {
          path: string;
          stack: Array<{ method: string; handle: (req: unknown, res: MockRes) => Promise<unknown> }>;
        };
      }>;
    }
    const layers = (router as unknown as RouterInternals).stack;
    const runLayer = layers.find(
      (l) => l.route?.path === '/auto-trade/tranches/run',
    );
    if (!runLayer?.route) throw new Error('run handler not registered');
    const post = runLayer.route.stack.find((s) => s.method === 'post');
    if (!post) throw new Error('POST method missing');
    return post.handle;
  }

  it('AUTO_TRADE_ENABLED=false 시 403 응답 + checkPendingTranches 미호출', async () => {
    process.env.AUTO_TRADE_ENABLED = 'false';
    const handler = getRunHandler();
    const res = createMockRes();

    await handler({ body: {} }, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      error: 'AUTO_TRADE_ENABLED=false',
    });
    expect(trancheExecutor.checkPendingTranches).not.toHaveBeenCalled();
  });

  it('AUTO_TRADE_ENABLED 미설정 시에도 가드 작동 — 403', async () => {
    delete process.env.AUTO_TRADE_ENABLED;
    const handler = getRunHandler();
    const res = createMockRes();

    await handler({ body: {} }, res);

    expect(res.statusCode).toBe(403);
    expect(trancheExecutor.checkPendingTranches).not.toHaveBeenCalled();
  });

  it('AUTO_TRADE_ENABLED=true 시 가드 통과 + checkPendingTranches 호출', async () => {
    process.env.AUTO_TRADE_ENABLED = 'true';
    const handler = getRunHandler();
    const res = createMockRes();

    await handler({ body: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(trancheExecutor.checkPendingTranches).toHaveBeenCalledTimes(1);
  });
});
