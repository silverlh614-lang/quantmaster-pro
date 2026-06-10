// @responsibility 섹터 에너지 입력 meta 해석과 4-axis 품질 진단 resolve 섹션 (영속은 본체 merge)
/**
 * sectorEnergySection.ts — ADR-0595 marketDataRefresh 섹션 모듈 분해.
 *
 * 본체 marketDataRefresh.ts 에서 텍스트 그대로 이동 (byte-equivalent, behavior change 0).
 * 영속(MERGE spread)은 본체 buildUpdatedMacroState 에 그대로 잔류한다.
 */

import { logger } from '../../utils/logger.js';
import { evaluateSectorEnergy } from '../../../src/services/quant/sectorEnergyEngine.js';
import { buildSectorEnergyInputsWithMeta } from '../../clients/sectorEnergyProvider.js';
import type { MacroState } from '../../persistence/macroStateRepo.js';
import { emitMarketDataProviderWarn } from './refreshObservability.js';

// ── ADR-0075 PR-4 wiring: 강세 섹터 Gate Score 가산점 SSOT 영속 ─────────────
// ADR-0125 (PR-1) 격상: buildSectorEnergyInputsWithMeta 사용 — dataQuality 4값
// (OK/PARTIAL/STALE/FAILED) + validSectorCount + reasons 동시 영속.
// applySectorScoreBoost 가 read 후 dataQuality 분기로 boost 강도 분기.
export interface SectorEnergyResolved {
  sectorEnergyResult: ReturnType<typeof evaluateSectorEnergy> | undefined;
  sectorEnergyUpdatedAt: string | undefined;
  sectorEnergyInputsResolved: Awaited<ReturnType<typeof buildSectorEnergyInputsWithMeta>>['inputs'] | undefined;
  sectorEnergyDataQuality: 'OK' | 'PARTIAL' | 'STALE' | 'DEGRADED' | 'FAILED' | undefined;
  sectorEnergyValidSectorCount: number | undefined;
  sectorEnergyReasons: string[] | undefined;
  sectorEnergySourceTier:
    | 'KIS_OFFICIAL_INDEX' | 'KIS_OFFICIAL_DAILY' | 'KIS_STOCK_BASKET_DERIVED' | 'KRX_OFFICIAL_INDEX'
    | 'KRX_CODE' | 'STOCK_DAILY' | 'CACHE' | 'YAHOO_GLOBAL_PROXY' | 'YAHOO_ETF' | 'INTERNAL_PROXY'
    | 'MISSING' | 'FAILED' | undefined;
  sectorEnergyFreshness: 'FRESH' | 'DEGRADED' | 'EXPIRED' | undefined;
  sectorEnergyCoverage: number | undefined;
  sectorEnergyConfidence: number | undefined;
  sectorEnergyDiagnostics: NonNullable<MacroState['sectorEnergyDiagnostics']> | undefined;
  sectorEnergyQualityDiagnostic: NonNullable<MacroState['sectorEnergyQualityDiagnostic']> | undefined;
}

