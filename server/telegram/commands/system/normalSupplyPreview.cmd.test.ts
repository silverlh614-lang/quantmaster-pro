import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('/normal_supply_preview command wiring', () => {
  it('defines the command, aliases, and diagnostic-only invariants', () => {
    const source = readFileSync(resolve(process.cwd(), 'server/telegram/commands/system/normalSupplyPreview.cmd.ts'), 'utf-8');
    expect(source).toContain("name: '/normal_supply_preview'");
    expect(source).toContain("'/normal_supply'");
    expect(source).toContain("'/supply_preview'");
    expect(source).toContain('liveExecutionAllowed=false');
    expect(source).toContain('realOrderAllowed=false');
    expect(source).toContain('executionImpact=NONE');
    expect(source).toContain('collectNormalSupplyPreviewFromWatchlist');
  });

  it('is mounted in the system command barrel and scan_blockers full output', () => {
    const systemIndex = readFileSync(resolve(process.cwd(), 'server/telegram/commands/system/index.ts'), 'utf-8');
    const scanBlockers = readFileSync(resolve(process.cwd(), 'server/telegram/commands/system/scanBlockers.cmd.ts'), 'utf-8');
    const compact = readFileSync(resolve(process.cwd(), 'server/telegram/commands/system/scanBlockersCompactAdr0506.ts'), 'utf-8');
    expect(systemIndex).toContain('normalSupplyPreview.cmd.js');
    expect(scanBlockers).toContain('formatNormalSupplyPreviewSection');
    expect(scanBlockers).toContain('getLastNormalSupplyPreview');
    expect(compact).toContain('0518');
  });

  it('does not import live order or scanner execution paths', () => {
    const command = readFileSync(resolve(process.cwd(), 'server/telegram/commands/system/normalSupplyPreview.cmd.ts'), 'utf-8');
    const runner = readFileSync(resolve(process.cwd(), 'server/trading/signalScanner/normalSupplyPreviewRunner.ts'), 'utf-8');
    const source = `${command}\n${runner}`;
    expect(source).not.toMatch(/runAutoSignalScan|dispatchApprovedBuy|createApprovalQueueState|flushApprovalQueue/);
    expect(source).not.toMatch(/placeKisMarketOrder|placeKisMarketBuyOrder|placeKisSellOrder|orderExecutor|trancheExecutor/);
  });
});
