// @responsibility ADR-0474 SectorEnergy coverage recovery dry-run tests
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECTOR_INDEX_MASTER, type SectorIndexMasterEntry } from './sectorEnergyMaster.js';
import {
  buildSectorEnergyAliasSuggestion,
  buildSectorEnergyCoverageRecoveryReport,
  formatSectorEnergyCoverageRecoverySection,
} from './sectorEnergyCoverageRecoveryAdr0474.js';
import type { RecoveryRowInput } from './sectorEnergyIndexCodeRecoveryDiagnostic.js';

const moduleSource = () => readFileSync(
  new URL('./sectorEnergyCoverageRecoveryAdr0474.ts', import.meta.url),
  'utf8',
);
const scanBlockersSource = () => readFileSync(
  new URL('../telegram/commands/system/scanBlockers.cmd.ts', import.meta.url),
  'utf8',
);
const sectorDiagSource = () => readFileSync(
  new URL('../telegram/commands/system/sectorEnergyDiag.cmd.ts', import.meta.url),
  'utf8',
);

const first = SECTOR_INDEX_MASTER[0]!;
const exactAlias = first.aliases[0] ?? first.displayName;

function rows(): { before: RecoveryRowInput[]; after: RecoveryRowInput[] } {
  return {
    before: [
      { indexCode: '1', indexName: first.displayName, indexCodeSource: 'RAW' },
      { indexCode: '', indexName: exactAlias },
      { indexCode: '', indexName: 'KOSPI' },
      { indexCode: '', indexName: 'Unmapped Theme' },
    ],
    after: [
      { indexCode: '1', indexName: first.displayName, indexCodeSource: 'RAW' },
      { indexCode: '2', indexName: first.displayName, indexCodeSource: 'NAME_LOOKUP' },
      { indexCode: '', indexName: exactAlias },
      { indexCode: '', indexName: 'KOSPI' },
    ],
  };
}

function customMaster(): SectorIndexMasterEntry[] {
  return [
    {
      sectorKey: 'SEMICONDUCTOR',
      displayName: 'Semiconductor',
      krxIndexCode: 'IDX1',
      market: 'KOSPI',
      aliases: ['Semis', 'Alpha Power'],
    },
    {
      sectorKey: 'BATTERY',
      displayName: 'Battery',
      krxIndexCode: 'IDX2',
      market: 'KOSPI',
      aliases: ['Battery Cell', 'Alpha Power'],
    },
  ];
}

