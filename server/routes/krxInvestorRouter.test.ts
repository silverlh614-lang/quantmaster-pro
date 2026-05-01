/**
 * @responsibility ADR-0155 krxInvestorRouter 회귀 — endpoint 응답 schema + 5영업일 합산 + 에러 분기.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { krxInvestorRouter } from './krxInvestorRouter.js';

vi.mock('../clients/krxClient.js', () => ({
  fetchInvestorTrading: vi.fn(),
}));

import { fetchInvestorTrading } from '../clients/krxClient.js';

function setupApp() {
  const app = express();
  app.use('/api/krx-investor', krxInvestorRouter);
  return app;
}

async function callTrend(app: express.Express, code: string, days?: number) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    const query: Record<string, string> = { code };
    if (days !== undefined) query.days = String(days);
    const req: any = {
      method: 'GET',
      url: `/api/krx-investor/trend?code=${encodeURIComponent(code)}${days ? `&days=${days}` : ''}`,
      query,
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

describe('ADR-0155 — krxInvestorRouter GET /trend', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.clearAllMocks(); });

  it('5영업일 정상 합산', async () => {
    // 5영업일 모두 동일 row 반환 → 5배 누적
    vi.mocked(fetchInvestorTrading).mockResolvedValue([
      { code: '005930', name: '삼성전자', foreignNetBuy: 1000, institutionNetBuy: 500, individualNetBuy: -1500 },
    ]);
    const app = setupApp();
    const res = await callTrend(app, '005930');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('005930');
    expect(res.body.foreignNet5d).toBe(5000);
    expect(res.body.institutionNet5d).toBe(2500);
    expect(res.body.individualNet5d).toBe(-7500);
    expect(res.body.sampleSize).toBe(5);
    expect(res.body.latestDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('일부 영업일 종목 부재 → sampleSize 감소', async () => {
    let callCount = 0;
    vi.mocked(fetchInvestorTrading).mockImplementation(async () => {
      callCount += 1;
      // 3, 5번째 호출에만 데이터 (1, 2, 4 부재)
      if (callCount === 3 || callCount === 5) {
        return [{ code: '005930', name: '삼성전자', foreignNetBuy: 100, institutionNetBuy: 200, individualNetBuy: -300 }];
      }
      return [];
    });
    const app = setupApp();
    const res = await callTrend(app, '005930');
    expect(res.status).toBe(200);
    expect(res.body.sampleSize).toBe(2);
    expect(res.body.institutionNet5d).toBe(400);
  });

  it('완전 부재 → sampleSize=0 + 0 합산', async () => {
    vi.mocked(fetchInvestorTrading).mockResolvedValue([]);
    const app = setupApp();
    const res = await callTrend(app, '999999');
    expect(res.status).toBe(200);
    expect(res.body.sampleSize).toBe(0);
    expect(res.body.foreignNet5d).toBe(0);
    expect(res.body.institutionNet5d).toBe(0);
    expect(res.body.latestDate).toBeNull();
  });

  it('잘못된 code (영문) → 400', async () => {
    const app = setupApp();
    const res = await callTrend(app, 'ABC');
    expect(res.status).toBe(400);
  });

  it('빈 code → 400', async () => {
    const app = setupApp();
    const res = await callTrend(app, '');
    expect(res.status).toBe(400);
  });

  it('days 파라미터 사용자 지정 (3일)', async () => {
    vi.mocked(fetchInvestorTrading).mockResolvedValue([
      { code: '005930', name: '삼성전자', foreignNetBuy: 1000, institutionNetBuy: 500, individualNetBuy: -1500 },
    ]);
    const app = setupApp();
    const res = await callTrend(app, '005930', 3);
    expect(res.status).toBe(200);
    expect(res.body.sampleSize).toBe(3);
    expect(res.body.institutionNet5d).toBe(1500);
  });

  it('잘못된 days (음수) → default 5', async () => {
    vi.mocked(fetchInvestorTrading).mockResolvedValue([
      { code: '005930', name: '삼성전자', foreignNetBuy: 100, institutionNetBuy: 200, individualNetBuy: -300 },
    ]);
    const app = setupApp();
    const res = await callTrend(app, '005930', -3);
    expect(res.status).toBe(200);
    expect(res.body.sampleSize).toBe(5);
  });

  it('fetchInvestorTrading throw → 500', async () => {
    vi.mocked(fetchInvestorTrading).mockRejectedValue(new Error('KRX HTTP 503'));
    const app = setupApp();
    const res = await callTrend(app, '005930');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal');
  });

  it('code zero-pad — "5930" → "005930" 매칭', async () => {
    vi.mocked(fetchInvestorTrading).mockResolvedValue([
      { code: '005930', name: '삼성전자', foreignNetBuy: 1000, institutionNetBuy: 500, individualNetBuy: -1500 },
    ]);
    const app = setupApp();
    const res = await callTrend(app, '5930');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('005930');
    expect(res.body.sampleSize).toBe(5);
  });
});
