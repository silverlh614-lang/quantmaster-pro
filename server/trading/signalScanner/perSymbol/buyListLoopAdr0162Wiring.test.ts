// @responsibility Verify the active entry sizing boundary.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = (name: string) => readFileSync(join(process.cwd(), name), 'utf8');
const main = read('server/trading/signalScanner/perSymbol/buyListLoop.ts');
const boundary = read('server/trading/sizing/entrySizingPolicy.ts');

describe('ADR-0665 active entry sizing boundary', () => {
  it('routes quantity through the public sizing policy without the disabled Kelly branch', () => {
    expect(main).toMatch(/import\s*\{[^}]*calculateOrderQuantity[^}]*\}\s*from\s*['"][^'"]*entrySizingPolicy\.js/);
    expect(main).not.toMatch(/applyPositionSizingEngine|accountKellyMultiplier|positionSizingEngineWiring/);
  });
  it('preserves exposure and supply health sizing after base budget calculation', () => {
    expect(main).toContain('const baseQuantity = legacyQuantity;');
    expect(main).toContain('exposureBudgetCap(ctx, stock, shadowEntryPrice, baseQuantity)');
    expect(main).toContain('const execQty = supplyAdjustedFinalQuantity');
  });
  it('preserves persisted sizing attribution and the independently consumed Kelly snapshot', () => {
    expect(main).toContain('const sizingSource = ENTRY_SIZING_SOURCE;');
    expect(main).toContain('const sizingEngineSnapshot = undefined;');
    expect(main).toMatch(/entryKellySnapshot\s*,/);
    expect(main).toMatch(/sizingSource\s*,/);
    expect(main).toMatch(/sizingEngineSnapshot\s*,/);
    expect(boundary).toContain("ENTRY_SIZING_SOURCE = 'LEGACY_SSOT'");
  });
  it('keeps the sizing boundary free of engine, portfolio, and floor dependencies', () => {
    expect(boundary).not.toMatch(/from\s*['"][^'"]*(entryEngine|positionSizingEngineWiring|shadowBullExposureProfile|currentEquityExposure)/);
  });
});