describe('ADR-0474 SectorEnergy Coverage Recovery', () => {
  it('indexCode missing inventory is generated', () => {
    const r = rows();
    const report = buildSectorEnergyCoverageRecoveryReport({
      rowsBeforeNameLookup: r.before,
      rowsAfterNameLookup: r.after,
    });

    expect(report.missingItems.length).toBe(2);
    expect(report.missingItems.some((item) => item.name === exactAlias)).toBe(true);
  });

  it('NAME_LOOKUP recovery before/after coverage is calculated', () => {
    const r = rows();
    const report = buildSectorEnergyCoverageRecoveryReport({
      rowsBeforeNameLookup: r.before,
      rowsAfterNameLookup: r.after,
    });

    expect(report.indexCodeCoverageBefore).toBe(0.25);
    expect(report.indexCodeCoverageAfterNameLookup).toBe(0.5);
    expect(report.nameLookupRecoveredCount).toBe(1);
  });

  it('alias candidate dry-run coverage is calculated without live application', () => {
    const r = rows();
    const report = buildSectorEnergyCoverageRecoveryReport({
      rowsBeforeNameLookup: r.before,
      rowsAfterNameLookup: r.after,
    });

    expect(report.indexCodeCoverageAfterAliasCandidate).toBe(0.75);
    expect(report.aliasCandidateCount).toBe(1);
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('exact unique alias is SAFE_EXACT', () => {
    const suggestion = buildSectorEnergyAliasSuggestion('Semis', customMaster());

    expect(suggestion.safety).toBe('SAFE_EXACT');
    expect(suggestion.candidateIndexCode).toBe('IDX1');
  });

  it('normalized unique alias is SAFE_NORMALIZED', () => {
    const suggestion = buildSectorEnergyAliasSuggestion('Battery-Cell', customMaster());

    expect(suggestion.safety).toBe('SAFE_NORMALIZED');
    expect(suggestion.candidateIndexCode).toBe('IDX2');
  });

  it('multiple candidates are UNSAFE_AMBIGUOUS', () => {
    const suggestion = buildSectorEnergyAliasSuggestion('Alpha Power', customMaster());

    expect(suggestion.safety).toBe('UNSAFE_AMBIGUOUS');
    expect(suggestion.applyAutomatically).toBe(false);
  });

  it('ETF/theme/aggregate names are UNSAFE_AGGREGATE', () => {
    const suggestion = buildSectorEnergyAliasSuggestion('KOSPI');

    expect(suggestion.safety).toBe('UNSAFE_AGGREGATE');
    expect(suggestion.applyAutomatically).toBe(false);
  });

  it('NO_MATCH is not automatically applied', () => {
    const suggestion = buildSectorEnergyAliasSuggestion('No Matching Sector', customMaster());

    expect(suggestion.safety).toBe('NO_MATCH');
    expect(suggestion.applyAutomatically).toBe(false);
  });

  it('all alias suggestions have applyAutomatically=false', () => {
    const r = rows();
    const report = buildSectorEnergyCoverageRecoveryReport({
      rowsBeforeNameLookup: r.before,
      rowsAfterNameLookup: r.after,
    });

    expect(report.aliasSuggestions.length).toBeGreaterThan(0);
    expect(report.aliasSuggestions.every((item) => item.applyAutomatically === false)).toBe(true);
  });

  it('STOCK_DAILY fallback is never promoted to trusted leadership', () => {
    const report = buildSectorEnergyCoverageRecoveryReport({
      qualityDiagnostic: {
        dataQuality: 'DEGRADED',
        reasons: ['STOCK_DAILY_FALLBACK_USED'],
        validSectorCount: 10,
        expectedSectorCount: 12,
        indexCodeCoverage: 0.275,
        missingIndexCodeCount: 66,
        totalSectorRows: 91,
        fallbackUsed: 'STOCK_DAILY',
        symmetryValidationPassed: false,
        shouldBlockLeadershipConfidence: true,
        operatorMessage: 'fallbackUsed=STOCK_DAILY',
      },
    });

    expect(report.fallbackUsed).toBe('STOCK_DAILY');
    expect(report.leadershipConfidence).toBe('BLOCKED');
    expect(report.sectorBoostAllowed).toBe(false);
    expect(report.strongBuyAllowed).toBe(false);
  });

  it('DEGRADED/BLOCKED is not promoted to OK', () => {
    const report = buildSectorEnergyCoverageRecoveryReport({
      qualityDiagnostic: {
        dataQuality: 'DEGRADED',
        reasons: ['INDEX_CODE_COVERAGE_LOW'],
        validSectorCount: 10,
        expectedSectorCount: 12,
        indexCodeCoverage: 0.275,
        missingIndexCodeCount: 66,
        totalSectorRows: 91,
        fallbackUsed: 'STOCK_DAILY',
        symmetryValidationPassed: false,
        shouldBlockLeadershipConfidence: true,
        operatorMessage: 'leadershipConfidence=BLOCKED',
      },
    });

    expect(report.leadershipConfidence).not.toBe('OK');
  });



  it('KIS_STOCK_BASKET_DERIVED remains shadow-only even with 100% basket coverage', () => {
    const report = buildSectorEnergyCoverageRecoveryReport({
      qualityDiagnostic: {
        dataQuality: 'PARTIAL',
        reasons: ['KIS_BASKET_DERIVED_SHADOW'],
        validSectorCount: 12,
        expectedSectorCount: 12,
        indexCodeCoverage: 0,
        missingIndexCodeCount: 12,
        totalSectorRows: 12,
        sourceTier: 'KIS_STOCK_BASKET_DERIVED',
        fallbackUsed: 'NONE',
        symmetryValidationPassed: true,
        shouldBlockLeadershipConfidence: false,
        operatorMessage: 'KIS basket is derived representative basket, not official sector index.',
      },
    });

    expect(report.sourceTier).toBe('KIS_STOCK_BASKET_DERIVED');
    expect(report.leadershipConfidence).toBe('READY_FOR_SHADOW');
    expect(report.sectorBoostAllowed).toBe(false);
    expect(report.strongBuyAllowed).toBe(false);
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.executionImpact).toBe('NONE');
    expect(report.recommendedAction).toBe('OBSERVE_20D_THEN_PROMOTION_AUDIT');
  });

  it('execution and live invariants stay disabled', () => {
    const report = buildSectorEnergyCoverageRecoveryReport();

    expect(report.executionHardBlock).toBe(false);
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('formatter includes ADR-0474 section without raw Telegram HTML', () => {
    const r = rows();
    const section = formatSectorEnergyCoverageRecoverySection(buildSectorEnergyCoverageRecoveryReport({
      rowsBeforeNameLookup: r.before,
      rowsAfterNameLookup: r.after,
      qualityDiagnostic: {
        dataQuality: 'DEGRADED',
        reasons: ['STOCK_DAILY_FALLBACK_USED'],
        validSectorCount: 10,
        expectedSectorCount: 12,
        indexCodeCoverage: 0.275,
        missingIndexCodeCount: 66,
        totalSectorRows: 91,
        fallbackUsed: 'STOCK_DAILY',
        symmetryValidationPassed: false,
        shouldBlockLeadershipConfidence: true,
        operatorMessage: 'fallbackUsed=STOCK_DAILY',
      },
    }));

    expect(section).toContain('SectorEnergy Coverage Recovery (ADR-0474)');
    expect(section).toContain('executionImpact: NONE');
    expect(section).not.toMatch(/<b>|<i>|<code>/);
  });

  it('/scan_blockers and sectorEnergyDiag wire the ADR-0474 formatter', () => {
    expect(scanBlockersSource()).toContain('formatSectorEnergyCoverageRecoverySection');
    expect(sectorDiagSource()).toContain('formatSectorEnergyCoverageRecoverySection');
    expect(scanBlockersSource()).toContain('[ADR-0474]');
    expect(sectorDiagSource()).toContain('[ADR-0474]');
    expect(scanBlockersSource()).toContain('fallback mounted to /scan_blockers');
    expect(sectorDiagSource()).toContain('fallback mounted to /sector_energy_diag');
    expect(scanBlockersSource()).toContain('buildSectorEnergyCoverageRecoveryReport()');
    expect(sectorDiagSource()).toContain('buildSectorEnergyCoverageRecoveryReport()');
  });

  it('static guard: KIS order imports are absent', () => {
    const text = moduleSource();

    expect(text).not.toContain('placeKisMarketBuyOrder');
    expect(text).not.toContain('placeKisSellOrder');
    expect(text).not.toContain('placeKisStopLossOrder');
    expect(text).not.toContain('placeKisTakeProfitOrder');
    expect(text).not.toContain('cancelKisOrder');
  });

  it('static guard: external API calls are absent', () => {
    const text = moduleSource();

    expect(text).not.toContain('fetch(');
    expect(text).not.toContain('axios');
  });

  it('static guard: raw payload persistence and forced OK promotion are absent', () => {
    const text = moduleSource();

    expect(text).not.toContain('rawPayload');
    expect(text).not.toContain('JSON.stringify(input)');
    expect(text).not.toContain('SECTOR_ENERGY_OK_FORCE');
    expect(text).not.toContain('forceOk');
    expect(text).not.toContain('promoteToOk');
    expect(text).not.toContain('trusted leadership');
  });

  it('static guard: Gate threshold and STRONG_BUY overrides are absent', () => {
    const text = moduleSource();

    expect(text).not.toContain('setGateThreshold');
    expect(text).not.toContain('GATE_RELAX');
    expect(text).not.toContain('STRONG_BUY_OVERRIDE');
  });

  it('ADR-0474 document exists and ADR index has advanced past 0474', () => {
    const root = process.cwd();
    const doc = join(root, 'docs/adr/0474-sector-energy-indexcode-coverage-recovery.md');
    const index = readFileSync(join(root, 'docs/adr/INDEX.md'), 'utf8');

    expect(existsSync(doc)).toBe(true);
    expect(readFileSync(doc, 'utf8')).toContain('Dry-run');
    // ADR index must have advanced past 0474 — parse the SSOT "다음 발급" number
    // numerically rather than range-matching (brittle once index crosses 0599).
    const nextAdrMatch = index.match(/다음 ADR 번호: `(\d{4})`/);
    expect(nextAdrMatch).not.toBeNull();
    expect(Number(nextAdrMatch![1])).toBeGreaterThan(474);
  });
});
