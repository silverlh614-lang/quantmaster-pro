/**
 * krxClient.test.ts — 아이디어 2 검증
 *
 * 검증 목표:
 *   1. KRX_API_DISABLED=true 면 네트워크 호출 없이 빈 배열.
 *   2. fetch가 네트워크 오류·비정상 상태코드·이상한 본문일 때 throw 하지 않고 [] 반환.
 *   3. 정상 JSON 응답은 KrxInvestorRow / KrxPerPbrRow / KrxShortBalanceRow 로 정확히 매핑.
 *   4. 종목코드에 'A' 접두어가 있어도 숫자 6자리로 정규화.
 *   5. 동일 날짜 재호출은 메모리 캐시(TTL 10분)로 fetch 재호출 없음.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('krxClient — 네트워크 내성 및 캐시', () => {
  const originalFetch = globalThis.fetch;
  const originalKrxInvestorDetailEnabled = process.env.KRX_INVESTOR_DETAIL_ENABLED;

  beforeEach(async () => {
    // 각 테스트 시작 전 환경변수·캐시 초기화.
    delete process.env.KRX_API_DISABLED;
    delete process.env.KIS_FIRST_REBUILD_MODE;
    delete process.env.KIS_ONLY_REBUILD_MODE;
    delete process.env.KRX_AUTO_FETCH_DISABLED;
    process.env.KRX_INVESTOR_DETAIL_ENABLED = 'true';
    process.env.KRX_TIME_WINDOW_GATING_DISABLED = 'true';
    const mod = await import('./krxClient.js');
    mod.resetKrxCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.KRX_INVESTOR_DETAIL_ENABLED = originalKrxInvestorDetailEnabled;
    vi.restoreAllMocks();
  });


  it('KIS_ONLY_REBUILD_MODE=true 이면 KRX fallback HTTP client를 호출하지 않고 disabled 진단을 반환한다', async () => {
    process.env.KIS_ONLY_REBUILD_MODE = 'true';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading, getLastKrxInvestorTradingDiagnostic } = await import('./krxClient.js');
    const rows = await fetchInvestorTrading('20260508', { symbol: '005930' });
    const diagnostic = getLastKrxInvestorTradingDiagnostic('20260508');

    expect(rows).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(diagnostic?.provider).toBe('KRX');
    expect(diagnostic?.status).toBe('DISABLED_BY_KIS_ONLY_MODE');
    expect(diagnostic?.parserStatus).toBe('DISABLED_BY_KIS_ONLY_MODE');
    expect(diagnostic?.confidence).toBe('MISSING');
    expect(diagnostic?.providerIssue).toBe(false);
    expect(diagnostic?.marketSignal).toBe(false);
    expect(diagnostic?.useForRouter).toBe(false);
    expect(diagnostic?.useForGate).toBe(false);
    expect(diagnostic?.useForLive).toBe(false);
    expect(diagnostic?.useForShadow).toBe(false);
    expect(diagnostic?.executionImpact).toBe('NONE');
    expect(diagnostic?.reason).toBe('KIS_ONLY_REBUILD disables KRX fallback');
  });

  it('KIS_FIRST_REBUILD_MODE=true 이면 KRX HTTP client를 호출하지 않고 disabled 진단을 반환한다', async () => {
    process.env.KIS_FIRST_REBUILD_MODE = 'true';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading, getLastKrxInvestorTradingDiagnostic } = await import('./krxClient.js');
    const rows = await fetchInvestorTrading('20260508', { symbol: '005930' });
    const diagnostic = getLastKrxInvestorTradingDiagnostic('20260508');

    expect(rows).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(diagnostic?.status).toBe('DISABLED_BY_KIS_FIRST_MODE');
    expect(diagnostic?.parserStatus).toBe('DISABLED_BY_KIS_FIRST_MODE');
    expect(diagnostic?.providerIssue).toBe(false);
    expect(diagnostic?.marketSignal).toBe(false);
    expect(diagnostic?.useForRouter).toBe(false);
    expect(diagnostic?.useForGate).toBe(false);
    expect(diagnostic?.useForLive).toBe(false);
    expect(diagnostic?.useForShadow).toBe(false);
    expect(diagnostic?.executionImpact).toBe('NONE');
  });

  it('KRX_AUTO_FETCH_DISABLED=true 이면 KRX HTTP client를 호출하지 않고 manual diagnostic bypass는 허용한다', async () => {
    process.env.KRX_AUTO_FETCH_DISABLED = 'true';
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ OutBlock_1: [] }),
      headers: { get: () => 'application/json' },
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading, getLastKrxInvestorTradingDiagnostic } = await import('./krxClient.js');
    await expect(fetchInvestorTrading('20260508')).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getLastKrxInvestorTradingDiagnostic('20260508')?.providerIssue).toBe(false);

    await expect(fetchInvestorTrading('20260509', { allowDisabledAutoFetch: true })).resolves.toEqual([]);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('KRX_API_DISABLED=true 일 때 fetch를 호출하지 않고 빈 배열을 반환한다', async () => {
    process.env.KRX_API_DISABLED = 'true';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    // 모듈을 다시 import해 KRX_DISABLED가 평가되도록 한다.
    vi.resetModules();
    const { fetchInvestorTrading } = await import('./krxClient.js');

    const rows = await fetchInvestorTrading('20250419');
    expect(rows).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('HTTP 500 응답이면 빈 배열을 반환하고 throw하지 않는다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '',
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchPerPbr } = await import('./krxClient.js');
    await expect(fetchPerPbr('20250419')).resolves.toEqual([]);
  });

  it('이상한(JSON 아님) 본문은 빈 배열로 흡수한다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html>error page</html>',
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchShortBalance } = await import('./krxClient.js');
    await expect(fetchShortBalance('20250419')).resolves.toEqual([]);
  });

  it('정상 투자자 응답을 KrxInvestorRow 로 매핑하고 A 접두어를 제거한다', async () => {
    const body = {
      OutBlock_1: [
        {
          ISU_SRT_CD: 'A005930',
          ISU_ABBRV: '삼성전자',
          FORN_INVSTR_NETBY_QTY: '1,234,567',
          ORGN_INVSTR_NETBY_QTY: '-5,000',
          INDIV_INVSTR_NETBY_QTY: '10,000',
        },
        {
          ISU_SRT_CD: '000660',
          ISU_ABBRV: 'SK하이닉스',
          FORN_NETBY_QTY: '777',
          ORGN_NETBY_QTY: '888',
          PRVT_NETBY_QTY: '-1,100',
        },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading } = await import('./krxClient.js');
    const rows = await fetchInvestorTrading('20250419');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      code: '005930',
      name: '삼성전자',
      foreignNetBuy: 1234567,
      institutionNetBuy: -5000,
      individualNetBuy: 10000,
    });
    expect(rows[1]).toMatchObject({
      code: '000660',
      name: 'SK하이닉스',
      foreignNetBuy: 777,
      institutionNetBuy: 888,
      individualNetBuy: -1100,
    });
  });

  it('MDCSTAT02203 output2/data 계열 후보와 영문 alias를 자동 탐색해 투자자 row를 materialize한다', async () => {
    const body = {
      output2: [
        {
          code: 'A005930',
          name: '삼성전자',
          foreignNetBuy: '11',
          institutionalNetBuy: '22',
          retailNetBuy: '-33',
        },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(body),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading, getLastKrxInvestorTradingDiagnostic } = await import('./krxClient.js');
    const rows = await fetchInvestorTrading('20250419');
    expect(rows).toEqual([{ code: '005930', name: '삼성전자', foreignNetBuy: 11, institutionNetBuy: 22, individualNetBuy: -33 }]);
    const diagnostic = getLastKrxInvestorTradingDiagnostic('20250419');
    expect(diagnostic?.parserStatus).toBe('OK');
    expect(diagnostic?.detectedCandidatePaths).toContain('output2:len=1');
    expect(diagnostic?.contentType).toBe('json');
  });

  it('MDCSTAT02203 long-form 투자자구분 row를 외국인/기관/개인 netBuyVolume으로 집계한다', async () => {
    const body = {
      result: {
        rows: [
          { ISU_SRT_CD: '005930', ISU_ABBRV: '삼성전자', INVST_TP_NM: '외국인', NETBY_QTY: '100' },
          { ISU_SRT_CD: '005930', ISU_ABBRV: '삼성전자', INVST_TP_NM: '기관', NETBY_QTY: '200' },
          { ISU_SRT_CD: '005930', ISU_ABBRV: '삼성전자', INVST_TP_NM: '개인', NETBY_QTY: '-300' },
        ],
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(body),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading, getLastKrxInvestorTradingDiagnostic } = await import('./krxClient.js');
    const rows = await fetchInvestorTrading('20250420');
    expect(rows[0]).toMatchObject({ code: '005930', foreignNetBuy: 100, institutionNetBuy: 200, individualNetBuy: -300 });
    expect(getLastKrxInvestorTradingDiagnostic('20250420')?.selectedRowPath).toBe('result.rows');
  });

  it('isolates endpoint variants after MDCSTAT02201 HTTP 400 instead of retrying the same endpoint family', async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url, init) => {
      const urlText = String(url);
      const body = String(init?.body ?? '');
      if (urlText.includes('/GenerateOTP/generate.cmd')) {
        return {
          ok: false,
          status: 400,
          headers: { get: () => 'text/plain' },
          text: async () => 'bad request',
        };
      }
      if (body.includes('MDCSTAT02201') && body.includes('trdDd=20260508') && body.includes('mktId=STK')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({
            output: [{
              ISU_SRT_CD: '005930',
              ISU_ABBRV: 'Samsung',
              FORN_INVSTR_NETBY_QTY: '100',
              ORGN_INVSTR_NETBY_QTY: '200',
              INDIV_INVSTR_NETBY_QTY: '-300',
            }],
          }),
        };
      }
      return {
        ok: false,
        status: 400,
        headers: { get: () => 'text/plain' },
        text: async () => 'bad request',
      };
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading, getLastKrxInvestorTradingDiagnostic } = await import('./krxClient.js');
    const rows = await fetchInvestorTrading('20260508', { symbol: '005930' });
    expect(rows).toEqual([]);
    const diagnostic = getLastKrxInvestorTradingDiagnostic('20260508');
    expect(diagnostic?.endpoint).toBe('MDCSTAT02201');
    expect(diagnostic?.selectedVariant).toBeNull();
    expect(diagnostic?.routedStatus).toBe('BAD_REQUEST_SESSION_OR_PARAM');
    expect(diagnostic?.providerIssue).toBe(false);
    expect(diagnostic?.executionImpact).toBe('NONE');
    expect(diagnostic?.routeKind).toBe('MARKET_INVESTOR_FLOW');
    expect(diagnostic?.marketCode).toBe('STK');
    expect(diagnostic?.responseKind).toBe('HTTP_ERROR');
    expect(diagnostic?.httpStatus).toBe(400);
  });

  it('prefers KRX symbol-level OTP CSV download flow and normalizes individual-issue rows', async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url, init) => {
      const urlText = String(url);
      const body = String(init?.body ?? '');
      if (urlText.includes('/GenerateOTP/generate.cmd')) {
        expect(body).not.toContain('name=fileDown');
        expect(body).toContain('bld=dbms%2FMDC%2FSTAT%2Fstandard%2FMDCSTAT02401');
        expect(body).toContain('MDCSTAT02401');
        expect(body).toContain('strtDd=20260508');
        expect(body).toContain('endDd=20260508');
        expect(body).toContain('isuCd=KR7005930003');
        expect(body).toContain('inqVal=2');
        expect(body).not.toContain('url=');
        expect(body).not.toContain('csvxls_isNo=');
        expect(body).not.toContain('locale=');
        expect(body).not.toContain('trdVolVal=');
        expect(body).not.toContain('isuCd2=');
        expect(body).not.toContain('codeNmisuCd_finder_stkisu0_0=');
        return new Response('otp-token-123', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      if (urlText.includes('/download_csv/download.cmd')) {
        expect(body).toContain('code=otp-token-123');
        const csv = [
          '종목명,투자자구분,순매수수량',
          'Samsung,외국인,100',
          'Samsung,기관,200',
          'Samsung,개인,-300',
        ].join('\n');
        return new Response(csv, {
          status: 200,
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        });
      }
      return new Response('bad request', { status: 400, headers: { 'Content-Type': 'text/plain' } });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading, getLastKrxInvestorTradingDiagnostic } = await import('./krxClient.js');
    const rows = await fetchInvestorTrading('20260508', { symbol: '005930', isuCd: 'KR7005930003' });
    expect(rows).toEqual([{ code: '005930', name: 'Samsung', foreignNetBuy: 100, institutionNetBuy: 200, individualNetBuy: -300 }]);
    const diagnostic = getLastKrxInvestorTradingDiagnostic('20260508');
    expect(diagnostic?.selectedKrxFlowMode).toBe('OTP_CSV');
    expect(diagnostic?.payloadMode).toBe('MINIMAL_STRICT');
    expect(diagnostic?.endpoint).toBe('MDCSTAT02401');
    expect(diagnostic?.routePurpose).toBe('SYMBOL_LEVEL');
    expect(diagnostic?.isuCd).toBe('KR7005930003');
    expect(diagnostic?.shortCodeToIsuCdResolved).toBe(true);
    expect(diagnostic?.otpGenerated).toBe(true);
    expect(diagnostic?.otpLength).toBeGreaterThan(0);
    expect(diagnostic?.csvDownloaded).toBe(true);
    expect(diagnostic?.csvRowCount).toBe(3);
    expect(diagnostic?.csvHeaderDetected).toBe(true);
    expect(diagnostic?.csvColumnKeys).toContain('투자자구분');
    expect(diagnostic?.sentPayloadKeys).toEqual(['bld', 'endDd', 'inqVal', 'isuCd', 'strtDd']);
    expect(diagnostic?.allowedKeys).toEqual(['bld', 'endDd', 'inqVal', 'isuCd', 'strtDd']);
    expect(diagnostic?.forbiddenKeysPresent).toEqual([]);
    expect(diagnostic?.payloadValidation).toBe('PASS');
    expect(diagnostic?.requiredKeysMissing).toEqual([]);
    expect(diagnostic?.selectedVariant).toContain('OTP_CSV');
    expect(diagnostic?.selectedVariant).toContain('MDCSTAT02401');
    expect(diagnostic?.parserStatus).toBe('OK');
  });

  it('uses KRX market-level minimal OTP CSV params without symbol or extended keys when no symbol is requested', async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url, init) => {
      const urlText = String(url);
      const body = String(init?.body ?? '');
      if (urlText.includes('/GenerateOTP/generate.cmd')) {
        expect(body).toContain('MDCSTAT02201');
        expect(body).toContain('inqTpCd=1');
        expect(body).toContain('inqVal=2');
        expect(body).toContain('trdDd=20260508');
        expect(body).toContain('mktId=STK');
        expect(body).not.toContain('detailView=');
        expect(body).not.toContain('trdVolVal=');
        expect(body).not.toContain('share=');
        expect(body).not.toContain('money=');
        expect(body).not.toContain('isuCd=');
        expect(body).not.toContain('symbolCode=');
        expect(body).not.toContain('csvxls_isNo=');
        expect(body).not.toContain('locale=');
        return new Response('market-otp-token', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      if (urlText.includes('/download_csv/download.cmd')) {
        expect(body).toContain('code=market-otp-token');
        return new Response([
          '종목코드,종목명,외국인,기관합계,개인',
          '005930,Samsung,100,200,-300',
        ].join('\n'), {
          status: 200,
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        });
      }
      return new Response('bad request', { status: 400, headers: { 'Content-Type': 'text/plain' } });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading, getLastKrxInvestorTradingDiagnostic } = await import('./krxClient.js');
    const rows = await fetchInvestorTrading('20260508');
    expect(rows[0]).toMatchObject({ code: '005930', foreignNetBuy: 100, institutionNetBuy: 200, individualNetBuy: -300 });
    const diagnostic = getLastKrxInvestorTradingDiagnostic('20260508');
    expect(diagnostic?.endpoint).toBe('MDCSTAT02201');
    expect(diagnostic?.payloadMode).toBe('MINIMAL_STRICT');
    expect(diagnostic?.routePurpose).toBe('MARKET_LEVEL');
    expect(diagnostic?.inqTpCd).toBe('1');
    expect(diagnostic?.inqVal).toBe('2');
    expect(diagnostic?.detailView).toBeNull();
    expect(diagnostic?.parameterKeys).toContain('inqTpCd');
    expect(diagnostic?.parameterKeys).toContain('inqVal');
    expect(diagnostic?.parameterKeys).not.toContain('detailView');
    expect(diagnostic?.sentPayloadKeys).toEqual(['bld', 'inqTpCd', 'inqVal', 'mktId', 'name', 'trdDd']);
    expect(diagnostic?.forbiddenKeysPresent).toEqual([]);
    expect(diagnostic?.requiredKeysMissing).toEqual([]);
    expect(diagnostic?.parserStatus).toBe('OK');
  });

  it('omits empty and sentinel KRX payload values while preserving numeric zero', async () => {
    vi.resetModules();
    const { __krxClientTestOnly } = await import('./krxClient.js');
    const result = __krxClientTestOnly.sanitizeKrxPayload({
      bld: 'dbms/MDC/STAT/standard/MDCSTAT02201',
      isuCd: 'NONE',
      symbolCode: '',
      unknown: 'UNKNOWN',
      na: 'N/A',
      nil: null,
      undef: undefined,
      zero: 0,
      inqVal: '2',
    });
    expect(result.payload).toEqual({
      bld: 'dbms/MDC/STAT/standard/MDCSTAT02201',
      zero: '0',
      inqVal: '2',
    });
    expect(result.omittedKeys.sort()).toEqual(['isuCd', 'na', 'nil', 'symbolCode', 'undef', 'unknown']);
  });

  it('blocks MDCSTAT02401 payloads if forbidden name key is present', async () => {
    vi.resetModules();
    const { __krxClientTestOnly } = await import('./krxClient.js');
    const variant = {
      id: 'OTP_CSV:MINIMAL_STRICT:MDCSTAT02401:SYMBOL_ISU:strtDd/endDd:ALL',
      mode: 'OTP_CSV' as const,
      payloadMode: 'MINIMAL_STRICT' as const,
      endpoint: 'MDCSTAT02401',
      bld: 'dbms/MDC/STAT/standard/MDCSTAT02401',
      routeKind: 'SYMBOL_INVESTOR_FLOW' as const,
      routePurpose: 'SYMBOL_LEVEL' as const,
      dateParam: 'strtDd/endDd' as const,
      marketCode: 'ALL' as const,
      symbolCode: '005930',
      symbolRequired: true,
      shortCodeToIsuCdResolved: true,
      isuCd: 'KR7005930003',
      requiredParamMissing: null,
      inqVal: '2',
      detailView: null,
      otpRequired: true,
      params: {
        strtDd: '20260508',
        endDd: '20260508',
        isuCd: 'KR7005930003',
        inqVal: '2',
      },
    };
    const validation = __krxClientTestOnly.validateKrxPayloadForVariantAdr0526(variant, {
      name: 'fileDown',
      bld: variant.bld,
      strtDd: '20260508',
      endDd: '20260508',
      isuCd: 'KR7005930003',
      inqVal: '2',
    });
    expect(validation.allowedKeys).toEqual(['bld', 'endDd', 'inqVal', 'isuCd', 'strtDd']);
    expect(validation.forbiddenKeysPresent).toEqual(['name']);
    expect(validation.payloadValidation).toBe('BLOCKED_BY_PAYLOAD_VALIDATION');
  });

  it('records safe variant diagnostics when every KRX investor-flow variant returns HTTP 400', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => 'text/plain' },
      text: async () => 'bad request',
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading, getLastKrxInvestorTradingDiagnostic } = await import('./krxClient.js');
    await expect(fetchInvestorTrading('20260508', { symbol: '005930' })).resolves.toEqual([]);
    const diagnostic = getLastKrxInvestorTradingDiagnostic('20260508');
    expect(diagnostic?.parserStatus).toBe('PROVIDER_EMPTY_RESPONSE');
    expect(diagnostic?.endpointIssueHint).toBe('ENDPOINT_PARAMETER_ERROR');
    expect(diagnostic?.routedStatus).toBe('BAD_REQUEST_SESSION_OR_PARAM');
    expect(diagnostic?.responseKind).toBe('HTTP_ERROR');
    expect(diagnostic?.httpStatus).toBe(400);
    expect((diagnostic?.attemptedVariants?.length ?? 0)).toBeGreaterThan(1);
    expect(diagnostic?.summary).toContain('selectedVariant=NONE');
    expect(diagnostic?.summary).toContain('selectedKrxFlowMode=OTP_CSV');
    expect(JSON.stringify(diagnostic)).not.toContain('bad request');
  });

  it('guards MDCSTAT02201/02203 after market close without issuing HTTP fetches', async () => {
    delete process.env.KRX_TIME_WINDOW_GATING_DISABLED;
    process.env.KRX_INVESTOR_DETAIL_ENABLED = 'true';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading, getLastKrxInvestorTradingDiagnostic } = await import('./krxClient.js');
    const rows = await fetchInvestorTrading('20260508', { now: new Date('2026-05-14T12:50:00.000Z') });
    const diagnostic = getLastKrxInvestorTradingDiagnostic('20260508');

    expect(rows).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(diagnostic?.routedStatus).toBe('SESSION_CLOSED_NOT_APPLICABLE');
    expect(diagnostic?.providerIssue).toBe(false);
    expect(diagnostic?.marketSignal).toBe(false);
    expect(diagnostic?.executionImpact).toBe('NONE');
    process.env.KRX_TIME_WINDOW_GATING_DISABLED = 'true';
  });

  it('guards MDCSTAT02201/02203 when KRX_INVESTOR_DETAIL_ENABLED is not true', async () => {
    delete process.env.KRX_INVESTOR_DETAIL_ENABLED;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading, getLastKrxInvestorTradingDiagnostic } = await import('./krxClient.js');
    const rows = await fetchInvestorTrading('20260508', { now: new Date('2026-05-14T01:30:00.000Z') });
    const diagnostic = getLastKrxInvestorTradingDiagnostic('20260508');

    expect(rows).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(diagnostic?.routedStatus).toBe('ENDPOINT_PARAM_NOT_READY');
    expect(diagnostic?.providerIssue).toBe(false);
    expect(diagnostic?.executionImpact).toBe('NONE');
  });

  it('isolates intraday MDCSTAT02201 HTTP 400 and prevents repeated endpoint calls with cooldown', async () => {
    process.env.KRX_INVESTOR_DETAIL_ENABLED = 'true';
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => 'text/plain' },
      text: async () => 'bad request',
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading, getLastKrxInvestorTradingDiagnostic } = await import('./krxClient.js');
    await expect(fetchInvestorTrading('20260508', { now: new Date('2026-05-14T01:30:00.000Z') })).resolves.toEqual([]);
    const callsAfterFirst = fetchSpy.mock.calls.length;
    await expect(fetchInvestorTrading('20260508', { now: new Date('2026-05-14T01:31:00.000Z'), allowDisabledAutoFetch: true })).resolves.toEqual([]);
    const diagnostic = getLastKrxInvestorTradingDiagnostic('20260508');

    expect(callsAfterFirst).toBe(2);
    expect(fetchSpy.mock.calls.length).toBe(2);
    expect(diagnostic?.routedStatus).toBe('BAD_REQUEST_SESSION_OR_PARAM');
    expect(diagnostic?.providerIssue).toBe(false);
    expect(diagnostic?.marketSignal).toBe(false);
    expect(diagnostic?.executionImpact).toBe('NONE');
    expect(diagnostic?.useForRouter).toBe(false);
    expect(diagnostic?.useForGate).toBe(false);
  });

  it('classifies incomplete endpoint params as not ready before fetch', async () => {
    vi.resetModules();
    const { __krxClientTestOnly } = await import('./krxClient.js');
    expect(__krxClientTestOnly.hasKrxInvestorDetailRequiredParams({
      id: 'DIRECT_JSON:MDCSTAT02203:SYMBOL_INVESTOR_FLOW:STK:trdDd:symbol',
      mode: 'DIRECT_JSON',
      payloadMode: 'EXTENDED_VARIANT',
      endpoint: 'MDCSTAT02203',
      bld: 'dbms/MDC/STAT/standard/MDCSTAT02203',
      routeKind: 'SYMBOL_INVESTOR_FLOW',
      routePurpose: 'SYMBOL_LEVEL',
      dateParam: 'trdDd',
      marketCode: 'STK',
      symbolCode: null,
      isuCd: null,
      shortCodeToIsuCdResolved: false,
      requiredParamMissing: 'isuCd',
      symbolRequired: true,
      otpRequired: false,
      params: { trdDd: '20260508', mktId: 'STK' },
    })).toBe(false);
  });

  it('동일 날짜 재호출은 캐시 히트로 fetch 를 한 번만 사용한다', async () => {
    const body = { OutBlock_1: [] };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchPerPbr } = await import('./krxClient.js');
    await fetchPerPbr('20250419');
    await fetchPerPbr('20250419');
    await fetchPerPbr('20250419');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('잘못된 형식의 date 인자는 오늘 날짜로 대체된다(throw 없음)', async () => {
    const body = { OutBlock_1: [] };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading } = await import('./krxClient.js');
    await expect(fetchInvestorTrading('bad-date')).resolves.toEqual([]);
  });
});

// ── 블루프린트 파사드 검증 (경로 A: KRX Open API 인증) ──────────────────────
describe('krxClient — 블루프린트 파사드', () => {
  const ORIG_FETCH = globalThis.fetch;
  const ORIG_ENV = {
    KRX_API_KEY: process.env.KRX_API_KEY,
    KRX_OPENAPI_AUTH_KEY: process.env.KRX_OPENAPI_AUTH_KEY,
    KRX_API_DISABLED: process.env.KRX_API_DISABLED,
    KRX_OPENAPI_DISABLED: process.env.KRX_OPENAPI_DISABLED,
    KIS_FIRST_REBUILD_MODE: process.env.KIS_FIRST_REBUILD_MODE,
    KIS_ONLY_REBUILD_MODE: process.env.KIS_ONLY_REBUILD_MODE,
    KRX_AUTO_FETCH_DISABLED: process.env.KRX_AUTO_FETCH_DISABLED,
    KRX_TIME_WINDOW_GATING_DISABLED: process.env.KRX_TIME_WINDOW_GATING_DISABLED,
  };

  beforeEach(() => {
    process.env.KRX_API_KEY = 'blueprint-key';
    delete process.env.KRX_OPENAPI_AUTH_KEY;
    delete process.env.KRX_API_DISABLED;
    delete process.env.KIS_FIRST_REBUILD_MODE;
    delete process.env.KIS_ONLY_REBUILD_MODE;
    delete process.env.KRX_AUTO_FETCH_DISABLED;
    process.env.KRX_TIME_WINDOW_GATING_DISABLED = 'true';
    delete process.env.KRX_OPENAPI_DISABLED;
  });

  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
    process.env.KRX_API_KEY = ORIG_ENV.KRX_API_KEY;
    process.env.KRX_OPENAPI_AUTH_KEY = ORIG_ENV.KRX_OPENAPI_AUTH_KEY;
    process.env.KRX_API_DISABLED = ORIG_ENV.KRX_API_DISABLED;
    process.env.KRX_OPENAPI_DISABLED = ORIG_ENV.KRX_OPENAPI_DISABLED;
    process.env.KIS_FIRST_REBUILD_MODE = ORIG_ENV.KIS_FIRST_REBUILD_MODE;
    process.env.KIS_ONLY_REBUILD_MODE = ORIG_ENV.KIS_ONLY_REBUILD_MODE;
    process.env.KRX_AUTO_FETCH_DISABLED = ORIG_ENV.KRX_AUTO_FETCH_DISABLED;
    process.env.KRX_TIME_WINDOW_GATING_DISABLED = ORIG_ENV.KRX_TIME_WINDOW_GATING_DISABLED;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('getKrxAuthKey()는 KRX_API_KEY 를 우선으로, 없으면 레거시 KRX_OPENAPI_AUTH_KEY 를 반환한다', async () => {
    vi.resetModules();
    const mod = await import('./krxClient.js');
    expect(mod.getKrxAuthKey()).toBe('blueprint-key');

    delete process.env.KRX_API_KEY;
    process.env.KRX_OPENAPI_AUTH_KEY = 'legacy-key';
    vi.resetModules();
    const mod2 = await import('./krxClient.js');
    expect(mod2.getKrxAuthKey()).toBe('legacy-key');
  });

  it('fetchKrxDailyOhlcv(code)는 KOSPI 일별매매에서 일치 종목을 반환한다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        OutBlock_1: [
          { BAS_DD: '20260417', ISU_SRT_CD: 'A005930', ISU_NM: '삼성전자',
            MKT_NM: 'KOSPI', TDD_CLSPRC: '72,400', MKTCAP: '432000000000000',
            LIST_SHRS: '5969782550' },
        ],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const openApi = await import('./krxOpenApi.js');
    openApi._resetKrxOpenApiBreaker();
    openApi.resetKrxOpenApiCache();
    const { fetchKrxDailyOhlcv } = await import('./krxClient.js');
    const row = await fetchKrxDailyOhlcv('005930', '20260417');
    expect(row).not.toBeNull();
    expect(row?.code).toBe('005930');
    expect(row?.close).toBe(72400);
  });

  it('fetchKrxDailyOhlcv(code)는 6자리가 아니면 null', async () => {
    vi.resetModules();
    const { fetchKrxDailyOhlcv } = await import('./krxClient.js');
    await expect(fetchKrxDailyOhlcv('12345')).resolves.toBeNull();
    await expect(fetchKrxDailyOhlcv('abcdef')).resolves.toBeNull();
  });

  it('fetchKrxSectorIndices()는 KRX 시리즈를 우선 사용한다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        OutBlock_1: [
          { BAS_DD: '20260417', IDX_IND_CD: '2001', IDX_NM: 'KRX 에너지',
            CLSPRC_IDX: '1,234.56' },
        ],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const openApi = await import('./krxOpenApi.js');
    openApi._resetKrxOpenApiBreaker();
    openApi.resetKrxOpenApiCache();
    const { fetchKrxSectorIndices } = await import('./krxClient.js');
    const rows = await fetchKrxSectorIndices('20260417');
    expect(rows).toHaveLength(1);
    expect(rows[0].indexName).toBe('KRX 에너지');
  });


  it('KIS_FIRST_REBUILD_MODE=true 이면 KRX sector OpenAPI HTTP client를 호출하지 않는다', async () => {
    process.env.KIS_FIRST_REBUILD_MODE = 'true';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const openApi = await import('./krxOpenApi.js');
    openApi._resetKrxOpenApiBreaker();
    openApi.resetKrxOpenApiCache();
    const { fetchKrxSectorIndices } = await import('./krxClient.js');
    await expect(fetchKrxSectorIndices('20260417')).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetchKrxMarketCap()은 marketCap 이 0 인 행을 제거하고 원 단위 정수로 반환한다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        OutBlock_1: [
          { BAS_DD: '20260417', ISU_SRT_CD: '005930', ISU_NM: '삼성전자',
            MKT_NM: 'KOSPI', MKTCAP: '432,000,000,000,000', LIST_SHRS: '5,969,782,550',
            TDD_CLSPRC: '72,400' },
          { BAS_DD: '20260417', ISU_SRT_CD: '999999', ISU_NM: 'ZERO',
            MKT_NM: 'KOSPI', MKTCAP: '0', LIST_SHRS: '0', TDD_CLSPRC: '0' },
        ],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const openApi = await import('./krxOpenApi.js');
    openApi._resetKrxOpenApiBreaker();
    openApi.resetKrxOpenApiCache();
    const { fetchKrxMarketCap } = await import('./krxClient.js');
    const rows = await fetchKrxMarketCap('20260417');
    // KOSPI 한 건 + KOSDAQ(동일 mock 본문) 한 건 = 0 건 제거 후 2 건.
    // (동일 fetch mock 이 두 호출에 동일 본문을 반환하므로 삼성전자가 두 번 포함됨)
    expect(rows.every(r => r.marketCap > 0)).toBe(true);
    expect(rows[0]).toMatchObject({
      code: '005930',
      marketCap: 432000000000000,
      listedShares: 5969782550,
      market: 'KOSPI',
    });
  });

  it('fetchKrxInvestorTrading / fetchKrxPerPbr / fetchKrxShortBalance 는 레거시 함수와 동일 참조', async () => {
    vi.resetModules();
    const mod = await import('./krxClient.js');
    expect(mod.fetchKrxInvestorTrading).toBe(mod.fetchInvestorTrading);
    expect(mod.fetchKrxPerPbr).toBe(mod.fetchPerPbr);
    expect(mod.fetchKrxShortBalance).toBe(mod.fetchShortBalance);
  });
});
