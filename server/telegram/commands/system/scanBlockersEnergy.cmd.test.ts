// @responsibility /scan_blokers_energy compact SectorEnergy slice command tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSummary = {
  sectorEnergySupplyUnknownAdr0488: { marker: 'adr0488' },
  freshDataSupplyAdr0487: { marker: 'fresh' },
};

vi.mock('../../commandRegistry.js', async () => {
  const actual = await vi.importActual<typeof import('../../commandRegistry.js')>('../../commandRegistry.js');
  return actual;
});

vi.mock('../../../persistence/macroStateRepo.js', () => ({
  loadMacroState: () => null,
}));

vi.mock('../../../trading/signalScanner/scanDiagnostics.js', () => ({
  getLastScanSummary: () => mockSummary,
}));

vi.mock('../../../trading/signalScanner/freshDataSupplyLayerAdr0487.js', () => ({
  formatFreshDataSupplyCompactAdr0487: () => 'ADR-0487 FreshDataSupply compact impact=NONE',
  safeBuildFreshDataSupplyReportAdr0487: () => mockSummary.freshDataSupplyAdr0487,
}));

vi.mock('../../../trading/signalScanner/sectorEnergyMasterSupplyUnknownPolicyAdr0488.js', () => ({
  formatSectorEnergySupplyUnknownCompactAdr0488: () =>
    'ADR-0488 SectorEnergyMaster officialIndexCoverage=33.3 verifiedIndexCodeCoverage=0 executionImpact=NONE\nKisIndexQuoteClientStatus enabled=true verifyMode=OBSERVE livePromotionFromVerify=false',
  safeBuildSectorEnergyAndSupplyUnknownPolicyReportAdr0488: () => mockSummary.sectorEnergySupplyUnknownAdr0488,
}));

vi.mock('../../../diagnostics/freshDataStatusViewModelWiringAdr0498.js', () => ({
  mapSectorEnergyOfficialIndexMasterToStatusInputsAdr0498: () => [{ dataLineId: 'KIS_SECTOR_INDEX_VERIFY' }],
  safeBuildFreshDataStatusSectionAdr0498: () => ({
    lines: ['[ADR-0498] FreshDataStatus SECTOR_ENERGY/KIS_SECTOR_INDEX_VERIFY provider=KIS reason=OBSERVE impact=NONE'],
    viewModels: [],
    truncated: false,
    executionImpact: 'NONE',
  }),
}));

describe('/scan_blokers_energy command', () => {
  beforeEach(async () => {
    vi.resetModules();
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
  });

  it('registers typo and corrected aliases and replies with only the sector energy slice', async () => {
    const registry = await import('../../commandRegistry.js');
    await import('./scanBlockersEnergy.cmd.js');

    const command = registry.commandRegistry.resolve('/scan_blokers_energy');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/scan_blockers_energy')).toBe(command);

    const replies: string[] = [];
    await command!.execute({
      args: [],
      reply: async (message) => {
        replies.push(message);
      },
    });

    expect(replies.join('\n')).toContain('[scan_blokers_energy] SectorEnergy / Official Index Verify');
    expect(replies.join('\n')).toContain('KIS_SECTOR_INDEX_VERIFY');
    expect(replies.join('\n')).toContain('KisIndexQuoteClientStatus enabled=true verifyMode=OBSERVE');
    expect(replies.join('\n')).toContain('no scan execution');
  });
});
