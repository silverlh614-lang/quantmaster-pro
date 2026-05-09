// @responsibility ADR-0487 /fresh_data_status diagnostic command; no provider fetch or live execution.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import {
  formatFreshDataSupplyDetailAdr0487,
  safeBuildFreshDataSupplyReportAdr0487,
  type FreshDataSupplyReportInputAdr0487,
} from '../../../trading/signalScanner/freshDataSupplyLayerAdr0487.js';

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
    });
    await reply(formatFreshDataSupplyDetailAdr0487(report));
  },
};

commandRegistry.register(freshDataStatus);

export default freshDataStatus;
