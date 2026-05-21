import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('ADR-0520 NORMAL Gate Wiring SSOT Patch static guards', () => {
  const source = readFileSync(join(process.cwd(), 'server/trading/signalScanner/index.ts'), 'utf8');

  it('normal scan candidateSnapshots uses SSOT builder for buy/intraday', () => {
    expect(source).toContain('buildCandidateSnapshotSsot');
    expect(source).toMatch(/candidates\.buyList\.map\(\(w: any\) => \(\{\s*\.\.\.buildCandidateSnapshotSsot\(w, macro\)/s);
    expect(source).toMatch(/candidates\.intradayList\.map\(\(w: any\) => \(\{\s*\.\.\.buildCandidateSnapshotSsot\(w, macro\)/s);
  });

  it('ssot builder carries hydration and execution fields for NORMAL path', () => {
    const required = [
      'quoteHydrated',
      'symbolFeaturesHydrated',
      'conditionResultsHydrated',
      'supplyContextHydrated',
      'sectorContextHydrated',
      'financialContextHydrated',
      'riskContextHydrated',
      'gate1Result',
      'gate2Result',
      'gate3Result',
      'entryScore',
      'entryDecision',
      'sourcePath',
      'executionImpact',
      'shadowExecutionAllowed',
    ];
    for (const token of required) {
      expect(source).toContain(token);
    }
  });
});
