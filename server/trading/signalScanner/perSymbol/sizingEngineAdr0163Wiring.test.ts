/**
 * ADR-0163 wiring guards, updated for the extracted per-symbol step files.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (path: string) => readFileSync(join(process.cwd(), path), 'utf-8');

const BUYLIST_SRC = src('server/trading/signalScanner/perSymbol/buyListLoop.ts');
const INTRADAY_SRC = src('server/trading/signalScanner/perSymbol/intradayLoop.ts');
const FOLLOW_BUDGET_SRC = src('server/trading/signalScanner/perSymbol/steps/preBreakoutFollowthroughBudget.ts');
const FOLLOW_SRC = src('server/trading/signalScanner/perSymbol/steps/preBreakoutFollowthrough.ts');
const PB_SRC = src('server/trading/signalScanner/perSymbol/steps/preBreakoutEntry.ts');

describe('ADR-0163 wiring after per-symbol step extraction', () => {
  it('keeps one sizing-engine call per executable path', () => {
    expect((BUYLIST_SRC.match(/applyPositionSizingEngine\s*\(/g) || []).length).toBe(1);
    expect((FOLLOW_BUDGET_SRC.match(/applyPositionSizingEngine\s*\(/g) || []).length).toBe(1);
    expect((PB_SRC.match(/applyPositionSizingEngine\s*\(/g) || []).length).toBe(1);
    expect((INTRADAY_SRC.match(/applyPositionSizingEngine\s*\(/g) || []).length).toBe(1);
  });

  it('pre-breakout followthrough uses BUY mapping and preserves the 70% tranche', () => {
    expect(FOLLOW_BUDGET_SRC).toMatch(/sizingApplyFollow\s*=\s*applyPositionSizingEngine/);
    const followSection = FOLLOW_BUDGET_SRC.split('sizingApplyFollow')[1];
    expect(followSection).toMatch(/signalGrade:\s*['"]BUY['"]/);
    expect(FOLLOW_BUDGET_SRC).toMatch(/const\s*\{\s*quantity:\s*legacyFullQty\s*\}/);
    expect(FOLLOW_BUDGET_SRC).toMatch(/const\s+fullQty\s*=\s*sizingApplyFollow\.applied\s*\?\s*sizingApplyFollow\.quantity\s*:\s*legacyFullQty/);
    expect(FOLLOW_BUDGET_SRC).toMatch(/const\s+followQtyRaw\s*=\s*Math\.max\(1,\s*Math\.ceil\(fullQty\s*\*\s*0\.7\)\)/);
    expect(FOLLOW_BUDGET_SRC).toMatch(/const\s+followQty\s*=\s*exposureCapFollow\.applied\s*\?\s*exposureCapFollow\.finalQuantity\s*:\s*followQtyRaw/);
  });

  it('pre-breakout 30% entry uses BUY mapping and preserves the 30% tranche', () => {
    expect(PB_SRC).toMatch(/sizingApplyPb\s*=\s*applyPositionSizingEngine/);
    const pbSection = PB_SRC.split('sizingApplyPb')[1];
    expect(pbSection).toMatch(/signalGrade:\s*['"]BUY['"]/);
    expect(PB_SRC).toMatch(/const\s*\{\s*quantity:\s*legacyFullPbQty\s*\}/);
    expect(PB_SRC).toMatch(/const\s+fullPbQty\s*=\s*sizingApplyPb\.applied\s*\?\s*sizingApplyPb\.quantity\s*:\s*legacyFullPbQty/);
    expect(PB_SRC).toMatch(/const\s+pbQtyRaw\s*=\s*Math\.max\(1,\s*Math\.floor\(fullPbQty\s*\*\s*0\.3\)\)/);
    expect(PB_SRC).toMatch(/const\s+pbQty\s*=\s*exposureCapPb\.applied\s*\?\s*exposureCapPb\.finalQuantity\s*:\s*pbQtyRaw/);
  });

  it('passes sizing source snapshots into followthrough, pre-breakout, and intraday trades', () => {
    const followBuildSection = FOLLOW_SRC.match(/const\s+followTrade\s*=\s*buildBuyTrade\(\{[\s\S]*?\}\);/);
    expect(followBuildSection).not.toBeNull();
    expect(followBuildSection![0]).toMatch(/sizingSource:\s*sizingSourceFollow/);
    expect(followBuildSection![0]).toMatch(/sizingEngineSnapshot:\s*sizingEngineSnapshotFollow/);

    const pbBuildSection = PB_SRC.match(/const\s+pbTrade:\s*ServerShadowTrade\s*=\s*buildBuyTrade\(\{[\s\S]*?\}\);/);
    expect(pbBuildSection).not.toBeNull();
    expect(pbBuildSection![0]).toMatch(/sizingSource:\s*sizingSourcePb/);
    expect(pbBuildSection![0]).toMatch(/sizingEngineSnapshot:\s*sizingEngineSnapshotPb/);

    const intraBuildSection = INTRADAY_SRC.match(/const\s+trade\s*=\s*buildBuyTrade\(\{[\s\S]*?\}\);/);
    expect(intraBuildSection).not.toBeNull();
    expect(intraBuildSection![0]).toMatch(/sizingSource:\s*sizingSourceIntra/);
    expect(intraBuildSection![0]).toMatch(/sizingEngineSnapshot:\s*sizingEngineSnapshotIntra/);
  });

  it('keeps diagnostic log labels for extracted paths', () => {
    expect(FOLLOW_BUDGET_SRC).toMatch(/\[Sizing-NewEngine\][^`]*PRE_BREAKOUT_FOLLOWTHROUGH/);
    expect(PB_SRC).toMatch(/\[Sizing-NewEngine\][^`]*PRE_BREAKOUT 30%/);
    expect(INTRADAY_SRC).toMatch(/\[Sizing-NewEngine\][^`]*INTRADAY_STRONG/);
  });

  it('keeps live/shadow mode isolation for followthrough, pre-breakout, and intraday paths', () => {
    expect(FOLLOW_BUDGET_SRC).toMatch(/sizingApplyFollow\s*=\s*applyPositionSizingEngine\s*\(\s*ctx\.shadowMode/);
    expect(PB_SRC).toMatch(/sizingApplyPb\s*=\s*applyPositionSizingEngine\s*\(\s*ctx\.shadowMode/);
    expect(INTRADAY_SRC).toMatch(/sizingApplyIntra\s*=\s*applyPositionSizingEngine\s*\(\s*ctx\.shadowMode/);
  });
});
