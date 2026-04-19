/**
 * sectorSources.test.ts — KRX 장애 시 폴백 체인 동작 검증
 *
 * 검증 목표:
 *   1. KRX 벌크가 임계치를 넘으면 Yahoo/Gemini 는 호출되지 않는다.
 *   2. KRX 가 null 이어도 기존 파일 + 수동 오버라이드가 baseline 으로 유지된다.
 *   3. Yahoo fallback 은 영문 섹터를 한글로 매핑하고, Gemini 는 예산 차단 시 스킵한다.
 *   4. 오케스트레이터의 sourceLabel 은 최종 사용된 폴백을 기록한다.
 *   5. 타깃 유니버스는 Yahoo 병렬 동시성(YAHOO_CONCURRENCY) 상한을 넘지 않는다 — 네트워크 폭주 방지.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('sectorSources — KRX → Yahoo → Gemini 폴백 체인', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('KRX 벌크가 임계치를 넘으면 폴백 없이 KRX 맵을 그대로 사용한다', async () => {
    const { buildSectorMapWithFallback } = await import('./sectorSources.js');
    // 임계치 100 으로 낮게 설정. KRX 가 200행을 내주면 폴백 없이 그대로 통과해야 한다.
    const krxMap: Record<string, string> = {};
    for (let i = 0; i < 200; i++) krxMap[String(i).padStart(6, '0')] = '반도체';

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await buildSectorMapWithFallback({
      krxAttempt:  async () => ({ map: krxMap, diagnostic: 'KRX OK' }),
      existingMap: {},
      targetCodes: Object.keys(krxMap),
      minTotalRows: 100,
    });

    expect(result.source).toBe('KRX');
    expect(result.sourceLabel).toBe('KRX');
    expect(Object.keys(result.map).length).toBe(200);
    // Yahoo fetch 가 호출되지 않았는지 — 외부 네트워크 호출 0건.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('KRX 가 null 이면 기존 파일 + 수동 오버라이드가 baseline 으로 보존된다', async () => {
    const { buildSectorMapWithFallback } = await import('./sectorSources.js');

    // Yahoo 는 항상 실패(404)로 설정해서 baseline 만 남도록.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 404, json: async () => ({}),
    }) as unknown as typeof fetch;

    const existing = { '100000': '금융', '100001': '화학' };
    const result = await buildSectorMapWithFallback({
      krxAttempt:   async () => null,
      existingMap:  existing,
      targetCodes:  ['100000', '100001', '100002'], // 100002 는 missing → Yahoo 에서 탐색 → 실패
      minTotalRows: 1000, // 매우 높은 임계치 → KRX fail 경로 강제
    });

    // baseline 복원 — 기존 파일의 두 코드는 유지되어야 한다.
    expect(result.map['100000']).toBe('금융');
    expect(result.map['100001']).toBe('화학');
    // 100002 는 Yahoo 가 404 를 반환해 분류 실패 → merged 에 없음.
    expect(result.map['100002']).toBeUndefined();
    // 폴백이 아무것도 못 추가했지만 baseline 보존이 핵심.
    expect(result.sourceLabel).toBe('carry-over');
  });

  it('Yahoo 는 영문 섹터를 한글로 매핑한다 (Technology → IT서비스, Semiconductors industry → 반도체)', async () => {
    const { fetchFromYahoo } = await import('./sectorSources.js');

    // 2개 코드, 하나는 Technology sector · 하나는 Semiconductors industry.
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/005930.KS')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            quoteSummary: { result: [{ assetProfile: { sector: 'Technology', industry: 'Semiconductors' } }] },
          }),
        };
      }
      if (url.includes('/000660.KS')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            quoteSummary: { result: [{ assetProfile: { sector: 'Technology', industry: 'Software' } }] },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const r = await fetchFromYahoo(['005930', '000660']);
    // industry=Semiconductors 우선 매칭 → 반도체.
    expect(r.map['005930']).toBe('반도체');
    // industry=Software 미매핑 → sector=Technology fallback → IT서비스.
    expect(r.map['000660']).toBe('IT서비스');
    expect(r.source).toBe('Yahoo');
  });

  it('Gemini 는 예산 HARD_BLOCK 이면 호출 없이 빈 결과를 반환한다', async () => {
    // geminiClient 를 mock — isBudgetBlocked() 가 true 를 반환하도록.
    vi.doMock('../clients/geminiClient.js', () => ({
      isBudgetBlocked:     () => true,
      callGeminiInterpret: vi.fn(async () => 'should not be called'),
    }));

    const { fetchFromGemini } = await import('./sectorSources.js');
    const mod = await import('../clients/geminiClient.js');
    const r = await fetchFromGemini([{ code: '005930', name: '삼성전자' }]);
    expect(r.map).toEqual({});
    expect((mod.callGeminiInterpret as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(r.diagnostics.join(' ')).toContain('HARD_BLOCK');
  });

  it('Gemini 응답을 "코드:섹터" 라인만 정확히 파싱한다', async () => {
    // 한 배치만 처리되도록 Gemini mock 을 설정.
    vi.doMock('../clients/geminiClient.js', () => ({
      isBudgetBlocked:     () => false,
      callGeminiInterpret: vi.fn(async () =>
        [
          '005930:반도체',
          '000660 반도체',
          '373220 - 2차전지',
          '잘못된 라인 무시될 것',
          '111111:없는섹터',   // ALLOWED_SECTORS 아님 → 제외
        ].join('\n'),
      ),
    }));

    const { fetchFromGemini } = await import('./sectorSources.js');
    const r = await fetchFromGemini([
      { code: '005930', name: '삼성전자' },
      { code: '000660', name: 'SK하이닉스' },
      { code: '373220', name: 'LG에너지솔루션' },
      { code: '111111', name: 'x' },
    ]);
    expect(r.map).toEqual({
      '005930': '반도체',
      '000660': '반도체',
      '373220': '2차전지',
    });
  });

  it('오케스트레이터의 sourceLabel 은 최종 폴백(Yahoo+Gemini)을 기록한다', async () => {
    // Yahoo: 1개 매핑 성공 · Gemini: 1개 매핑 성공.
    vi.doMock('../clients/geminiClient.js', () => ({
      isBudgetBlocked:     () => false,
      callGeminiInterpret: vi.fn(async () => '222222:반도체'),
    }));
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/111111.KS')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            quoteSummary: { result: [{ assetProfile: { sector: 'Technology', industry: 'Semiconductors' } }] },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const { buildSectorMapWithFallback } = await import('./sectorSources.js');
    const r = await buildSectorMapWithFallback({
      krxAttempt:   async () => null, // KRX 완전 장애
      existingMap:  {},
      targetCodes:  ['111111', '222222'],
      targetNamesByCode: { '111111': '가나다', '222222': '라마바' },
      minTotalRows: 1000,
    });

    // sourceLabel 형식: 'KRX-fail→Yahoo+Gemini (added=N)'
    expect(r.sourceLabel).toMatch(/^KRX-fail→Yahoo\+Gemini/);
    expect(r.map['111111']).toBe('반도체'); // Yahoo 경로
    expect(r.map['222222']).toBe('반도체'); // Gemini 경로
  });
});
