// @responsibility Merge-safety guard for diagnostic investor-flow/freshness wiring.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIAGNOSTIC_WIRING_FILES = [
  'server/supply/investorFlowProviderHealth.ts',
  'server/trading/signalScanner/gate1DryRunObservationLedgerAdr0476.ts',
  'server/trading/signalScanner/gate1PositiveSourceWiringAdr0475.ts',
  'server/trading/signalScanner/investorFlowProviderRouterAdr0477.ts',
  'server/trading/signalScanner/naverInvestorTrendCollectorAdr0484.ts',
  'server/trading/signalScanner/operatorActionRouterAdr0480.ts',
  'server/trading/signalScanner/semanticNetBuyNormalizerAdr0485.ts',
  'server/trading/signalScanner/supplySourceFreshnessAdr0486.ts',
] as const;

const CONFLICT_MARKER_RE = /^(<<<<<<<|=======|>>>>>>>)\s/m;
const ADR_0483_RE = /ADR[-_]?0483|Adr0483|adr0483|0483-supply-source-freshness/i;

describe('diagnostic wiring merge conflict guard', () => {
  it.each(DIAGNOSTIC_WIRING_FILES)('%s has no unresolved merge conflict markers', (file) => {
    const src = fs.readFileSync(path.resolve(file), 'utf-8');
    expect(src).not.toMatch(CONFLICT_MARKER_RE);
  });

  it.each(DIAGNOSTIC_WIRING_FILES)('%s does not claim ADR-0483 identifiers', (file) => {
    const src = fs.readFileSync(path.resolve(file), 'utf-8');
    expect(src).not.toMatch(ADR_0483_RE);
  });
});
