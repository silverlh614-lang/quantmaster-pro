// @responsibility Compact SectorEnergy/Official Index verify slice from the latest scan_blockers snapshot.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import {
  formatFreshDataSupplyCompactAdr0487,
  safeBuildFreshDataSupplyReportAdr0487,
} from '../../../trading/signalScanner/freshDataSupplyLayerAdr0487.js';
import {
  formatSectorEnergySupplyUnknownCompactAdr0488,
  safeBuildSectorEnergyAndSupplyUnknownPolicyReportAdr0488,
} from '../../../trading/signalScanner/sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import {
  mapSectorEnergyOfficialIndexMasterToStatusInputsAdr0498,
  safeBuildFreshDataStatusSectionAdr0498,
} from '../../../diagnostics/freshDataStatusViewModelWiringAdr0498.js';

function isProviderIssueStatus(status: string | undefined): boolean {
  const normalized = String(status ?? 'UNKNOWN').trim().toUpperCase();
  return !['VERIFIED', 'OK', 'READY', 'UP', 'SUCCESS'].includes(normalized);
}

async function replyInChunks(reply: (message: string) => Promise<void>, message: string): Promise<void> {
  const maxLen = 3600;
  if (message.length <= maxLen) {
    await reply(message);
    return;
  }

  let chunk = '';
  for (const line of message.split('\n')) {
    if (chunk.length + line.length + 1 > maxLen) {
      await reply(chunk.trimEnd());
      chunk = '';
    }
    chunk += `${line}\n`;
  }
  if (chunk.trim()) await reply(chunk.trimEnd());
}

const scanBlockersEnergy: TelegramCommand = {
  name: '/scan_blokers_energy',
  aliases: ['/scan_blockers_energy', '/blockers_energy', '/sector_energy_blockers', '/energy_blockers'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'SectorEnergy and official index verify slice from latest scan blockers',
  usage: '/scan_blokers_energy',
  async execute({ reply }) {
    const summary = getLastScanSummary();
    const macro = loadMacroState();
    const freshData = summary?.freshDataSupplyAdr0487 ?? safeBuildFreshDataSupplyReportAdr0487({
      sectorEnergyDiagnosticAdr0474: summary?.sectorEnergyQualityDiagnostic as unknown as Record<string, unknown> | null,
      investorFlowProviderRouterAdr0477: summary?.investorFlowProviderRouter ?? null,
    });
    const adr0488 = summary?.sectorEnergySupplyUnknownAdr0488 ?? safeBuildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      sectorEnergyDiagnosticAdr0474: (
        summary?.sectorEnergyQualityDiagnostic
        ?? macro?.sectorEnergyQualityDiagnostic
      ) as unknown as Record<string, unknown> | null,
      freshDataSupplyAdr0487: freshData,
      finalGate1CalibrationAdr0471: summary?.finalGate1Calibration ?? null,
      penaltyDeduplicationAdr0469: summary?.penaltyDeduplication ?? null,
      providerStatus: summary?.investorFlowProviderRouter?.status ?? summary?.naverInvestorTrendAdr0481?.status ?? 'UNKNOWN',
      currentSupplySignal: summary?.investorFlowProviderRouter?.signal ?? 'UNKNOWN',
      providerIssue: isProviderIssueStatus(summary?.investorFlowProviderRouter?.status ?? summary?.naverInvestorTrendAdr0481?.status),
      marketSignal: false,
    });

    const status = safeBuildFreshDataStatusSectionAdr0498(
      mapSectorEnergyOfficialIndexMasterToStatusInputsAdr0498(adr0488),
      { maxLines: 4 },
    );

    const lines = [
      '[scan_blokers_energy] SectorEnergy / Official Index Verify',
      `source=${summary ? 'lastScanSummary' : 'fallback'} executionImpact=NONE`,
      '',
      ...status.lines,
      '',
      formatSectorEnergySupplyUnknownCompactAdr0488(adr0488),
      '',
      formatFreshDataSupplyCompactAdr0487(freshData),
      '',
      'note: compact diagnostic only; no scan execution, no broker order, no live promotion.',
    ];

    await replyInChunks(reply, lines.filter(Boolean).join('\n'));
  },
};

commandRegistry.register(scanBlockersEnergy);

export default scanBlockersEnergy;