export async function resolveSectorEnergySection(existing: MacroState): Promise<SectorEnergyResolved> {
  let sectorEnergyResult: ReturnType<typeof evaluateSectorEnergy> | undefined;
  let sectorEnergyUpdatedAt: string | undefined;
  // ADR-0454: meta.inputs 를 saveMacroState merge scope 까지 노출. ADR-0343 L3 CACHE
  // fallback 의 writer wiring (SilentDegradation 1건 해소). meta.inputs.length>0 분기에만 채움.
  let sectorEnergyInputsResolved: Awaited<ReturnType<typeof buildSectorEnergyInputsWithMeta>>['inputs'] | undefined;
  // ADR-0396: 5단계 union (DEGRADED 신규).
  let sectorEnergyDataQuality: 'OK' | 'PARTIAL' | 'STALE' | 'DEGRADED' | 'FAILED' | undefined;
  let sectorEnergyValidSectorCount: number | undefined;
  let sectorEnergyReasons: string[] | undefined;
  // ADR-0396 4-axis 영속 (사용자 명시 ADR-0371) + ADR-0399 진단 메타 (사용자 명시 ADR-0374).
  let sectorEnergySourceTier: SectorEnergyResolved['sectorEnergySourceTier'];
  let sectorEnergyFreshness: 'FRESH' | 'DEGRADED' | 'EXPIRED' | undefined;
  let sectorEnergyCoverage: number | undefined;
  let sectorEnergyConfidence: number | undefined;
  let sectorEnergyDiagnostics: NonNullable<typeof existing.sectorEnergyDiagnostics> | undefined;
  // ADR-0423: SectorEnergy 데이터 진실성 진단 (옵셔널, sectorEnergyProvider build 결과에서 직접 부착).
  let sectorEnergyQualityDiagnostic: NonNullable<typeof existing.sectorEnergyQualityDiagnostic> | undefined;
  try {
    // ADR-0125: WithMeta 사용 — symmetry 검증 + dataQuality 동시 산출 (캐시 우회).
    // ADR-0399: WithMetaWithFallback 으로 격상 — L1 KRX_CODE → L2 STOCK_DAILY → L3 CACHE → L4 YAHOO_ETF.
    // marketDataRefresh 일일 cron 이라 캐시 부담 없음. 진단 정확성 우선.
    const meta = await buildSectorEnergyInputsWithMeta();
    sectorEnergyDataQuality = meta.dataQuality;
    sectorEnergyValidSectorCount = meta.validSectorCount;
    sectorEnergyReasons = meta.reasons;
    // ADR-0423: quality diagnostic — provider 가 모든 return site 에서 부착. type union 정합.
    if (meta.qualityDiagnostic) {
      sectorEnergyQualityDiagnostic = meta.qualityDiagnostic;
    }

    // ADR-0399: meta.diagnostics + meta.sourceTier 가 부착되어 있으면 4-axis 영속.
    if (meta.diagnostics) {
      sectorEnergyDiagnostics = meta.diagnostics;
      sectorEnergySourceTier = meta.diagnostics.finalSourceTier;
      sectorEnergyConfidence = meta.diagnostics.confidence;
      // ADR-0396: coverage = validSectorCount / totalSectorCount, freshness 는 sourceTier 기반.
      sectorEnergyCoverage = meta.totalSectorCount > 0
        ? Math.max(0, Math.min(1, meta.validSectorCount / meta.totalSectorCount))
        : 0;
      // freshness 분기: KRX_CODE/STOCK_DAILY → FRESH (raw fetch 직후), CACHE → ageMs 기반,
      // YAHOO_ETF → FRESH (raw fetch), FAILED → EXPIRED.
      sectorEnergyFreshness =
        meta.diagnostics.finalSourceTier === 'CACHE' ? 'DEGRADED'
          : meta.diagnostics.finalSourceTier === 'FAILED' ? 'EXPIRED'
          : 'FRESH';
    } else if (meta.sourceTier) {
      // ADR-0399: diagnostics 부재 + sourceTier 만 있을 때 (raw 결과 정상 분기).
      sectorEnergySourceTier = meta.sourceTier;
      sectorEnergyCoverage = meta.totalSectorCount > 0
        ? Math.max(0, Math.min(1, meta.validSectorCount / meta.totalSectorCount))
        : 0;
      sectorEnergyFreshness = meta.sourceTier === 'FAILED' ? 'EXPIRED' : 'FRESH';
      // ADR-0396 SSOT 호출 — 신규 산출식 도입 금지.
      try {
        const { buildSectorEnergyQualityComposite } = await import('../../clients/sectorEnergyDataQuality.js');
        const composite = buildSectorEnergyQualityComposite(
          meta.validSectorCount,
          meta.sourceTier,
          0,
          meta.totalSectorCount,
        );
        sectorEnergyConfidence = composite.confidence;
      } catch {
        sectorEnergyConfidence = 0;
      }
    }

    if (meta.inputs.length > 0) {
      sectorEnergyResult = {
        ...evaluateSectorEnergy(meta.inputs),
        ...(meta.diagnostics?.finalSourceTier ? { sourceTier: meta.diagnostics.finalSourceTier } : {}),
        ...(typeof meta.diagnostics?.confidence === 'number' ? { confidence: meta.diagnostics.confidence } : {}),
        ...(meta.diagnostics?.leadershipConfidence ? { leadershipConfidence: meta.diagnostics.leadershipConfidence } : {}),
        ...(meta.diagnostics?.coverageBreakdown
          ? {
              verifiedIndexCodeCoverage: meta.diagnostics.coverageBreakdown.verifiedIndexCodeCoverage,
              kisOfficialCoverage: meta.diagnostics.coverageBreakdown.kisOfficialCoverage,
              kisBasketCoverage: meta.diagnostics.coverageBreakdown.kisBasketCoverage,
              internalProxyCoverage: meta.diagnostics.coverageBreakdown.internalProxyCoverage,
              stockDailyFallbackCoverage: meta.diagnostics.coverageBreakdown.stockDailyFallbackCoverage,
            }
          : {}),
        liveExecutionAllowed: false as const,
        executionImpact: 'NONE' as const,
      };
      sectorEnergyUpdatedAt = new Date().toISOString();
      // ADR-0454: meta.inputs SSOT 영속 — saveMacroState merge 분기에서 sectorEnergyInputs 영속.
      sectorEnergyInputsResolved = meta.inputs;
      console.log(
        `[MarketRefresh] sectorEnergy 갱신 — ${meta.inputs.length}개 섹터 ` +
        `(dataQuality=${meta.dataQuality}, valid=${meta.validSectorCount}/12, ` +
        `LEADING ${sectorEnergyResult.leadingSectors.length}, ` +
        `LAGGING ${sectorEnergyResult.laggingSectors.length})`,
      );
    } else {
      logger.debug(
        `[MarketRefresh] sectorEnergy 입력 0건 — dataQuality=${meta.dataQuality}, ` +
        `이전 sectorEnergyResult 캐시 보존 (STALE reference).`,
      );
    }
  } catch (e) {
    emitMarketDataProviderWarn('SECTOR_ENERGY_REFRESH_FAILED', {
      error: e instanceof Error ? e.message : String(e),
    });
    sectorEnergyDataQuality = 'FAILED';
    sectorEnergyReasons = ['buildSectorEnergyInputsWithMeta throw'];
  }
  return {
    sectorEnergyResult,
    sectorEnergyUpdatedAt,
    sectorEnergyInputsResolved,
    sectorEnergyDataQuality,
    sectorEnergyValidSectorCount,
    sectorEnergyReasons,
    sectorEnergySourceTier,
    sectorEnergyFreshness,
    sectorEnergyCoverage,
    sectorEnergyConfidence,
    sectorEnergyDiagnostics,
    sectorEnergyQualityDiagnostic,
  };
}
