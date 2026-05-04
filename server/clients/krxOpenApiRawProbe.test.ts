import { describe, expect, it } from 'vitest';
import {
  formatRawProbeSummary,
  getKrxOpenApiBaseProbeCandidates,
  readKrxOpenApiRawBase,
  type KrxRawProbeResult,
} from './krxOpenApiRawProbe';

describe('krxOpenApiRawProbe utilities', () => {
  it('normalizes KRX_API_BASE by appending /svc/apis when missing', () => {
    const prev = process.env.KRX_API_BASE;
    const prevLegacy = process.env.KRX_OPENAPI_BASE;
    delete process.env.KRX_OPENAPI_BASE;
    process.env.KRX_API_BASE = 'http://data-dbg.krx.co.kr';
    try {
      expect(readKrxOpenApiRawBase()).toBe('http://data-dbg.krx.co.kr/svc/apis');
    } finally {
      if (prev === undefined) delete process.env.KRX_API_BASE;
      else process.env.KRX_API_BASE = prev;
      if (prevLegacy === undefined) delete process.env.KRX_OPENAPI_BASE;
      else process.env.KRX_OPENAPI_BASE = prevLegacy;
    }
  });

  it('returns deduped base probe candidates including env and production hosts', () => {
    const candidates = getKrxOpenApiBaseProbeCandidates();
    expect(candidates).toContain('https://data-dbg.krx.co.kr/svc/apis');
    expect(candidates).toContain('http://data-dbg.krx.co.kr/svc/apis');
    expect(candidates).toContain('https://openapi.krx.co.kr/svc/apis');
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('formats raw probe summaries compactly', () => {
    const probes: KrxRawProbeResult[] = [
      {
        base: 'https://data-dbg.krx.co.kr/svc/apis',
        endpoint: 'sto/stk_isu_base_info',
        params: { basDd: '20260501' },
        ok: true,
        httpStatus: 200,
        contentType: 'application/json',
        textLength: 123,
        first300Chars: '{}',
        jsonTopKeys: ['OutBlock_1'],
        rowCount: 0,
        rowSampleKeys: [],
      },
    ];
    expect(formatRawProbeSummary(probes)).toContain('status=200');
    expect(formatRawProbeSummary(probes)).toContain('rows=0');
    expect(formatRawProbeSummary(probes)).toContain('keys=NONE');
  });
});
