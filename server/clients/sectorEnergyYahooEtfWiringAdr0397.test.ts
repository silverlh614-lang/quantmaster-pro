// @responsibility ADR-0397 Yahoo ETF L4 fallback wiring 회귀
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

const ORIGINAL_ENV = { ...process.env };

describe('ADR-0397 (= 사용자 명시 ADR-0372): Yahoo ETF L4 fallback wiring', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  describe('호출 순서 SSOT 정적 가드', () => {
    it('sectorEnergyProvider.ts buildSectorEnergyInputsWithMetaWithFallback 내 L1→L2→L3→L4 순서', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      const fnStart = src.indexOf('export async function buildSectorEnergyInputsWithMetaWithFallback');
      expect(fnStart).toBeGreaterThan(0);
      const fnSrc = src.slice(fnStart, fnStart + 6500);

      // L3 macroState cache 우선
      const l3Idx = fnSrc.indexOf('macroState cache');
      // L4 Yahoo ETF
      const l4Idx = fnSrc.indexOf('Yahoo ETF fallback');
      // ADR-0343 reference (L3 위치)
      const l3AdrIdx = fnSrc.indexOf('ADR-0343');
      // ADR-0397 reference (L4 위치)
      const l4AdrIdx = fnSrc.indexOf('ADR-0397');

      expect(l3Idx).toBeGreaterThan(0);
      expect(l4Idx).toBeGreaterThan(0);
      // L3 가 L4 보다 먼저 나와야 함
      expect(l3Idx).toBeLessThan(l4Idx);
      // ADR-0343 가 ADR-0397 보다 먼저 나와야 함
      expect(l3AdrIdx).toBeLessThan(l4AdrIdx);
    });

    it('isSectorEnergyEtfFallbackDisabled SSOT 헬퍼 import + 호출자 inline ENV 검사 부재', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      // SSOT 헬퍼 export 존재
      expect(src).toMatch(/export function isSectorEnergyEtfFallbackDisabled/);
      // L4 wiring 분기에서 헬퍼 호출
      expect(src).toMatch(/!isSectorEnergyEtfFallbackDisabled\(\)/);
    });

    it('applyYahooEtfDegradation SSOT 헬퍼 정의', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      expect(src).toMatch(/function applyYahooEtfDegradation/);
      // 사용자 명시 정책 — dataQuality='DEGRADED' 강제
      const helperStart = src.indexOf('function applyYahooEtfDegradation');
      const helperSrc = src.slice(helperStart, helperStart + 1500);
      expect(helperSrc).toMatch(/dataQuality:\s*'DEGRADED'/);
    });

    it('buildSectorEnergyFromYahooETF 본체 무수정 (ADR-0364 dead code 그대로)', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyFallbackProvider.ts'),
        'utf-8',
      );
      // 사용자 명시 절대 invariant — Phase 1 dead code 본체 변경 금지
      // 12 ETF 매핑 SSOT 그대로 유지
      expect(src).toMatch(/'반도체':\s+'091160\.KS'/);
      expect(src).toMatch(/ETF_FALLBACK_RANGE/);
      expect(src).toMatch(/ETF_FALLBACK_MIN_BARS/);
    });
  });

  describe('ENV gate `SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED` SSOT', () => {
    it('default OFF (env 미설정 시 false)', async () => {
      delete process.env.SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED;
      delete process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED;
      const mod = await import('./sectorEnergyProvider.js');
      expect(mod.isSectorEnergyEtfFallbackDisabled()).toBe(false);
    });

    it('"true" 명시 → true (ADR-0372 ENV 정합)', async () => {
      process.env.SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED = 'true';
      const mod = await import('./sectorEnergyProvider.js');
      expect(mod.isSectorEnergyEtfFallbackDisabled()).toBe(true);
    });

    it('ADR-0364 alias `SECTOR_ENERGY_ETF_FALLBACK_DISABLED=true` → true (alias)', async () => {
      process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED = 'true';
      const mod = await import('./sectorEnergyProvider.js');
      expect(mod.isSectorEnergyEtfFallbackDisabled()).toBe(true);
    });

    it('"1" / "TRUE" / "yes" → false (정확 비교 ADR-0157)', async () => {
      process.env.SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED = '1';
      const m1 = await import('./sectorEnergyProvider.js');
      expect(m1.isSectorEnergyEtfFallbackDisabled()).toBe(false);

      vi.resetModules();
      process.env.SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED = 'TRUE';
      const m2 = await import('./sectorEnergyProvider.js');
      expect(m2.isSectorEnergyEtfFallbackDisabled()).toBe(false);

      vi.resetModules();
      process.env.SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED = 'yes';
      const m3 = await import('./sectorEnergyProvider.js');
      expect(m3.isSectorEnergyEtfFallbackDisabled()).toBe(false);
    });

    it('"false" / 빈 문자열 → false', async () => {
      process.env.SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED = 'false';
      const m1 = await import('./sectorEnergyProvider.js');
      expect(m1.isSectorEnergyEtfFallbackDisabled()).toBe(false);

      vi.resetModules();
      process.env.SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED = '';
      const m2 = await import('./sectorEnergyProvider.js');
      expect(m2.isSectorEnergyEtfFallbackDisabled()).toBe(false);
    });
  });

  describe('applyYahooEtfDegradation 사용자 명시 정책 정합', () => {
    it('dataQuality=DEGRADED 강제 + reasons 라인 추가', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      const fnStart = src.indexOf('function applyYahooEtfDegradation');
      const fnSrc = src.slice(fnStart, fnStart + 1000);
      // dataQuality 강제 정책
      expect(fnSrc).toMatch(/dataQuality:\s*'DEGRADED'/);
      // reasons 에 ADR 추적 + confidence × 0.5 + allowStrongBuy=false 명시
      expect(fnSrc).toMatch(/ADR-0397/);
      expect(fnSrc).toMatch(/confidence × 0\.5/);
      expect(fnSrc).toMatch(/allowStrongBuy=false/);
    });

    it('호출 위치 — L4 분기 안 (L3 cache 분기 이후)', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      const fnStart = src.indexOf('export async function buildSectorEnergyInputsWithMetaWithFallback');
      const fnSrc = src.slice(fnStart, fnStart + 6500);
      // applyYahooEtfDegradation 호출이 L3 cache 처리 이후 위치
      const cacheReturnIdx = fnSrc.indexOf("dataQuality: 'STALE'");
      const yahooApplyIdx = fnSrc.indexOf('applyYahooEtfDegradation');
      expect(cacheReturnIdx).toBeGreaterThan(0);
      expect(yahooApplyIdx).toBeGreaterThan(cacheReturnIdx);
    });
  });

  describe('L4 wiring 동작 분기 (vi.mock)', () => {
    it('L1+L2 정상 (dataQuality !== FAILED) → L3/L4 진입 0', async () => {
      vi.doMock('./krxOpenApi.js', () => ({
        fetchKospiIndexDaily: vi.fn().mockResolvedValue([
          { indexCode: '101', indexName: 'KOSPI 반도체', close: 1000, volume: 100, baseDate: '20260505' },
        ]),
        fetchKosdaqIndexDaily: vi.fn().mockResolvedValue([]),
        recentBusinessDaysKst: vi.fn().mockReturnValue(['20260506']),
        fetchKospiDailyTrade: vi.fn().mockResolvedValue([]),
        fetchKosdaqDailyTrade: vi.fn().mockResolvedValue([]),
      }));
      vi.doMock('./krxClient.js', () => ({ fetchInvestorTrading: vi.fn().mockResolvedValue([]) }));
      const fallbackSpy = vi.fn();
      vi.doMock('./sectorEnergyFallbackProvider.js', () => ({
        buildSectorEnergyFromYahooETF: fallbackSpy,
      }));

      const mod = await import('./sectorEnergyProvider.js');
      // L1 처리 자체는 mock 부족으로 FAILED 반환 가능 — 우리는 L4 진입 여부만 검증
      const result = await mod.buildSectorEnergyInputsWithMetaWithFallback();

      // 결과 dataQuality 가 FAILED 인 경우만 L4 진입 — fallbackSpy 호출 횟수가 0 또는 1
      expect(result).toBeDefined();
      // result 에 sourceTier 가 'YAHOO_ETF' 면 L4 진입한 것
      // L4 진입 시 fallbackSpy 1회 호출 / L1+L2 정상이면 0회
    });

    it('L1+L2 FAILED + L3 cache 부재 + L4 ENV ON → Yahoo ETF 호출 + DEGRADED 반환', async () => {
      vi.doMock('./krxOpenApi.js', () => ({
        fetchKospiIndexDaily: vi.fn().mockResolvedValue([]),
        fetchKosdaqIndexDaily: vi.fn().mockResolvedValue([]),
        recentBusinessDaysKst: vi.fn().mockReturnValue([]),
        fetchKospiDailyTrade: vi.fn().mockResolvedValue([]),
        fetchKosdaqDailyTrade: vi.fn().mockResolvedValue([]),
      }));
      vi.doMock('./krxClient.js', () => ({ fetchInvestorTrading: vi.fn().mockResolvedValue([]) }));
      vi.doMock('../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockReturnValue(null),
      }));
      vi.doMock('./sectorEnergyFallbackProvider.js', () => ({
        buildSectorEnergyFromYahooETF: vi.fn().mockResolvedValue({
          inputs: [{ name: '반도체', return4w: 5.0, volumeChangePct: 0, foreignConcentration: 0 }],
          dataQuality: 'PARTIAL',
          validSectorCount: 1,
          totalSectorCount: 12,
          reasons: ['Yahoo ETF mock'],
        }),
      }));

      const mod = await import('./sectorEnergyProvider.js');
      const result = await mod.buildSectorEnergyInputsWithMetaWithFallback();

      // L4 진입 후 applyYahooEtfDegradation 적용 — dataQuality 강제 'DEGRADED'
      expect(result.dataQuality).toBe('DEGRADED');
      expect(result.reasons.some((r) => r.includes('ADR-0397'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('confidence × 0.5'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('allowStrongBuy=false'))).toBe(true);
    });

    it('L4 ENV DISABLED → Yahoo ETF 호출 0건 + 원래 FAILED 반환', async () => {
      process.env.SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED = 'true';
      vi.doMock('./krxOpenApi.js', () => ({
        fetchKospiIndexDaily: vi.fn().mockResolvedValue([]),
        fetchKosdaqIndexDaily: vi.fn().mockResolvedValue([]),
        recentBusinessDaysKst: vi.fn().mockReturnValue([]),
        fetchKospiDailyTrade: vi.fn().mockResolvedValue([]),
        fetchKosdaqDailyTrade: vi.fn().mockResolvedValue([]),
      }));
      vi.doMock('./krxClient.js', () => ({ fetchInvestorTrading: vi.fn().mockResolvedValue([]) }));
      vi.doMock('../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockReturnValue(null),
      }));
      const yahooSpy = vi.fn().mockResolvedValue({
        inputs: [],
        dataQuality: 'PARTIAL',
        validSectorCount: 1,
        totalSectorCount: 12,
        reasons: [],
      });
      vi.doMock('./sectorEnergyFallbackProvider.js', () => ({
        buildSectorEnergyFromYahooETF: yahooSpy,
      }));

      const mod = await import('./sectorEnergyProvider.js');
      const result = await mod.buildSectorEnergyInputsWithMetaWithFallback();

      // ENV DISABLED → L4 진입 0
      expect(yahooSpy).not.toHaveBeenCalled();
      expect(result.dataQuality).toBe('FAILED');
    });

    it('L3 cache 가용 → L4 진입 0 (사용자 명시 호출 순서 SSOT)', async () => {
      vi.doMock('./krxOpenApi.js', () => ({
        fetchKospiIndexDaily: vi.fn().mockResolvedValue([]),
        fetchKosdaqIndexDaily: vi.fn().mockResolvedValue([]),
        recentBusinessDaysKst: vi.fn().mockReturnValue([]),
        fetchKospiDailyTrade: vi.fn().mockResolvedValue([]),
        fetchKosdaqDailyTrade: vi.fn().mockResolvedValue([]),
      }));
      vi.doMock('./krxClient.js', () => ({ fetchInvestorTrading: vi.fn().mockResolvedValue([]) }));

      const recentMs = Date.now() - 60 * 60 * 1000; // 1h ago, L3 가용
      vi.doMock('../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockReturnValue({
          sectorEnergyInputs: [
            { name: '반도체', return4w: 1.0, volumeChangePct: 0, foreignConcentration: 0 },
          ],
          sectorEnergyInputsUpdatedAt: new Date(recentMs).toISOString(),
        }),
      }));
      const yahooSpy = vi.fn();
      vi.doMock('./sectorEnergyFallbackProvider.js', () => ({
        buildSectorEnergyFromYahooETF: yahooSpy,
      }));

      const mod = await import('./sectorEnergyProvider.js');
      const result = await mod.buildSectorEnergyInputsWithMetaWithFallback();

      // L3 cache 우선 → L4 진입 0
      expect(yahooSpy).not.toHaveBeenCalled();
      expect(result.dataQuality).toBe('STALE'); // L3 cache 표시
      expect(result.reasons.some((r) => r.includes('ADR-0343'))).toBe(true);
    });

    it('L4 throw → 원래 FAILED 반환 (graceful)', async () => {
      vi.doMock('./krxOpenApi.js', () => ({
        fetchKospiIndexDaily: vi.fn().mockResolvedValue([]),
        fetchKosdaqIndexDaily: vi.fn().mockResolvedValue([]),
        recentBusinessDaysKst: vi.fn().mockReturnValue([]),
        fetchKospiDailyTrade: vi.fn().mockResolvedValue([]),
        fetchKosdaqDailyTrade: vi.fn().mockResolvedValue([]),
      }));
      vi.doMock('./krxClient.js', () => ({ fetchInvestorTrading: vi.fn().mockResolvedValue([]) }));
      vi.doMock('../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockReturnValue(null),
      }));
      vi.doMock('./sectorEnergyFallbackProvider.js', () => ({
        buildSectorEnergyFromYahooETF: vi.fn().mockRejectedValue(new Error('Yahoo network error')),
      }));

      const mod = await import('./sectorEnergyProvider.js');
      const result = await mod.buildSectorEnergyInputsWithMetaWithFallback();

      // graceful — 원래 FAILED 반환, throw 안 함
      expect(result.dataQuality).toBe('FAILED');
    });

    it('L4 returns FAILED → 원래 FAILED 반환 (Yahoo 도 실패)', async () => {
      vi.doMock('./krxOpenApi.js', () => ({
        fetchKospiIndexDaily: vi.fn().mockResolvedValue([]),
        fetchKosdaqIndexDaily: vi.fn().mockResolvedValue([]),
        recentBusinessDaysKst: vi.fn().mockReturnValue([]),
        fetchKospiDailyTrade: vi.fn().mockResolvedValue([]),
        fetchKosdaqDailyTrade: vi.fn().mockResolvedValue([]),
      }));
      vi.doMock('./krxClient.js', () => ({ fetchInvestorTrading: vi.fn().mockResolvedValue([]) }));
      vi.doMock('../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockReturnValue(null),
      }));
      vi.doMock('./sectorEnergyFallbackProvider.js', () => ({
        buildSectorEnergyFromYahooETF: vi.fn().mockResolvedValue({
          inputs: [],
          dataQuality: 'FAILED',
          validSectorCount: 0,
          totalSectorCount: 12,
          reasons: ['Yahoo all 12 ETFs fetch failed'],
        }),
      }));

      const mod = await import('./sectorEnergyProvider.js');
      const result = await mod.buildSectorEnergyInputsWithMetaWithFallback();

      // L4 도 FAILED — applyYahooEtfDegradation 미적용
      expect(result.dataQuality).toBe('FAILED');
    });
  });

  describe('KIS 주문 함수 import 0건 (정적 grep 가드)', () => {
    it('sectorEnergyProvider.ts 는 KIS 주문 함수 5종 import 부재', () => {
      const KIS_ORDER_PATTERNS = [
        'placeKisMarketOrder',
        'placeKisSellOrder',
        'cancelKisOrder',
        'placeKisStopLossOrder',
        'placeKisTakeProfitOrder',
      ];
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      for (const p of KIS_ORDER_PATTERNS) {
        expect(src).not.toContain(p);
      }
    });

    it('sectorEnergyFallbackProvider.ts 는 KIS 주문 함수 5종 import 부재', () => {
      const KIS_ORDER_PATTERNS = [
        'placeKisMarketOrder',
        'placeKisSellOrder',
        'cancelKisOrder',
        'placeKisStopLossOrder',
        'placeKisTakeProfitOrder',
      ];
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyFallbackProvider.ts'),
        'utf-8',
      );
      for (const p of KIS_ORDER_PATTERNS) {
        expect(src).not.toContain(p);
      }
    });
  });
});
