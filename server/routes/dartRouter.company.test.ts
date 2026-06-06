/**
 * @responsibility dartRouter GET /company 회귀 — stock_code→corp_code 해석(corpCode 마스터 캐시).
 *
 * 사용자 prod 보고: /api/dart/company?stock_code=009150 가 status '100'
 * "필수값(corp_code)이 누락" 반환 → 클라 fetchCorpCode null → DART 재무/게이트 조건 0.
 * 원인: company.json 직결(stock_code). 픽스: resolveDartCorpCodeFromCache 로 해석해 {status:'000', corp_code}.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';

vi.mock('../trading/gate2/dartCorpCodeMasterCache.js', () => ({
  resolveDartCorpCodeFromCache: vi.fn(),
  ensureDartCorpCodeMasterCache: vi.fn(),
}));

import dartRouter from './dartRouter.js';
import {
  resolveDartCorpCodeFromCache,
  ensureDartCorpCodeMasterCache,
} from '../trading/gate2/dartCorpCodeMasterCache.js';

function setupApp() {
  const app = express();
  app.use('/api/dart', dartRouter);
  return app;
}

async function callCompany(app: express.Express, stockCode: string) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    const req: any = {
      method: 'GET',
      url: `/api/dart/company?stock_code=${encodeURIComponent(stockCode)}`,
      query: { stock_code: stockCode },
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

describe('dartRouter GET /company — corp_code 해석', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.clearAllMocks(); });

  it('FOUND → status 000 + corp_code (클라 계약)', async () => {
    vi.mocked(resolveDartCorpCodeFromCache).mockReturnValue({
      status: 'FOUND', symbol: '009150', corpCode: '00126186', corpName: '삼성전기',
      stockCode: '009150', reason: 'FOUND', executionImpact: 'NONE',
    });
    const res = await callCompany(setupApp(), '009150');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('000');
    expect(res.body.corp_code).toBe('00126186');
    expect(res.body.corp_name).toBe('삼성전기');
    expect(ensureDartCorpCodeMasterCache).not.toHaveBeenCalled(); // 캐시 적재 상태 → refresh 불필요
  });

  it('CACHE_MISSING → ensure 1회 후 재해석', async () => {
    vi.mocked(resolveDartCorpCodeFromCache)
      .mockReturnValueOnce({ status: 'CACHE_MISSING', symbol: '005930', reason: 'DART_CORP_CODE_CACHE_NOT_LOADED', executionImpact: 'NONE' })
      .mockReturnValueOnce({ status: 'FOUND', symbol: '005930', corpCode: '00126380', corpName: '삼성전자', stockCode: '005930', reason: 'FOUND', executionImpact: 'NONE' });
    vi.mocked(ensureDartCorpCodeMasterCache).mockResolvedValue({} as any);
    const res = await callCompany(setupApp(), '005930');
    expect(ensureDartCorpCodeMasterCache).toHaveBeenCalledTimes(1);
    expect(res.body.status).toBe('000');
    expect(res.body.corp_code).toBe('00126380');
  });

  it('NOT_FOUND → status 013 + corp_code null (클라 null 처리)', async () => {
    vi.mocked(resolveDartCorpCodeFromCache).mockReturnValue({
      status: 'NOT_FOUND', symbol: '999999', reason: 'DART_CORP_CODE_NOT_FOUND', executionImpact: 'NONE',
    });
    const res = await callCompany(setupApp(), '999999');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('013');
    expect(res.body.corp_code).toBeNull();
  });

  it('빈/비숫자 stock_code → 400', async () => {
    const res = await callCompany(setupApp(), 'ABC');
    expect(res.status).toBe(400);
    expect(res.body.corp_code).toBeNull();
    expect(resolveDartCorpCodeFromCache).not.toHaveBeenCalled();
  });

  it('resolver throw → 500 (corp_code null)', async () => {
    vi.mocked(resolveDartCorpCodeFromCache).mockImplementation(() => { throw new Error('disk read failed'); });
    const res = await callCompany(setupApp(), '009150');
    expect(res.status).toBe(500);
    expect(res.body.corp_code).toBeNull();
  });
});
