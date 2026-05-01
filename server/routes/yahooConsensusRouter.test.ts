/**
 * @responsibility ADR-0156 yahooConsensusRouter 회귀 — endpoint 응답 schema + 에러 분기.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { yahooConsensusRouter } from './yahooConsensusRouter.js';

vi.mock('../clients/yahooConsensusClient.js', () => ({
  fetchYahooConsensus: vi.fn(),
}));

import { fetchYahooConsensus } from '../clients/yahooConsensusClient.js';

function setupApp() {
  const app = express();
  app.use('/api/yahoo-consensus', yahooConsensusRouter);
  return app;
}

async function callSnapshot(app: express.Express, code: string) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    const req: any = {
      method: 'GET',
      url: `/api/yahoo-consensus/snapshot?code=${encodeURIComponent(code)}`,
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

describe('ADR-0156 — yahooConsensusRouter GET /snapshot', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.clearAllMocks(); });

  it('정상 source=yahoo 응답', async () => {
    vi.mocked(fetchYahooConsensus).mockResolvedValue({
      recommendationStrength: 0.62,
      earningsSurpriseAvg: 5.4,
      sampleSize: 21,
      source: 'yahoo',
    });
    const app = setupApp();
    const res = await callSnapshot(app, '005930');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('yahoo');
    expect(res.body.recommendationStrength).toBe(0.62);
    expect(res.body.earningsSurpriseAvg).toBe(5.4);
  });

  it('source=unavailable (한국 종목 부재) 응답', async () => {
    vi.mocked(fetchYahooConsensus).mockResolvedValue({
      recommendationStrength: null,
      earningsSurpriseAvg: null,
      sampleSize: 0,
      source: 'unavailable',
    });
    const app = setupApp();
    const res = await callSnapshot(app, '999999');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('unavailable');
    expect(res.body.recommendationStrength).toBeNull();
    expect(res.body.sampleSize).toBe(0);
  });

  it('fetchYahooConsensus null → unavailable fallback', async () => {
    vi.mocked(fetchYahooConsensus).mockResolvedValue(null);
    const app = setupApp();
    const res = await callSnapshot(app, '005930');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('unavailable');
    expect(res.body.sampleSize).toBe(0);
  });

  it('잘못된 code (영문) → 400', async () => {
    const app = setupApp();
    const res = await callSnapshot(app, 'ABC');
    expect(res.status).toBe(400);
  });

  it('fetchYahooConsensus throw → 500', async () => {
    vi.mocked(fetchYahooConsensus).mockRejectedValue(new Error('Yahoo 503'));
    const app = setupApp();
    const res = await callSnapshot(app, '005930');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal');
  });

  it('부분 데이터 (recommendation 만 가용)', async () => {
    vi.mocked(fetchYahooConsensus).mockResolvedValue({
      recommendationStrength: 0.5,
      earningsSurpriseAvg: null,
      sampleSize: 12,
      source: 'yahoo',
    });
    const app = setupApp();
    const res = await callSnapshot(app, '005930');
    expect(res.status).toBe(200);
    expect(res.body.recommendationStrength).toBe(0.5);
    expect(res.body.earningsSurpriseAvg).toBeNull();
  });
});
