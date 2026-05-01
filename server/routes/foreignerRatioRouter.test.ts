/**
 * @responsibility ADR-0152 foreignerRatioRouter 회귀 — endpoint 응답 schema + 에러 분기.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { foreignerRatioRouter } from './foreignerRatioRouter.js';

vi.mock('../persistence/foreignerRatioRepo.js', () => ({
  computeForeignerRatioTrend: vi.fn(),
}));

import { computeForeignerRatioTrend } from '../persistence/foreignerRatioRepo.js';

function setupApp() {
  const app = express();
  app.use('/api/foreigner-ratio', foreignerRatioRouter);
  return app;
}

async function callTrend(app: express.Express, code: string) {
  // express 5 의 router.handle 직접 호출 — supertest 의존성 없이 검증
  return new Promise<{ status: number; body: any }>((resolve) => {
    const req: any = {
      method: 'GET',
      url: `/api/foreigner-ratio/trend?code=${encodeURIComponent(code)}`,
      query: { code },
      headers: {},
      app,
    };
    const res: any = {
      statusCode: 200,
      _body: undefined,
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { this._body = body; resolve({ status: this.statusCode, body }); return this; },
      send(body: any) { this._body = body; resolve({ status: this.statusCode, body }); return this; },
      end() { resolve({ status: this.statusCode, body: this._body }); return this; },
      setHeader() {},
      getHeader() { return undefined; },
    };
    app(req, res, () => resolve({ status: 404, body: { error: 'next() called' } }));
  });
}

describe('ADR-0152 — foreignerRatioRouter GET /trend', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.clearAllMocks(); });

  it('정상 영속 데이터 반환', async () => {
    vi.mocked(computeForeignerRatioTrend).mockReturnValue({
      current: 51.2,
      changePct5d: 1.5,
      changePct20d: 2.1,
      sampleSize: 12,
      latestDate: '2026-04-30',
    });
    const app = setupApp();
    const res = await callTrend(app, '005930');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      current: 51.2,
      changePct5d: 1.5,
      changePct20d: 2.1,
      sampleSize: 12,
      latestDate: '2026-04-30',
    });
  });

  it('영속 부재 → null 필드 응답 (404 아님)', async () => {
    vi.mocked(computeForeignerRatioTrend).mockReturnValue(null);
    const app = setupApp();
    const res = await callTrend(app, '999999');
    expect(res.status).toBe(200);
    expect(res.body.current).toBeNull();
    expect(res.body.changePct5d).toBeNull();
    expect(res.body.sampleSize).toBe(0);
  });

  it('표본 부족 → changePct5d=null + sampleSize 작은 값', async () => {
    vi.mocked(computeForeignerRatioTrend).mockReturnValue({
      current: 51.2,
      changePct5d: null,
      changePct20d: null,
      sampleSize: 3,
      latestDate: '2026-04-30',
    });
    const app = setupApp();
    const res = await callTrend(app, '005930');
    expect(res.status).toBe(200);
    expect(res.body.changePct5d).toBeNull();
    expect(res.body.sampleSize).toBe(3);
  });

  it('잘못된 code (영문) → 400', async () => {
    const app = setupApp();
    const res = await callTrend(app, 'ABC');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('invalid code');
  });

  it('빈 code → 400', async () => {
    const app = setupApp();
    const res = await callTrend(app, '');
    expect(res.status).toBe(400);
  });

  it('computeForeignerRatioTrend throw → 500', async () => {
    vi.mocked(computeForeignerRatioTrend).mockImplementation(() => {
      throw new Error('disk read failed');
    });
    const app = setupApp();
    const res = await callTrend(app, '005930');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal');
  });
});
