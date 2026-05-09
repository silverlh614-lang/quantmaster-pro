// @responsibility ADR-0487/0488/0490 /fresh_data_status diagnostic command; provider fetch blocked, live execution blocked.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
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
import { formatProgramTradingDetailAdr0490 } from '../../../trading/signalScanner/programTradingDataLineAdr0490.js';

const freshDataStatus: TelegramCommand = {
  name: '/fresh_data_status',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'ADR-0487 Fresh Data Supply Layer diagnostic status',
  usage: '/fresh_data_status',
  async execute({ reply }) {
    const summary = getLastScanSummary();
    const report = summary?.freshDataSupplyAdr0487 ?? safeBuildFreshDataSupplyReportAdr0487({
      sectorEnergyDiagnosticAdr0474: summary?.sectorEnergyQualityDiagnostic as unknown as Record<string, unknown> | null,
      naverInvestorTrendAdr0481: summary?.naverInvestorTrendAdr0481 as unknown as Record<string, unknown>,
      semanticNetBuyNormalizationAdr0482: summary?.semanticNetBuyNormalizationAdr0482 as unknown as Record<string, unknown>,
      supplySourceFreshnessAdr0483: summary?.supplySourceFreshnessAdr0483 as unknown as FreshDataSupplyReportInputAdr0487['supplySourceFreshnessAdr0483'],
      supplyCoverageRecoveryAdr0484: summary?.supplyCoverageRecoveryAdr0484 as unknown as Record<string, unknown>,
      supplyAdvisoryReadinessAdr0485: summary?.supplyAdvisoryReadinessAdr0485 as unknown as Record<string, unknown>,
      investorFlowProviderRouterAdr0477: summary?.investorFlowProviderRouter ?? null,
      programTradingDataLineAdr0490: summary?.programTradingDataLineAdr0490 ?? null,
    });
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
    const adr0490 = summary?.programTradingDataLineAdr0490;
    await reply(`${formatFreshDataSupplyDetailAdr0487(report)}\n\n${formatSectorEnergySupplyUnknownDetailAdr0488(adr0488)}${adr0490 ? `\n\n${formatProgramTradingDetailAdr0490(adr0490)}` : ''}`);
  },
};

commandRegistry.register(freshDataStatus);

export default freshDataStatus;
