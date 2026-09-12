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
  it('routes all four execution paths through the public quantity boundary', () => {
    for (const source of [BUYLIST_SRC, FOLLOW_BUDGET_SRC, PB_SRC, INTRADAY_SRC]) {
      expect(source).toMatch(/import\s*\{[^}]*calculateOrderQuantity[^}]*\}\s*from\s*['"][^'"]*entrySizingPolicy\.js/);
      expect((source.match(/calculateOrderQuantity\s*\(/g) || []).length).toBe(1);
      expect(source).not.toMatch(/applyPositionSizingEngine|accountKellyMultiplier|positionSizingEngineWiring/);
    }
  });

  it('preserves the followthrough 70% ceil and exposure cap', () => {
    expect(FOLLOW_BUDGET_SRC).toContain('const fullQty = legacyFullQty;');
    expect(FOLLOW_BUDGET_SRC).toContain('Math.max(1, Math.ceil(fullQty * 0.7))');
    expect(FOLLOW_BUDGET_SRC).toContain('exposureCapFollow.applied ? exposureCapFollow.finalQuantity : followQtyRaw');
  });

  it('preserves the initial pre-breakout 30% floor and exposure cap', () => {
    expect(PB_SRC).toContain('const fullPbQty = legacyFullPbQty;');
    expect(PB_SRC).toContain('Math.max(1, Math.floor(fullPbQty * 0.3))');
    expect(PB_SRC).toContain('exposureCapPb.applied ? exposureCapPb.finalQuantity : pbQtyRaw');
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

  it('keeps floor policy separate from the quantity boundary to avoid the entry-engine cycle', () => {
    for (const source of [BUYLIST_SRC, FOLLOW_BUDGET_SRC, PB_SRC, INTRADAY_SRC]) {
      expect(source).toMatch(/import\s*\{[^}]*resolveCandidatePositionFloor[^}]*\}\s*from\s*['"][^'"]*shadowBullExposureProfile\.js/);
    }
  });
});
