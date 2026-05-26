// @responsibility ADR-0398 /sector_energy_diag 텔레그램 명령 회귀
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

const ORIGINAL_ENV = { ...process.env };

describe('ADR-0398 (= 사용자 명시 ADR-0373): /sector_energy_diag 명령', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.doMock('../../commandRegistry.js', () => ({
      commandRegistry: { register: vi.fn() },
    }));
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  describe('정적 가드 — 명령 메타데이터 + barrel 등록', () => {
    it('명령 메타데이터 정합 — name + alias + category + visibility', async () => {
      const mod = await import('./sectorEnergyDiag.cmd.js');
      expect(mod.default.name).toBe('/sector_energy_diag');
      expect(mod.default.aliases).toContain('/se');
      expect(mod.default.aliases).toContain('/sed');
      expect(mod.default.aliases).toContain('/sector_diag');
      expect(mod.default.category).toBe('SYS');
      expect(mod.default.visibility).toBe('ADMIN');
      expect(mod.default.riskLevel).toBe(0); // read-only
    }, 20_000);

    it('barrel index.ts 에 sectorEnergyDiag 등록', () => {
      const src = fs.readFileSync(path.resolve(__dirname, 'index.ts'), 'utf-8');
      expect(src).toMatch(/import\s+'\.\/sectorEnergyDiag\.cmd\.js'/);
      expect(src).toMatch(/ADR-0398/);
    });

    it('formatSectorEnergyDiagMessage SSOT export', async () => {
      const mod = await import('./sectorEnergyDiag.cmd.js');
      expect(typeof mod.formatSectorEnergyDiagMessage).toBe('function');
    });
  });

  describe('formatSectorEnergyDiagMessage 출력 분기', () => {
    it('macroState 부재 → 미수집 안내', async () => {
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockReturnValue(null),
      }));
      const mod = await import('./sectorEnergyDiag.cmd.js');
      const msg = mod.formatSectorEnergyDiagMessage();
      expect(msg).toMatch(/macroState 부재/);
      expect(msg).toMatch(/Sector Energy 4-axis 진단/);
    });

    it('정상 OK 상태 → 5 필드 모두 표시 + high-conviction label diagnostics', async () => {
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockReturnValue({
          sectorEnergyDataQuality: 'OK',
          sectorEnergySourceTier: 'KRX_CODE',
          sectorEnergyFreshness: 'FRESH',
          sectorEnergyCoverage: 1.0,
          sectorEnergyConfidence: 1.0,
          sectorEnergyValidSectorCount: 12,
        }),
      }));
      const mod = await import('./sectorEnergyDiag.cmd.js');
      const msg = mod.formatSectorEnergyDiagMessage();
      expect(msg).toMatch(/legacyDataQualityDiagnosticOnly.*OK/);
      expect(msg).toMatch(/legacySourceTierDiagnosticOnly.*KRX_CODE/);
      expect(msg).toMatch(/legacyFreshnessDiagnosticOnly.*FRESH/);
      expect(msg).toMatch(/legacyCoverageDiagnosticOnly.*100\.0%/);
      expect(msg).toMatch(/legacyConfidenceDiagnosticOnly.*100\.0%/);
      expect(msg).toMatch(/High-conviction label diagnostics/);
      expect(msg).toMatch(/score\/diagnostic only/);
    });

    it('Yahoo ETF 폴백 (DEGRADED) → high-conviction 진단 사유 표시', async () => {
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockReturnValue({
          sectorEnergyDataQuality: 'DEGRADED',
          sectorEnergySourceTier: 'YAHOO_ETF',
          sectorEnergyFreshness: 'FRESH',
          sectorEnergyCoverage: 0.83,
          sectorEnergyConfidence: 0.41,
          sectorEnergyValidSectorCount: 10,
        }),
      }));
      const mod = await import('./sectorEnergyDiag.cmd.js');
      const msg = mod.formatSectorEnergyDiagMessage();
      // dataQuality=DEGRADED 마커
      expect(msg).toMatch(/legacyDataQualityDiagnosticOnly.*DEGRADED/);
      expect(msg).toMatch(/🔶/); // DEGRADED 이모지
      expect(msg).toMatch(/High-conviction label diagnostics/);
      // 4 조건 OR 다중 사유 동시 충족
      expect(msg).toMatch(/legacyConfidenceDiagnosticOnly/);
      expect(msg).toMatch(/DEGRADED/);
      expect(msg).toMatch(/YAHOO_ETF/);
      // Step 4 — 진단 근거만 표시하고 매수 차단/강등은 하지 않음
      expect(msg).toMatch(/score\/diagnostic only/);
    });

    it('FAILED 상태 → high-conviction 진단 사유 표시', async () => {
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockReturnValue({
          sectorEnergyDataQuality: 'FAILED',
          sectorEnergySourceTier: 'FAILED',
          sectorEnergyFreshness: 'EXPIRED',
          sectorEnergyCoverage: 0,
          sectorEnergyConfidence: 0,
          sectorEnergyValidSectorCount: 0,
        }),
      }));
      const mod = await import('./sectorEnergyDiag.cmd.js');
      const msg = mod.formatSectorEnergyDiagMessage();
      expect(msg).toMatch(/legacyDataQualityDiagnosticOnly.*FAILED/);
      expect(msg).toMatch(/❌/);
      expect(msg).toMatch(/High-conviction label diagnostics/);
    });

    it('KIS basket derived + verifiedIndexCodeCoverage=0 + kisBasketCoverage=100% → PARTIAL 65% confidence and one ADR-0474 block', async () => {
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockReturnValue({
          sectorEnergyDataQuality: 'PARTIAL',
          sectorEnergySourceTier: 'KIS_STOCK_BASKET_DERIVED',
          sectorEnergyFreshness: 'FRESH',
          sectorEnergyCoverage: 1,
          sectorEnergyConfidence: 0,
          sectorEnergyValidSectorCount: 12,
          sectorEnergyDiagnostics: {
            finalSourceTier: 'KIS_STOCK_BASKET_DERIVED',
            confidence: 0,
            coverageBreakdown: {
              verifiedIndexCodeCoverage: 0,
              verifiedIndexCodeCount: 0,
              kisOfficialCoverage: 0,
              kisOfficialCount: 0,
              kisBasketCoverage: 1,
              kisBasketCount: 12,
              internalProxyCoverage: 0,
              internalProxyCount: 0,
              stockDailyFallbackCoverage: 0,
              stockDailyFallbackCount: 0,
              totalSectors: 12,
            },
            leadershipConfidence: 'READY_FOR_SHADOW',
            selectedSectors: ['자동차', '반도체', '철강'],
            liveExecutionAllowed: false,
            executionImpact: 'NONE',
          },
          sectorEnergyQualityDiagnostic: {
            dataQuality: 'PARTIAL',
            reasons: ['KIS_STOCK_BASKET_DERIVED'],
            validSectorCount: 12,
            expectedSectorCount: 12,
            indexCodeCoverage: 0,
            missingIndexCodeCount: 0,
            totalSectorRows: 12,
            fallbackUsed: 'NONE',
            symmetryValidationPassed: true,
            shouldBlockLeadershipConfidence: true,
            operatorMessage: 'sourceTier=KIS_STOCK_BASKET_DERIVED',
          },
        }),
      }));
      const mod = await import('./sectorEnergyDiag.cmd.js');
      const msg = mod.formatSectorEnergyDiagMessage();

      expect(msg).toMatch(/legacyConfidenceDiagnosticOnly.*65\.0%.*PARTIAL.*KIS basket derived/);
      expect(msg).not.toMatch(/legacyConfidenceDiagnosticOnly.*0\.0%/);
      expect(msg).toContain('legacySelectedSourceTierDiagnosticOnly: <code>KIS_STOCK_BASKET_DERIVED</code>');
      expect(msg).toContain('officialCoverage: <b>0/12</b>');
      expect(msg).toContain('basketCoverage: <b>12/12</b>');
      expect(msg).toContain('productionOfficialCoverage: <b>0.0%</b> (0/12)');
      expect(msg).toContain('productionBasketCoverage: <b>100.0%</b> (12/12)');
      expect(msg).toContain(
        'KIS basket is derived from official KIS daily prices',
      );
      expect(msg).toMatch(/sourceTier=KIS_STOCK_BASKET_DERIVED/);
      expect(msg).toMatch(/executionImpact: NONE/);
      expect(
        (msg.match(/SectorEnergy Coverage Recovery \(ADR-0474\)/g) ?? [])
          .length,
      ).toBe(1);
    });

    it('ENV STRONG_BUY_GATE_DISABLED → high-conviction 진단 비활성 안내', async () => {
      process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED = 'true';
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockReturnValue({
          sectorEnergyDataQuality: 'FAILED',
          sectorEnergySourceTier: 'YAHOO_ETF',
          sectorEnergyFreshness: 'EXPIRED',
          sectorEnergyCoverage: 0,
          sectorEnergyConfidence: 0,
        }),
      }));
      const mod = await import('./sectorEnergyDiag.cmd.js');
      const msg = mod.formatSectorEnergyDiagMessage();
      expect(msg).toMatch(/High-conviction label diagnostics disabled/);
      expect(msg).toMatch(/SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED/);
    });

    it('ADR-0396 격상 전 영속 데이터 (4-axis 미수집) → 미수집 라벨', async () => {
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockReturnValue({
          // ADR-0125 4-state 만 있고 ADR-0396 4-axis 부재
          sectorEnergyDataQuality: 'STALE',
          sectorEnergyValidSectorCount: 8,
          // sourceTier / freshness / coverage / confidence 부재
        }),
      }));
      const mod = await import('./sectorEnergyDiag.cmd.js');
      const msg = mod.formatSectorEnergyDiagMessage();
      expect(msg).toMatch(/legacyDataQualityDiagnosticOnly.*STALE/);
      expect(msg).toMatch(/legacySourceTierDiagnosticOnly.*미수집/);
      expect(msg).toMatch(/legacyFreshnessDiagnosticOnly.*미수집/);
      expect(msg).toMatch(/High-conviction label diagnostics/);
      expect(msg).toMatch(/unavailable/);
    });
  });

  describe('execute() 핸들러 — read-only + 안전 fallback', () => {
    it('정상 메시지 reply 호출', async () => {
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockReturnValue({
          sectorEnergyDataQuality: 'OK',
          sectorEnergySourceTier: 'KRX_CODE',
          sectorEnergyFreshness: 'FRESH',
          sectorEnergyCoverage: 1.0,
          sectorEnergyConfidence: 1.0,
        }),
      }));
      const mod = await import('./sectorEnergyDiag.cmd.js');
      const reply = vi.fn();
      await mod.default.execute({ args: [], reply });
      expect(reply).toHaveBeenCalledTimes(1);
      const sent = reply.mock.calls[0][0];
      expect(sent).toMatch(/Sector Energy 4-axis 진단/);
    });

    it('throw 시 graceful — ❌ 안내 메시지 reply', async () => {
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({
        loadMacroState: vi.fn().mockImplementation(() => {
          throw new Error('영속 read 실패');
        }),
      }));
      const mod = await import('./sectorEnergyDiag.cmd.js');
      const reply = vi.fn();
      // console.error mock 으로 stderr 노이즈 차단
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await mod.default.execute({ args: [], reply });
      expect(reply).toHaveBeenCalledTimes(1);
      const sent = reply.mock.calls[0][0];
      expect(sent).toMatch(/실패/);
      errorSpy.mockRestore();
    });
  });


  describe('SectorEnergy snapshot Telegram consistency patch', () => {
    function macroState() {
      return {
        sectorEnergyDataQuality: 'PARTIAL',
        sectorEnergySourceTier: 'KIS_STOCK_BASKET_DERIVED',
        sectorEnergyFreshness: 'FRESH',
        sectorEnergyCoverage: 1,
        sectorEnergyConfidence: 0,
        sectorEnergyValidSectorCount: 12,
        sectorEnergyDiagnostics: {
          coverageBreakdown: {
            totalSectors: 12,
            verifiedIndexCodeCount: 0,
            kisOfficialCount: 0,
            kisBasketCount: 12,
          },
          executionImpact: 'NONE',
        },
        sectorEnergyQualityDiagnostic: {
          dataQuality: 'PARTIAL',
          reasons: ['KIS_STOCK_BASKET_DERIVED'],
          validSectorCount: 12,
          expectedSectorCount: 12,
          indexCodeCoverage: 0,
          missingIndexCodeCount: 0,
          totalSectorRows: 12,
          fallbackUsed: 'NONE',
          symmetryValidationPassed: true,
          shouldBlockLeadershipConfidence: true,
          operatorMessage: 'sourceTier=KIS_STOCK_BASKET_DERIVED',
          coverageBreakdown: {
            expectedSectorCount: 12,
            validSectorCount: 12,
            fullQualitySectorCount: 11,
            partialQualitySectorCount: 1,
            staleSectorCount: 0,
            missingSectorCount: 0,
            partialSectorCount: 1,
            executionImpact: 'NONE',
            sectorRows: [{
              sectorName: '2차전지',
              sectorCode: 'BATTERY',
              representativeSymbols: ['373220', '051910'],
              representativeSymbolCount: 2,
              priceRowsFound: 1,
              priceRowsMissing: 1,
              latestPriceDate: '20260514',
              ageTradingDays: 0,
              freshness: 'PARTIAL',
              reason: 'PRICE_ROWS_MISSING',
            }],
          },
        },
      };
    }

    it('buildSectorEnergyTelegramMessage chunk split은 SEMICONDUCTOR sector key를 중간에서 자르지 않는다', async () => {
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({ loadMacroState: vi.fn().mockReturnValue(macroState()) }));
      const mod = await import('./sectorEnergyDiag.cmd.js');
      const snapshot = mod.buildSectorEnergyTelegramSnapshot({
        baseMessage: Array.from({ length: 8 }, (_, i) => `line-${i}-${'x'.repeat(20)}`).join('\n'),
        dryRunSection: 'successTop:\n  1. <code>SEMICONDUCTOR</code> / 반도체 / iscd=<code>2004</code> / layer=<code>KIS_SECTOR_INDEX_DAILY_DRYRUN</code> / rows=<b>21</b>',
        dryRun: { succeeded: 10, promotionStage: 'OBSERVE', rows: [{ success: false, iscd: '2005' }, { success: false, iscd: '2006' }] },
        now: new Date('2026-05-14T00:00:00.000Z'),
      });
      const chunks = mod.splitSectorEnergyTelegramMessageByLine(mod.buildSectorEnergyTelegramMessage(snapshot), 220);
      expect(chunks.some((chunk: string) => chunk.includes('<code>SEMICONDUCTOR</code>'))).toBe(true);
      expect(chunks.every((chunk: string) => !chunk.includes('SEMICO') || chunk.includes('SEMICONDUCTOR'))).toBe(true);
      expect(chunks.every((chunk: string) => !chunk.includes('NDUCTOR') || chunk.includes('SEMICONDUCTOR'))).toBe(true);
    });

    it('동일 SectorEnergy full snapshot은 두 번째 Telegram을 보내지 않고 suppressedCount만 증가시킨다', async () => {
      process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({ loadMacroState: vi.fn().mockReturnValue(macroState()) }));
      vi.doMock('../../../clients/kisSectorEnergyProvider.js', () => ({
        fetchKisSectorIndexRowsDryRun: vi.fn().mockResolvedValue({
          attempted: 12,
          succeeded: 10,
          failed: 2,
          rows: [{ success: false, iscd: '2005' }, { success: false, iscd: '2006' }],
          sourceTier: 'KIS_SECTOR_INDEX_DAILY_DRYRUN',
          candidateCoverage: 10 / 12,
          officialBenchmark: false,
          promotionStage: 'OBSERVE',
          sectorBoostAllowed: false,
          strongBuyAllowed: false,
          executionImpact: 'NONE',
        }),
        formatKisSectorIndexDryRunSection: vi.fn().mockReturnValue('successTop:\n  1. <code>BATTERY</code> / 2차전지 / layer=<code>KIS_SECTOR_INDEX_DAILY_DRYRUN</code> / rows=<b>21</b>'),
      }));
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mod = await import('./sectorEnergyDiag.cmd.js');
      mod.resetSeTelegramSnapshotDedupForTests();
      const reply = vi.fn();

      await mod.default.execute({ args: [], reply });
      const firstReplyCount = reply.mock.calls.length;
      await mod.default.execute({ args: [], reply });

      expect(firstReplyCount).toBeGreaterThan(0);
      expect(reply).toHaveBeenCalledTimes(firstReplyCount);
      expect(String(reply.mock.calls[0][0])).not.toContain('Dry Run unchanged');
      const logs = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logs).toContain('[SECTOR_ENERGY_DEDUP_CHECK]');
      expect(logs).toContain('isDuplicate=true');
      expect(logs).toContain('decision=SUPPRESS');
      expect(logs).toContain('changedFields=[]');
      expect(logs).toContain('[SECTOR_ENERGY_TELEGRAM_SUPPRESSED] reason=UNCHANGED_SNAPSHOT');
      expect(logs).toContain('suppressedCount=1');
      expect(logs).toContain('executionImpact=NONE');
      logSpy.mockRestore();
    });

    it('stable snapshot key는 timestamp/generatedAt 변동만으로 바뀌지 않아 SUPPRESS 한다', async () => {
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({ loadMacroState: vi.fn().mockReturnValue(macroState()) }));
      const mod = await import('./sectorEnergyDiag.cmd.js');
      mod.resetSeTelegramSnapshotDedupForTests();
      const base = mod.buildSectorEnergyTelegramSnapshot({
        baseMessage: 'base',
        dryRunSection: 'dry',
        dryRun: { attempted: 12, succeeded: 10, sourceTier: 'KIS_SECTOR_INDEX_DAILY_DRYRUN', promotionStage: 'OBSERVE', rows: [{ success: false, iscd: '2005' }, { success: false, iscd: '2006' }] },
        now: new Date('2026-05-14T00:00:00.000Z'),
      });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      expect(mod.shouldSuppressSectorEnergySnapshotTelegram({ ...base, timestamp: '2026-05-14T00:00:01Z' } as any, 1000)).toBe(false);
      expect(mod.shouldSuppressSectorEnergySnapshotTelegram({ ...base, timestamp: '2026-05-14T00:09:01Z', generatedAt: '2026-05-14T00:09:01Z' } as any, 2000)).toBe(true);
      expect(mod.buildSectorEnergyStableSnapshotKey({ ...base, generatedAt: 'volatile' } as any)).toBe(mod.buildSectorEnergyStableSnapshotKey(base));

      const logs = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logs).toContain('decision=SUPPRESS');
      expect(logs).toContain('changedFields=[]');
      logSpy.mockRestore();
    });

    it('stable 판단 필드 변화는 같은 날이라도 Telegram SEND를 허용한다', async () => {
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({ loadMacroState: vi.fn().mockReturnValue(macroState()) }));
      const mod = await import('./sectorEnergyDiag.cmd.js');
      mod.resetSeTelegramSnapshotDedupForTests();
      const base = mod.buildSectorEnergyTelegramSnapshot({
        baseMessage: 'base',
        dryRunSection: 'dry',
        dryRun: { attempted: 12, succeeded: 10, sourceTier: 'KIS_SECTOR_INDEX_DAILY_DRYRUN', promotionStage: 'OBSERVE', rows: [{ success: false, iscd: '2005' }, { success: false, iscd: '2006' }] },
        now: new Date('2026-05-14T00:00:00.000Z'),
      });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      expect(mod.shouldSuppressSectorEnergySnapshotTelegram(base, 1000)).toBe(false);
      expect(mod.shouldSuppressSectorEnergySnapshotTelegram({ ...base, dryRunSucceeded: 11 } as any, 2000)).toBe(false);
      expect(mod.shouldSuppressSectorEnergySnapshotTelegram({ ...base, dryRunSucceeded: 11, dryRunFailedCodes: '2006' } as any, 3000)).toBe(false);
      expect(mod.shouldSuppressSectorEnergySnapshotTelegram({ ...base, dryRunSucceeded: 11, dryRunFailedCodes: '2006', topProblemsStableHash: 'other-sector', topProblemsHash: 'other-sector' } as any, 4000)).toBe(false);

      const logs = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logs).toContain('changedFields=["dryRunSucceeded"]');
      expect(logs).toContain('changedFields=["dryRunFailedCodes"]');
      expect(logs).toContain('changedFields=["topProblemsStableHash"]');
      logSpy.mockRestore();
    });

    it('production/dry-run 실행 블록은 SectorEnergy Telegram을 sendSectorEnergySnapshot으로만 발송한다', () => {
      const src = fs.readFileSync(path.resolve(__dirname, 'sectorEnergyDiag.cmd.ts'), 'utf-8');
      const executeBody = src.slice(src.indexOf('async execute({ reply })'), src.indexOf('} catch (err)', src.indexOf('async execute({ reply })')));
      expect(executeBody).toContain('sendSectorEnergySnapshot(disabledSnapshot, reply)');
      expect(executeBody).toContain('sendSectorEnergySnapshot(snapshot, reply)');
      expect(executeBody).not.toContain('sendSectorEnergyTelegramMessage(reply');
      expect(executeBody).not.toContain('sendTelegramAlert(');
    });

    it('snapshot key는 safety invariant와 일반 BUY 미차단 플래그를 유지한다', async () => {
      vi.doMock('../../../persistence/macroStateRepo.js', () => ({ loadMacroState: vi.fn().mockReturnValue(macroState()) }));
      const mod = await import('./sectorEnergyDiag.cmd.js');
      const snapshot = mod.buildSectorEnergyTelegramSnapshot({
        baseMessage: 'base',
        dryRunSection: 'dry',
        dryRun: { succeeded: 10, promotionStage: 'OBSERVE', rows: [{ success: false, iscd: '2005' }, { success: false, iscd: '2006' }] },
        now: new Date('2026-05-14T00:00:00.000Z'),
      });

      expect(snapshot.selectedProductionSourceTier).toBe('NONE');
      expect(snapshot.productionOfficialCoverage).toBe('0/11');
      expect(snapshot.productionBasketCoverage).toBe('12/12');
      expect(snapshot.strongBuyAllowed).toBe(false);
      expect(snapshot.sectorBoostAllowed).toBe(false);
      expect(snapshot.executionImpact).toBe('NONE');
      expect(snapshot.generalBuyBlocked).toBe(false);
      expect(mod.buildSectorEnergySnapshotDedupKey(snapshot)).toContain('SECTOR_ENERGY_SNAPSHOT:2026-05-14:NONE:MISSING:0/11:12/12:false:false:NONE:KIS_SECTOR_INDEX_DAILY_DRYRUN:2:10:2005,2006:OBSERVE');
    });
  });

  describe('KIS 주문 함수 import 0건 + manual override 트리거 부재', () => {
    it('sectorEnergyDiag.cmd.ts 는 KIS 주문 함수 5종 import 부재', () => {
      const KIS_ORDER_PATTERNS = [
        'placeKisMarketOrder',
        'placeKisSellOrder',
        'cancelKisOrder',
        'placeKisStopLossOrder',
        'placeKisTakeProfitOrder',
      ];
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyDiag.cmd.ts'),
        'utf-8',
      );
      for (const p of KIS_ORDER_PATTERNS) {
        expect(src).not.toContain(p);
      }
    });

    it('manual override 트리거 부재 (read-only 정합) — saveMacroState/setSectorEnergy 호출 0건', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyDiag.cmd.ts'),
        'utf-8',
      );
      expect(src).not.toContain('saveMacroState');
      expect(src).not.toContain('setSectorEnergy');
    });
  });
});
