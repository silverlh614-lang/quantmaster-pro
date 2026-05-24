// @responsibility ADR-0487/0488 /fresh_data_status diagnostic command; provider fetch blocked, live execution blocked.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { loadWatchlist } from '../../../persistence/watchlistRepo.js';
import { fetchKisOfficialSupplyPack } from '../../../supply/kisOfficialSupplyPack.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import {
  formatFreshDataSupplyDetailAdr0487,
  safeBuildFreshDataSupplyReportAdr0487,
  type FreshDataSupplyReportInputAdr0487,
} from '../../../trading/signalScanner/freshDataSupplyLayerAdr0487.js';
import {
  formatSectorEnergySupplyUnknownDetailAdr0488,
  safeBuildSectorEnergyAndSupplyUnknownPolicyReportAdr0488,
} from '../../../trading/signalScanner/sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import { buildInvestorFlowSampleAcquisitionReportAdr0489 } from '../../../trading/signalScanner/investorFlowSampleAcquisitionAdr0489.js';
import { formatSupplyCoverageSummaryAdr0496 } from '../../../trading/signalScanner/investorFlowSemanticNetBuyAdr0496.js';
import { buildProgramTradingDataLineReportAdr0490 } from '../../../trading/signalScanner/programTradingDataLineAdr0490.js';
import { summarizeSupplySnapshotStoreAdr0491 } from '../../../trading/signalScanner/supplySnapshotStoreReplayAdr0491.js';
import {
  buildPromotionAuditInputForDataLineAdr0494,
  evaluateFreshDataPromotionAuditsAdr0494,
  formatPromotionAuditCompactAdr0494,
  summarizeFreshDataPromotionAuditsAdr0494,
} from '../../../trading/signalScanner/freshDataPromotionAuditWiringAdr0494.js';
import {
  mapFreshDataSupplyReportToStatusInputsAdr0498,
  mapInvestorFlowRouterToStatusInputAdr0498,
  mapPromotionAuditEvaluationToStatusInputAdr0498,
  mapSectorEnergyOfficialIndexMasterToStatusInputsAdr0498,
  safeBuildFreshDataStatusSectionAdr0498,
} from '../../../diagnostics/freshDataStatusViewModelWiringAdr0498.js';

