// @responsibility Verify KIS multi-stock quote requests, parsing, single-quote fallback signals.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), warn: vi.fn(), real: true }));
vi.mock('../http.js', () => ({ realDataKisGet: mocks.get }));
vi.mock('../constants.js', () => ({ get HAS_REAL_DATA_CLIENT() { return mocks.real; }, KIS_IS_REAL: false }));
vi.mock('../../../utils/logger.js', () => ({ logger: { warn: mocks.warn } }));
import { __resetKisMultiQuoteWarningForTest, fetchKisMultiQuotes, parseKisMultiQuotes } from './multiQuote.js';

const row = (code: string, price: string) => ({ inter_shrn_iscd: code, inter_kor_isnm: code, inter2_prpr: price });
beforeEach(() => { mocks.get.mockReset(); mocks.warn.mockReset(); mocks.real = true; __resetKisMultiQuoteWarningForTest(); });

describe('parseKisMultiQuotes', () => {
  it('matches rows by stock code and keeps unusable prices unpriced', () => {
    const quotes = parseKisMultiQuotes(['005930', '104830', '000660'], { rt_cd: '0', output: [
      row('104830', '38700'), row('005930', '0'), row('999999', '100'), row('104830', '1'),
    ] }, '2026-10-06T00:20:00.000Z');
    expect([...quotes!.values()]).toEqual([
      { code: '104830', currentPrice: 38700, fetchedAt: '2026-10-06T00:20:00.000Z' },
      { code: '005930', currentPrice: null, fetchedAt: '2026-10-06T00:20:00.000Z' },
    ]);
    expect(parseKisMultiQuotes(['005930'], { rt_cd: '1', msg1: '오류' }, 'x')).toBeNull();
  });
});

describe('fetchKisMultiQuotes', () => {
  it('sends numbered KRX code pairs in one request', async () => {
    mocks.get.mockResolvedValue({ rt_cd: '0', output: [row('005930', '61000'), row('000660', '201000')] });
    const quotes = await fetchKisMultiQuotes(['5930', '000660', '005930']);
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.get).toHaveBeenCalledWith('FHKST11300006', '/uapi/domestic-stock/v1/quotations/intstock-multprice', {
      FID_COND_MRKT_DIV_CODE_1: 'J', FID_INPUT_ISCD_1: '005930', FID_COND_MRKT_DIV_CODE_2: 'J', FID_INPUT_ISCD_2: '000660' });
    expect(quotes?.get('000660')?.currentPrice).toBe(201000);
  });

  it('rejects more than thirty codes', async () => {
    await expect(fetchKisMultiQuotes(Array.from({ length: 31 }, (_, index) => String(index)))).rejects.toThrow(RangeError);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('returns null without a real-data client so callers keep single quotes', async () => {
    mocks.real = false;
    expect(await fetchKisMultiQuotes(['005930'])).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('returns null with one throttled warning for empty, unmatched or failed responses', async () => {
    mocks.get.mockResolvedValueOnce({ rt_cd: '1', msg_cd: 'EGW00123', msg1: '모의투자 미지원' })
      .mockResolvedValueOnce({ rt_cd: '0', output: [row('999999', '100')] })
      .mockRejectedValueOnce(new Error('network'));
    expect(await fetchKisMultiQuotes(['005930'])).toBeNull();
    expect(await fetchKisMultiQuotes(['005930'])).toBeNull();
    expect(await fetchKisMultiQuotes(['005930'])).toBeNull();
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.warn.mock.calls[0][1]).toMatchObject({ requested: 1, rtCd: '1', msgCd: 'EGW00123' });
  });
});