async function loadKisPackForFreshDataStatus(): Promise<Record<string, unknown> | null> {
  try {
    const first = loadWatchlist().find((item) => typeof item.code === 'string' && item.code.trim().length > 0);
    if (!first?.code) return null;
    return await fetchKisOfficialSupplyPack(first.code) as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

const freshDataStatus: TelegramCommand = {
  name: '/fresh_data_status',
  aliases: ['/fd', '/fds'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'ADR-0487 Fresh Data Supply Layer diagnostic status',
  usage: '/fresh_data_status',
  async execute({ reply }) {
    const summary = getLastScanSummary();
    const kisOfficialSupplyPack = await loadKisPackForFreshDataStatus();
    const investorFlow = buildInvestorFlowSampleAcquisitionReportAdr0489({
      generatedAt: summary?.time ?? new Date().toISOString(),
      providerIssue: summary?.investorFlowProviderRouter?.status === 'PROVIDER_ERROR',
      samples: summary?.naverInvestorTrendAdr0481 ? [{
        symbol: 'NAVER_INVESTOR_TREND',
        provider: 'NAVER',
        sourceDate: summary.naverInvestorTrendAdr0481.semanticNetBuyCandidate?.sourceDate ?? summary.naverInvestorTrendAdr0481.freshness.lastSourceDate,
        status: summary.naverInvestorTrendAdr0481.status === 'PROVIDER_ERROR' ? 'PROVIDER_ERROR' : 'DATA_UNAVAILABLE',
      }] : [],
      diagnostics: ['ADR-0496 /fresh_data_status diagnostic normalization only; no provider fetch.'],
    });
    const freshDataInput: FreshDataSupplyReportInputAdr0487 = {
      sectorEnergyDiagnosticAdr0474: summary?.sectorEnergyQualityDiagnostic as unknown as Record<string, unknown> | null,
      naverInvestorTrendAdr0481: summary?.naverInvestorTrendAdr0481 as unknown as Record<string, unknown>,
      semanticNetBuyNormalizationAdr0482: summary?.semanticNetBuyNormalizationAdr0482 as unknown as Record<string, unknown>,
      supplySourceFreshnessAdr0483: summary?.supplySourceFreshnessAdr0483 as unknown as FreshDataSupplyReportInputAdr0487['supplySourceFreshnessAdr0483'],
      supplyCoverageRecoveryAdr0484: summary?.supplyCoverageRecoveryAdr0484 as unknown as Record<string, unknown>,
      supplyAdvisoryReadinessAdr0485: summary?.supplyAdvisoryReadinessAdr0485 as unknown as Record<string, unknown>,
      investorFlowProviderRouterAdr0477: summary?.investorFlowProviderRouter ?? null,
      supplyCoverageReportAdr0496: investorFlow.adr0496SupplyCoverage,
      kisOfficialSupplyPack,
    };
    const report = kisOfficialSupplyPack
      ? safeBuildFreshDataSupplyReportAdr0487(freshDataInput)
      : summary?.freshDataSupplyAdr0487 ?? safeBuildFreshDataSupplyReportAdr0487(freshDataInput);
    const adr0488 = summary?.sectorEnergySupplyUnknownAdr0488 ?? safeBuildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      sectorEnergyDiagnosticAdr0474: summary?.sectorEnergyQualityDiagnostic as unknown as Record<string, unknown> | null,
      freshDataSupplyAdr0487: report,
      finalGate1CalibrationAdr0471: summary?.finalGate1Calibration ?? null,
      penaltyDeduplicationAdr0469: summary?.penaltyDeduplication ?? null,
      providerStatus: summary?.investorFlowProviderRouter?.status ?? summary?.naverInvestorTrendAdr0481?.status ?? 'UNKNOWN',
      currentSupplySignal: summary?.investorFlowProviderRouter?.signal ?? 'UNKNOWN',
      providerIssue: summary?.investorFlowProviderRouter?.signal !== 'BEARISH',
      marketSignal: false,
    });
    const programTrading = buildProgramTradingDataLineReportAdr0490({
      generatedAt: report.generatedAt,
      diagnostics: ['ADR-0494 /fresh_data_status diagnostic audit input only; no provider fetch.'],
    });
    const snapshotStore = summary?.supplySnapshotStoreAdr0491 ?? summarizeSupplySnapshotStoreAdr0491();
    const promotionAuditInputs = [
      buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'SECTOR_ENERGY', report: adr0488 }),
      buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'INVESTOR_FLOW', report: investorFlow }),
      buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'PROGRAM_TRADING', report: programTrading }),
      buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'SUPPLY_SNAPSHOT', report: snapshotStore }),
    ];
    const promotionAudits = evaluateFreshDataPromotionAuditsAdr0494(promotionAuditInputs, { store: null });
    const promotionSummary = summarizeFreshDataPromotionAuditsAdr0494(promotionAudits);
    const promotionLines = promotionAudits.map(formatPromotionAuditCompactAdr0494).join('\n');
    const routerStatusInput = mapInvestorFlowRouterToStatusInputAdr0498(summary?.investorFlowProviderRouter ?? null);
    const adr0498Section = safeBuildFreshDataStatusSectionAdr0498([
      ...(routerStatusInput ? [routerStatusInput] : []),
      ...mapFreshDataSupplyReportToStatusInputsAdr0498(report),
      ...mapSectorEnergyOfficialIndexMasterToStatusInputsAdr0498(adr0488),
      ...promotionAudits.map(mapPromotionAuditEvaluationToStatusInputAdr0498),
    ], { maxLines: 9 });
    const adr0498Summary = ['ADR-0498 Normalized FreshDataStatus', ...adr0498Section.lines].join('\n');
    await reply(`${adr0498Summary}\n\n${formatFreshDataSupplyDetailAdr0487(report)}\n\n${formatSupplyCoverageSummaryAdr0496(investorFlow.adr0496SupplyCoverage)}\n\n${formatSectorEnergySupplyUnknownDetailAdr0488(adr0488)}\n\n${promotionSummary.promotionAuditSummary}\n${promotionLines}`);
  },
};

commandRegistry.register(freshDataStatus);

export default freshDataStatus;
