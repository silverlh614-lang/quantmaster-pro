/**
 * @responsibility ADR-0446 Phase 2 + Sanity Violation Diagnostic 회귀 테스트.
 *
 * 사용자 §"테스트 요구사항" 56 항목 + 사용자 §"운영 출력 기대값" 정합 검증.
 *
 * 절대 불변식 검증:
 *   1. STOCK_DAILY fallback trusted leadership 금지.
 *   2. fallbackUsed != 'NONE' → recoveryStatus='RECOVERED' 금지.
 *   3. symmetryValidation FAILED → recoveryStatus='RECOVERED' 금지.
 *   4. indexCodeCoverage < 0.8 → recoveryStatus='RECOVERED' 금지.
 *   5. sanityViolationCount > 0 → recoveryStatus='RECOVERED' 금지 (PARTIAL 격하).
 *   6. STOCK_DAILY fallback → leadershipConfidence='OK' 금지.
 *   7. sanity violation clamp 후 OK 표시 금지.
 *   8. confidenceImpact 결정 트리 (NONE/DEGRADED/BLOCKED).
 *   9. KIS 주문 함수 5종 import 0 (정적 grep 가드).
 *  10. Gate threshold + condition weight + STRONG_BUY 0 변경.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateIndexCodeRecovery,
  formatPhase2RecoverySection,
  formatPhase2RecoveryCompactLine,
  isSectorEnergyRecoveryPhase2Disabled,
  normalizeIndexNameForLookup,
  expandAliasCandidates,
  classifyRowSourceTier,
  classifyMissingReason,
  escapePhase2Html,
  SECTOR_ENERGY_RECOVERY_PHASE2_THRESHOLDS,
  type RecoveryRowInput,
  type SectorIndexCodeMissingReason,
  type SectorIndexRowSourceTier,
} from './sectorEnergyIndexCodeRecoveryDiagnostic.js';
import {
  classifySanityViolationKind,
  createSanityViolationState,
  deriveConfidenceImpact,
  escapeSanityHtml,
  finalizeSanityDiagnostic,
  formatSanityDiagnosticCompactLine,
  formatSanityDiagnosticSection,
  isSectorEnergySanityDiagnosticDisabled,
  recordSanityViolation,
  SECTOR_ENERGY_SANITY_THRESHOLDS,
  type SectorEnergySanityViolation,
} from './sectorEnergySanityViolationDiagnostic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeIndexRow(opts: {
  indexName?: string;
  indexCode?: string | null;
  indexCodeSource?: string | null;
  rowSourceTier?: SectorIndexRowSourceTier;
}): RecoveryRowInput {
  return {
    indexCode: opts.indexCode ?? null,
    indexName: opts.indexName ?? null,
    indexCodeSource: opts.indexCodeSource ?? null,
    ...(opts.rowSourceTier ? { rowSourceTier: opts.rowSourceTier } : {}),
  };
}

// ===========================================================================
// §1. ENV gates — ADR-0157 정확 비교
// ===========================================================================

describe('ADR-0446 §1. ENV gates (ADR-0157 정확 비교)', () => {
  it('isSectorEnergyRecoveryPhase2Disabled — default false', () => {
    delete process.env.SECTOR_ENERGY_RECOVERY_PHASE2_DISABLED;
    expect(isSectorEnergyRecoveryPhase2Disabled()).toBe(false);
  });

  it('isSectorEnergyRecoveryPhase2Disabled — "true" exact match', () => {
    process.env.SECTOR_ENERGY_RECOVERY_PHASE2_DISABLED = 'true';
    try {
      expect(isSectorEnergyRecoveryPhase2Disabled()).toBe(true);
    } finally {
      delete process.env.SECTOR_ENERGY_RECOVERY_PHASE2_DISABLED;
    }
  });

  it('isSectorEnergyRecoveryPhase2Disabled — "1"/"TRUE"/"yes" 모두 거부', () => {
    for (const v of ['1', 'TRUE', 'yes', 'True', 'YES']) {
      process.env.SECTOR_ENERGY_RECOVERY_PHASE2_DISABLED = v;
      try {
        expect(isSectorEnergyRecoveryPhase2Disabled()).toBe(false);
      } finally {
        delete process.env.SECTOR_ENERGY_RECOVERY_PHASE2_DISABLED;
      }
    }
  });

  it('isSectorEnergySanityDiagnosticDisabled — default false', () => {
    delete process.env.SECTOR_ENERGY_SANITY_DIAGNOSTIC_DISABLED;
    expect(isSectorEnergySanityDiagnosticDisabled()).toBe(false);
  });

  it('isSectorEnergySanityDiagnosticDisabled — "true" exact match', () => {
    process.env.SECTOR_ENERGY_SANITY_DIAGNOSTIC_DISABLED = 'true';
    try {
      expect(isSectorEnergySanityDiagnosticDisabled()).toBe(true);
    } finally {
      delete process.env.SECTOR_ENERGY_SANITY_DIAGNOSTIC_DISABLED;
    }
  });
});

// ===========================================================================
// §2. normalizeIndexNameForLookup + expandAliasCandidates
// ===========================================================================

describe('ADR-0446 §2. normalizeIndexNameForLookup + alias expansion', () => {
  it('strips whitespace + parentheses', () => {
    const r = normalizeIndexNameForLookup('  코스피 200 ( 반도체 )  ');
    expect(r.normalized.length).toBeGreaterThan(0);
    expect(r.normalized).not.toMatch(/[()]/);
  });

  it('strips KOSPI/KOSDAQ prefix', () => {
    const r1 = normalizeIndexNameForLookup('코스피 반도체');
    const r2 = normalizeIndexNameForLookup('코스닥 반도체');
    // Both should result in similar normalized forms (KOSPI/KOSDAQ prefix stripped).
    expect(r1.normalized).toBe(r2.normalized);
  });

  it('lowercases + strips special chars (· / ,)', () => {
    const r = normalizeIndexNameForLookup('바이오·헬스케어/제약');
    expect(r.normalized).not.toMatch(/[·/,]/);
  });

  it('empty input returns empty normalized', () => {
    const r = normalizeIndexNameForLookup('');
    expect(r.normalized).toBe('');
  });

  it('null/undefined input returns empty normalized', () => {
    const r = normalizeIndexNameForLookup(null as unknown as string);
    expect(r.normalized).toBe('');
  });

  it('expandAliasCandidates — known sector returns ≥1 candidate', () => {
    const candidates = expandAliasCandidates(normalizeIndexNameForLookup('반도체').normalized);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
  });

  it('expandAliasCandidates — unknown returns 0', () => {
    const candidates = expandAliasCandidates('이상한이름abc');
    expect(candidates.length).toBe(0);
  });
});

// ===========================================================================
// §3. classifyRowSourceTier + classifyMissingReason
// ===========================================================================

describe('ADR-0446 §3. row source tier + missing reason classification', () => {
  it('row.indexCode + RAW source → KRX_CODE', () => {
    expect(classifyRowSourceTier(makeIndexRow({ indexCode: '01', indexCodeSource: 'RAW' }))).toBe('KRX_CODE');
  });

  it('row.indexCode + NAME_LOOKUP source → KRX_CODE (backfill 효과)', () => {
    expect(classifyRowSourceTier(makeIndexRow({ indexCode: '01', indexCodeSource: 'NAME_LOOKUP' }))).toBe('KRX_CODE');
  });

  it('row.indexCodeSource=STOCK_DAILY_DERIVED → STOCK_DAILY', () => {
    expect(classifyRowSourceTier(makeIndexRow({ indexCodeSource: 'STOCK_DAILY_DERIVED' }))).toBe('STOCK_DAILY');
  });

  it('row.rowSourceTier 명시 → 그대로 사용 (호출자 책임)', () => {
    expect(classifyRowSourceTier(makeIndexRow({ rowSourceTier: 'CACHE' }))).toBe('CACHE');
    expect(classifyRowSourceTier(makeIndexRow({ rowSourceTier: 'DATA_DBG' }))).toBe('DATA_DBG');
    expect(classifyRowSourceTier(makeIndexRow({ rowSourceTier: 'ETF' }))).toBe('ETF');
  });

  it('classifyMissingReason — empty indexName → EMPTY_INDEX_NAME', () => {
    expect(classifyMissingReason(makeIndexRow({ indexName: '' }))).toBe('EMPTY_INDEX_NAME');
    expect(classifyMissingReason(makeIndexRow({ indexName: '   ' }))).toBe('EMPTY_INDEX_NAME');
  });

  it('classifyMissingReason — STOCK_DAILY tier → STOCK_DAILY_ROW_NO_INDEX_SOURCE', () => {
    expect(
      classifyMissingReason(makeIndexRow({ rowSourceTier: 'STOCK_DAILY', indexName: '반도체' })),
    ).toBe('STOCK_DAILY_ROW_NO_INDEX_SOURCE');
  });

  it('classifyMissingReason — ETF tier → ETF_OR_DERIVED_ROW', () => {
    expect(
      classifyMissingReason(makeIndexRow({ rowSourceTier: 'ETF', indexName: 'KODEX 반도체' })),
    ).toBe('ETF_OR_DERIVED_ROW');
  });

  it('classifyMissingReason — DATA_DBG tier → DATA_DBG_ROW_MISSING_IDX_IND_CD', () => {
    expect(
      classifyMissingReason(makeIndexRow({ rowSourceTier: 'DATA_DBG', indexName: '디버그' })),
    ).toBe('DATA_DBG_ROW_MISSING_IDX_IND_CD');
  });

  it('classifyMissingReason — CACHE tier → CACHE_ROW_MISSING_INDEX_CODE', () => {
    expect(
      classifyMissingReason(makeIndexRow({ rowSourceTier: 'CACHE', indexName: '캐시' })),
    ).toBe('CACHE_ROW_MISSING_INDEX_CODE');
  });
});

// ===========================================================================
// §4. evaluateIndexCodeRecovery — 핵심 결정 트리
// ===========================================================================

describe('ADR-0446 §4. evaluateIndexCodeRecovery decision tree', () => {
  it('NOT_NEEDED — fallback NONE + backfilled 0 + coverage 1.0 + symmetry pass', () => {
    const before = [makeIndexRow({ indexCode: '01', indexName: '반도체', indexCodeSource: 'RAW' })];
    const after = before;
    const r = evaluateIndexCodeRecovery({
      rowsBeforeBackfill: before,
      rowsAfterBackfill: after,
      fallbackUsed: 'NONE',
      symmetryValidationPassed: true,
      sanityViolationCount: 0,
    });
    expect(r.recoveryStatus).toBe('NOT_NEEDED');
    expect(r.leadershipConfidence).toBe('OK');
  });

  it('RECOVERED — backfill 가 0% → 100% 회복 + symmetry pass + sanity 0', () => {
    const before = [makeIndexRow({ indexName: '반도체' })];
    const after = [makeIndexRow({ indexCode: '01', indexName: '반도체', indexCodeSource: 'NAME_LOOKUP' })];
    const r = evaluateIndexCodeRecovery({
      rowsBeforeBackfill: before,
      rowsAfterBackfill: after,
      fallbackUsed: 'NONE',
      symmetryValidationPassed: true,
      sanityViolationCount: 0,
    });
    expect(r.recoveryStatus).toBe('RECOVERED');
    expect(r.backfilledByNameLookup).toBe(1);
    expect(r.leadershipConfidence).toBe('OK');
  });

  it('STILL_STALE — coverage 0 + symmetry fail (74/91 결손 시나리오)', () => {
    // 91 rows, 17 with indexCode, 74 missing (= 사용자 명시 운영 결함)
    const before: RecoveryRowInput[] = [];
    const after: RecoveryRowInput[] = [];
    for (let i = 0; i < 91; i++) {
      const has = i < 17;
      before.push(makeIndexRow({ indexCode: has ? `i${i}` : null, indexName: `idx${i}` }));
      after.push(makeIndexRow({ indexCode: has ? `i${i}` : null, indexName: `idx${i}`, indexCodeSource: has ? 'RAW' : null }));
    }
    const r = evaluateIndexCodeRecovery({
      rowsBeforeBackfill: before,
      rowsAfterBackfill: after,
      fallbackUsed: 'STOCK_DAILY',
      symmetryValidationPassed: false,
      sanityViolationCount: 0,
    });
    // afterCoverage = 17/91 ≈ 0.187
    expect(r.afterIndexCodeCoverage).toBeCloseTo(17 / 91, 2);
    // fallback != NONE → RECOVERED 절대 금지 (절대 불변식)
    expect(r.recoveryStatus).not.toBe('RECOVERED');
    // leadership BLOCKED — STOCK_DAILY fallback (절대 불변식)
    expect(r.leadershipConfidence).toBe('BLOCKED');
  });

  it('PARTIAL — backfill 후 coverage<0.8 + sanity 0 + fallback NONE', () => {
    // 10 rows, 5 backfilled
    const before: RecoveryRowInput[] = [];
    const after: RecoveryRowInput[] = [];
    for (let i = 0; i < 10; i++) {
      before.push(makeIndexRow({ indexName: `s${i}` }));
      const has = i < 5;
      after.push(makeIndexRow({
        indexCode: has ? `${i}` : null,
        indexName: `s${i}`,
        indexCodeSource: has ? 'NAME_LOOKUP' : null,
      }));
    }
    const r = evaluateIndexCodeRecovery({
      rowsBeforeBackfill: before,
      rowsAfterBackfill: after,
      fallbackUsed: 'NONE',
      symmetryValidationPassed: true,
      sanityViolationCount: 0,
    });
    expect(r.recoveryStatus).toBe('PARTIAL');
    expect(r.backfilledByNameLookup).toBe(5);
    expect(r.afterIndexCodeCoverage).toBeCloseTo(0.5, 2);
  });

  it('절대 불변식 — fallback STOCK_DAILY + symmetry pass + coverage>=0.8 → RECOVERED 금지 (PARTIAL)', () => {
    const before = [makeIndexRow({ indexCode: '01', indexName: '반도체' })];
    const after = before;
    const r = evaluateIndexCodeRecovery({
      rowsBeforeBackfill: before,
      rowsAfterBackfill: after,
      fallbackUsed: 'STOCK_DAILY',
      symmetryValidationPassed: true,
      sanityViolationCount: 0,
    });
    expect(r.recoveryStatus).not.toBe('RECOVERED');
    expect(r.leadershipConfidence).toBe('BLOCKED'); // STOCK_DAILY fallback → BLOCKED
  });

  it('절대 불변식 — symmetry FAILED → RECOVERED 금지', () => {
    const before = [makeIndexRow({ indexName: '반도체' })];
    const after = [makeIndexRow({ indexCode: '01', indexName: '반도체', indexCodeSource: 'NAME_LOOKUP' })];
    const r = evaluateIndexCodeRecovery({
      rowsBeforeBackfill: before,
      rowsAfterBackfill: after,
      fallbackUsed: 'NONE',
      symmetryValidationPassed: false, // FAILED
      sanityViolationCount: 0,
    });
    expect(r.recoveryStatus).not.toBe('RECOVERED');
  });

  it('절대 불변식 — sanityViolationCount > 0 → RECOVERED 금지', () => {
    const before = [makeIndexRow({ indexName: '반도체' })];
    const after = [makeIndexRow({ indexCode: '01', indexName: '반도체', indexCodeSource: 'NAME_LOOKUP' })];
    const r = evaluateIndexCodeRecovery({
      rowsBeforeBackfill: before,
      rowsAfterBackfill: after,
      fallbackUsed: 'NONE',
      symmetryValidationPassed: true,
      sanityViolationCount: 5,
    });
    expect(r.recoveryStatus).not.toBe('RECOVERED');
  });

  it('절대 불변식 — coverage<0.8 → RECOVERED 금지', () => {
    const before: RecoveryRowInput[] = [];
    const after: RecoveryRowInput[] = [];
    for (let i = 0; i < 10; i++) {
      before.push(makeIndexRow({ indexName: `s${i}` }));
      after.push(makeIndexRow({
        indexCode: i < 7 ? `${i}` : null, // 70% coverage
        indexName: `s${i}`,
        indexCodeSource: i < 7 ? 'NAME_LOOKUP' : null,
      }));
    }
    const r = evaluateIndexCodeRecovery({
      rowsBeforeBackfill: before,
      rowsAfterBackfill: after,
      fallbackUsed: 'NONE',
      symmetryValidationPassed: true,
      sanityViolationCount: 0,
    });
    expect(r.recoveryStatus).not.toBe('RECOVERED');
  });

  it('AMBIGUOUS_ALIAS counted in missingReasonBreakdown 분류 가능', () => {
    // We just verify breakdown structure
    const r = evaluateIndexCodeRecovery({
      rowsBeforeBackfill: [],
      rowsAfterBackfill: [
        makeIndexRow({ indexName: '반도체', indexCode: null }),
        makeIndexRow({ indexName: '바이오', indexCode: null }),
      ],
      fallbackUsed: 'NONE',
      symmetryValidationPassed: true,
      sanityViolationCount: 0,
    });
    expect(r.missingReasonBreakdown).toBeDefined();
    // breakdown 합 = stillMissing
    const total = (Object.values(r.missingReasonBreakdown) as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBe(r.rowsMissingIndexCode);
  });

  it('topMissingIndexNames 정렬 — count desc', () => {
    const after: RecoveryRowInput[] = [];
    // "반도체" appears 5 times missing, "바이오" 3 times missing
    for (let i = 0; i < 5; i++) after.push(makeIndexRow({ indexName: '반도체' }));
    for (let i = 0; i < 3; i++) after.push(makeIndexRow({ indexName: '바이오' }));
    const r = evaluateIndexCodeRecovery({
      rowsBeforeBackfill: after,
      rowsAfterBackfill: after,
      fallbackUsed: 'NONE',
      symmetryValidationPassed: true,
      sanityViolationCount: 0,
    });
    if (r.topMissingIndexNames.length >= 2) {
      expect(r.topMissingIndexNames[0]!.count).toBeGreaterThanOrEqual(r.topMissingIndexNames[1]!.count);
    }
  });

  it('sourceTierBreakdown 합 = totalRows', () => {
    const after = [
      makeIndexRow({ indexCode: '01', indexCodeSource: 'RAW' }),
      makeIndexRow({ indexCode: '02', indexCodeSource: 'NAME_LOOKUP' }),
      makeIndexRow({ rowSourceTier: 'STOCK_DAILY' }),
      makeIndexRow({ rowSourceTier: 'CACHE' }),
    ];
    const r = evaluateIndexCodeRecovery({
      rowsBeforeBackfill: after,
      rowsAfterBackfill: after,
      fallbackUsed: 'NONE',
      symmetryValidationPassed: true,
      sanityViolationCount: 0,
    });
    const total = (Object.values(r.sourceTierBreakdown) as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBe(after.length);
  });
});

// ===========================================================================
// §5. formatPhase2RecoverySection / CompactLine — HTML safety + 표시
// ===========================================================================

describe('ADR-0446 §5. Phase 2 formatters + HTML safety', () => {
  const sample = (() => {
    const before: RecoveryRowInput[] = [];
    const after: RecoveryRowInput[] = [];
    for (let i = 0; i < 91; i++) {
      const has = i < 17;
      before.push(makeIndexRow({ indexName: `idx${i}` }));
      after.push(makeIndexRow({
        indexCode: has ? `${i}` : null,
        indexName: `idx${i}`,
        indexCodeSource: has ? 'NAME_LOOKUP' : null,
      }));
    }
    return evaluateIndexCodeRecovery({
      rowsBeforeBackfill: before,
      rowsAfterBackfill: after,
      fallbackUsed: 'STOCK_DAILY',
      symmetryValidationPassed: false,
      sanityViolationCount: 0,
    });
  })();

  it('formatPhase2RecoverySection — null fallback', () => {
    expect(formatPhase2RecoverySection(null)).toBeNull();
    expect(formatPhase2RecoverySection(undefined)).toBeNull();
  });

  it('formatPhase2RecoverySection — 헤더 + coverage % 포함', () => {
    const out = formatPhase2RecoverySection(sample)!;
    expect(out).toContain('🧩 SectorEnergy indexCode Recovery Phase 2');
    expect(out).toContain('beforeCoverage');
    expect(out).toContain('afterCoverage');
    expect(out).toContain('recoveryStatus');
    expect(out).toContain('legacyLeadershipConfidenceDiagnosticOnly');
  });

  it('formatPhase2RecoveryCompactLine — 핵심 필드 포함 (사용자 §"운영 출력 기대값")', () => {
    const out = formatPhase2RecoveryCompactLine(sample)!;
    expect(out).toContain('SectorEnergy Recovery:');
    expect(out).toContain('indexCodeCoverage');
    expect(out).toContain('missing');
    expect(out).toContain('fallback');
    expect(out).toContain('leadership');
  });

  it('escapePhase2Html — `<` `>` `&` 차단', () => {
    expect(escapePhase2Html('<script>alert("a")&"b"')).toContain('&lt;');
    expect(escapePhase2Html('<script>')).toContain('&lt;script&gt;');
    expect(escapePhase2Html(null)).toBe('');
    expect(escapePhase2Html(undefined)).toBe('');
  });

  it('formatPhase2RecoverySection — topMissing 의 raw name 자동 escape', () => {
    const r = evaluateIndexCodeRecovery({
      rowsBeforeBackfill: [],
      rowsAfterBackfill: [makeIndexRow({ indexName: '<bad>name&' })],
      fallbackUsed: 'NONE',
      symmetryValidationPassed: true,
      sanityViolationCount: 0,
    });
    const out = formatPhase2RecoverySection(r)!;
    expect(out).not.toMatch(/<bad>/);
    expect(out).toMatch(/&lt;bad&gt;|&lt;/);
  });
});

// ===========================================================================
// §6. classifySanityViolationKind + thresholds
// ===========================================================================

describe('ADR-0446 §6. classifySanityViolationKind', () => {
  it('SECTOR_PCT_BOUND_EXCEEDED — sector pct > 30', () => {
    expect(classifySanityViolationKind({ scope: 'SECTOR', pct: 50, bound: 30 })).toBe('SECTOR_PCT_BOUND_EXCEEDED');
  });

  it('STOCK_VOLUME_PCT_CHANGE_EXCEEDED — stockVolume > 1000', () => {
    expect(classifySanityViolationKind({ scope: 'STOCK_VOLUME', pct: 1500, bound: 1000 })).toBe('STOCK_VOLUME_PCT_CHANGE_EXCEEDED');
  });

  it('STOCK_RETURN_PCT_CHANGE_EXCEEDED — stockReturn > 90', () => {
    expect(classifySanityViolationKind({ scope: 'STOCK_RETURN', pct: 95, bound: 90 })).toBe('STOCK_RETURN_PCT_CHANGE_EXCEEDED');
  });

  it('BASE_ZERO_OR_TINY — base ≤ 1.0 (BASE_TINY_THRESHOLD)', () => {
    expect(classifySanityViolationKind({ scope: 'STOCK_RETURN', pct: 50, bound: 90, base: 0 })).toBe('BASE_ZERO_OR_TINY');
    expect(classifySanityViolationKind({ scope: 'STOCK_RETURN', pct: 50, bound: 90, base: 0.5 })).toBe('BASE_ZERO_OR_TINY');
  });

  it('CURRENT_OUTLIER — NaN/Infinity current', () => {
    expect(classifySanityViolationKind({ scope: 'SECTOR', pct: 50, bound: 30, current: NaN })).toBe('CURRENT_OUTLIER');
    expect(classifySanityViolationKind({ scope: 'SECTOR', pct: 50, bound: 30, current: Infinity })).toBe('CURRENT_OUTLIER');
    expect(classifySanityViolationKind({ scope: 'SECTOR', pct: NaN, bound: 30 })).toBe('CURRENT_OUTLIER');
  });

  it('UNKNOWN — pct 정상 + bound 미초과', () => {
    expect(classifySanityViolationKind({ scope: 'SECTOR', pct: 10, bound: 30 })).toBe('UNKNOWN');
  });

  it('SECTOR_ENERGY_SANITY_THRESHOLDS — 사용자 §"진단 원칙" + ADR-0370 정합', () => {
    expect(SECTOR_ENERGY_SANITY_THRESHOLDS.SECTOR_RETURN_BOUND_PCT).toBe(30);
    expect(SECTOR_ENERGY_SANITY_THRESHOLDS.SECTOR_VOLUME_BOUND_PCT).toBe(1000);
    expect(SECTOR_ENERGY_SANITY_THRESHOLDS.STOCK_RETURN_BOUND_PCT).toBe(90);
    expect(SECTOR_ENERGY_SANITY_THRESHOLDS.BLOCKED_STOCK_RETURN_COUNT).toBe(5);
    expect(SECTOR_ENERGY_SANITY_THRESHOLDS.BLOCKED_STOCK_VOLUME_COUNT).toBe(5);
    expect(SECTOR_ENERGY_SANITY_THRESHOLDS.BLOCKED_BASE_TINY_COUNT).toBe(3);
  });
});

// ===========================================================================
// §7. recordSanityViolation + finalizeSanityDiagnostic
// ===========================================================================

describe('ADR-0446 §7. recordSanityViolation + finalizeSanityDiagnostic', () => {
  it('빈 state → totalViolations=0 + confidenceImpact=NONE', () => {
    const state = createSanityViolationState();
    const d = finalizeSanityDiagnostic(state);
    expect(d.totalViolations).toBe(0);
    expect(d.confidenceImpact).toBe('NONE');
  });

  it('sector pct violation 1건 → DEGRADED (사용자 §"진단 원칙")', () => {
    const state = createSanityViolationState();
    recordSanityViolation(state, {
      kind: 'SECTOR_PCT_BOUND_EXCEEDED',
      scope: 'SECTOR',
      pct: 60,
      bound: 30,
      sector: '반도체',
    });
    const d = finalizeSanityDiagnostic(state);
    expect(d.totalViolations).toBe(1);
    expect(d.sectorPctViolations).toBe(1);
    expect(d.confidenceImpact).toBe('DEGRADED');
  });

  it('stockReturn 6건 → BLOCKED (BLOCKED_STOCK_RETURN_COUNT=5)', () => {
    const state = createSanityViolationState();
    for (let i = 0; i < 6; i++) {
      recordSanityViolation(state, {
        kind: 'STOCK_RETURN_PCT_CHANGE_EXCEEDED',
        scope: 'STOCK_RETURN',
        pct: 95,
        bound: 90,
        code: `${100000 + i}`,
      });
    }
    const d = finalizeSanityDiagnostic(state);
    expect(d.confidenceImpact).toBe('BLOCKED');
    expect(d.stockReturnViolations).toBe(6);
  });

  it('stockVolume 6건 → BLOCKED', () => {
    const state = createSanityViolationState();
    for (let i = 0; i < 6; i++) {
      recordSanityViolation(state, {
        kind: 'STOCK_VOLUME_PCT_CHANGE_EXCEEDED',
        scope: 'STOCK_VOLUME',
        pct: 1500,
        bound: 1000,
        code: `${100000 + i}`,
      });
    }
    const d = finalizeSanityDiagnostic(state);
    expect(d.confidenceImpact).toBe('BLOCKED');
  });

  it('baseZeroOrTiny 4건 → BLOCKED (BLOCKED_BASE_TINY_COUNT=3)', () => {
    const state = createSanityViolationState();
    for (let i = 0; i < 4; i++) {
      recordSanityViolation(state, {
        kind: 'BASE_ZERO_OR_TINY',
        scope: 'STOCK_RETURN',
        pct: 0,
        bound: 90,
        code: `${100000 + i}`,
        base: 0,
      });
    }
    const d = finalizeSanityDiagnostic(state);
    expect(d.confidenceImpact).toBe('BLOCKED');
    expect(d.baseZeroOrTinyCount).toBe(4);
  });

  it('STOCK_DAILY sourceTier 1건 → stockDailyTaintedMarker=true + BLOCKED', () => {
    const state = createSanityViolationState();
    recordSanityViolation(state, {
      kind: 'SECTOR_PCT_BOUND_EXCEEDED',
      scope: 'SECTOR',
      pct: 60,
      bound: 30,
      sector: '반도체',
      sourceTier: 'STOCK_DAILY',
    });
    const d = finalizeSanityDiagnostic(state);
    expect(d.stockDailyTaintedMarker).toBe(true);
    expect(d.confidenceImpact).toBe('BLOCKED'); // STOCK_DAILY tainted → BLOCKED
  });

  it('topViolatingSectors 정렬 — |pct| desc', () => {
    const state = createSanityViolationState();
    recordSanityViolation(state, { kind: 'SECTOR_PCT_BOUND_EXCEEDED', scope: 'SECTOR', pct: 50, bound: 30, sector: '반도체' });
    recordSanityViolation(state, { kind: 'SECTOR_PCT_BOUND_EXCEEDED', scope: 'SECTOR', pct: 100, bound: 30, sector: '바이오' });
    recordSanityViolation(state, { kind: 'SECTOR_PCT_BOUND_EXCEEDED', scope: 'SECTOR', pct: -80, bound: 30, sector: '금융' });
    const d = finalizeSanityDiagnostic(state);
    expect(d.topViolatingSectors[0]!.sector).toBe('바이오');
    expect(Math.abs(d.topViolatingSectors[1]!.pct)).toBe(80);
  });

  it('topViolatingStocks 정렬 — |pct| desc', () => {
    const state = createSanityViolationState();
    recordSanityViolation(state, { kind: 'STOCK_RETURN_PCT_CHANGE_EXCEEDED', scope: 'STOCK_RETURN', pct: 95, bound: 90, code: '111111' });
    recordSanityViolation(state, { kind: 'STOCK_RETURN_PCT_CHANGE_EXCEEDED', scope: 'STOCK_RETURN', pct: -120, bound: 90, code: '222222' });
    const d = finalizeSanityDiagnostic(state);
    expect(d.topViolatingStocks[0]!.code).toBe('222222');
  });

  it('sourceTierBreakdown 합 = totalViolations', () => {
    const state = createSanityViolationState();
    for (let i = 0; i < 3; i++) {
      recordSanityViolation(state, {
        kind: 'SECTOR_PCT_BOUND_EXCEEDED',
        scope: 'SECTOR',
        pct: 60,
        bound: 30,
        sector: '반도체',
        sourceTier: 'KRX_CODE',
      });
    }
    recordSanityViolation(state, {
      kind: 'STOCK_RETURN_PCT_CHANGE_EXCEEDED',
      scope: 'STOCK_RETURN',
      pct: 95,
      bound: 90,
      code: '111111',
      sourceTier: 'STOCK_DAILY',
    });
    const d = finalizeSanityDiagnostic(state);
    const total = (Object.values(d.sourceTierBreakdown) as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBe(d.totalViolations);
  });

  it('절대 불변식 — sanity 발생 시 NONE 절대 반환 금지', () => {
    const state = createSanityViolationState();
    recordSanityViolation(state, {
      kind: 'SECTOR_PCT_BOUND_EXCEEDED',
      scope: 'SECTOR',
      pct: 35,
      bound: 30,
      sector: '반도체',
    });
    const d = finalizeSanityDiagnostic(state);
    expect(d.confidenceImpact).not.toBe('NONE');
  });

  it('ENV disabled 시 recordSanityViolation 무시', () => {
    process.env.SECTOR_ENERGY_SANITY_DIAGNOSTIC_DISABLED = 'true';
    try {
      const state = createSanityViolationState();
      recordSanityViolation(state, {
        kind: 'SECTOR_PCT_BOUND_EXCEEDED',
        scope: 'SECTOR',
        pct: 60,
        bound: 30,
        sector: '반도체',
      });
      expect(state.violations.length).toBe(0);
    } finally {
      delete process.env.SECTOR_ENERGY_SANITY_DIAGNOSTIC_DISABLED;
    }
  });
});

// ===========================================================================
// §8. deriveConfidenceImpact 결정 트리
// ===========================================================================

describe('ADR-0446 §8. deriveConfidenceImpact', () => {
  it('totalViolations=0 → NONE', () => {
    expect(deriveConfidenceImpact({
      totalViolations: 0,
      stockReturnViolations: 0,
      stockVolumeViolations: 0,
      baseZeroOrTinyCount: 0,
      stockDailyTaintedMarker: false,
    })).toBe('NONE');
  });

  it('1 sector pct → DEGRADED', () => {
    expect(deriveConfidenceImpact({
      totalViolations: 1,
      stockReturnViolations: 0,
      stockVolumeViolations: 0,
      baseZeroOrTinyCount: 0,
      stockDailyTaintedMarker: false,
    })).toBe('DEGRADED');
  });

  it('stockReturn 5 → DEGRADED (boundary, > 5 만 BLOCKED)', () => {
    expect(deriveConfidenceImpact({
      totalViolations: 5,
      stockReturnViolations: 5,
      stockVolumeViolations: 0,
      baseZeroOrTinyCount: 0,
      stockDailyTaintedMarker: false,
    })).toBe('DEGRADED');
  });

  it('stockReturn 6 → BLOCKED', () => {
    expect(deriveConfidenceImpact({
      totalViolations: 6,
      stockReturnViolations: 6,
      stockVolumeViolations: 0,
      baseZeroOrTinyCount: 0,
      stockDailyTaintedMarker: false,
    })).toBe('BLOCKED');
  });

  it('stockDailyTaintedMarker=true → BLOCKED', () => {
    expect(deriveConfidenceImpact({
      totalViolations: 1,
      stockReturnViolations: 0,
      stockVolumeViolations: 0,
      baseZeroOrTinyCount: 0,
      stockDailyTaintedMarker: true,
    })).toBe('BLOCKED');
  });
});

// ===========================================================================
// §9. formatSanityDiagnosticSection / CompactLine
// ===========================================================================

describe('ADR-0446 §9. Sanity formatters + HTML safety', () => {
  it('formatSanityDiagnosticSection — 0 violations → totalViolations: 0 라인', () => {
    const state = createSanityViolationState();
    const d = finalizeSanityDiagnostic(state);
    const out = formatSanityDiagnosticSection(d);
    expect(out).toContain('SectorEnergy Sanity');
    expect(out).toContain('totalViolations: 0');
    expect(out).toContain('NONE');
  });

  it('formatSanityDiagnosticSection — 운영 출력 기대값 (사용자 §"운영 출력 기대값")', () => {
    const state = createSanityViolationState();
    // 18 sector, 8 stockVolume, 5 stockReturn → total 31, BLOCKED
    for (let i = 0; i < 18; i++) {
      recordSanityViolation(state, { kind: 'SECTOR_PCT_BOUND_EXCEEDED', scope: 'SECTOR', pct: 50 + i, bound: 30, sector: `s${i}` });
    }
    for (let i = 0; i < 8; i++) {
      recordSanityViolation(state, { kind: 'STOCK_VOLUME_PCT_CHANGE_EXCEEDED', scope: 'STOCK_VOLUME', pct: 1500, bound: 1000, code: `1${i}1111` });
    }
    for (let i = 0; i < 5; i++) {
      recordSanityViolation(state, { kind: 'STOCK_RETURN_PCT_CHANGE_EXCEEDED', scope: 'STOCK_RETURN', pct: 95, bound: 90, code: `2${i}2222` });
    }
    const d = finalizeSanityDiagnostic(state);
    expect(d.totalViolations).toBe(31);
    expect(d.confidenceImpact).toBe('BLOCKED');
    const out = formatSanityDiagnosticSection(d);
    expect(out).toContain('totalViolations: 31');
    expect(out).toContain('sectorPct 18');
    expect(out).toContain('stockVolume 8');
    expect(out).toContain('stockReturn 5');
    expect(out).toContain('confidenceImpact: BLOCKED');
  });

  it('formatSanityDiagnosticCompactLine — 사용자 §"운영 출력 기대값" 형식', () => {
    const state = createSanityViolationState();
    recordSanityViolation(state, { kind: 'SECTOR_PCT_BOUND_EXCEEDED', scope: 'SECTOR', pct: 50, bound: 30, sector: '반도체' });
    const d = finalizeSanityDiagnostic(state);
    const out = formatSanityDiagnosticCompactLine(d);
    expect(out).toContain('Sanity 1건');
    expect(out).toContain('confidence DEGRADED');
  });

  it('escapeSanityHtml — `<` `>` `&` 차단', () => {
    expect(escapeSanityHtml('<bad>&"a"')).toContain('&lt;');
    expect(escapeSanityHtml('a&b<c>d')).toBe('a&amp;b&lt;c&gt;d');
  });

  it('formatSanityDiagnosticSection — sector 이름 escape', () => {
    const state = createSanityViolationState();
    recordSanityViolation(state, { kind: 'SECTOR_PCT_BOUND_EXCEEDED', scope: 'SECTOR', pct: 60, bound: 30, sector: '<bad>' });
    const d = finalizeSanityDiagnostic(state);
    const out = formatSanityDiagnosticSection(d);
    expect(out).not.toMatch(/<bad>(?![a-z])/);
    expect(out).toMatch(/&lt;bad&gt;/);
  });

  it('CompactLine — 0 violations → "Sanity OK (0건)"', () => {
    const state = createSanityViolationState();
    const d = finalizeSanityDiagnostic(state);
    expect(formatSanityDiagnosticCompactLine(d)).toBe('Sanity OK (0건)');
  });
});

// ===========================================================================
// §10. 정적 grep — 절대 불변식 (KIS 주문 함수 import 0 등)
// ===========================================================================

describe('ADR-0446 §10. 정적 grep 가드 (절대 불변식)', () => {
  const recoverySrc = readFileSync(
    join(__dirname, 'sectorEnergyIndexCodeRecoveryDiagnostic.ts'),
    'utf8',
  );
  const sanitySrc = readFileSync(
    join(__dirname, 'sectorEnergySanityViolationDiagnostic.ts'),
    'utf8',
  );

  // 코드 본체만 검사 (주석/문서 제외)
  function moduleCode(raw: string): string {
    return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }
  const recoveryCode = moduleCode(recoverySrc);
  const sanityCode = moduleCode(sanitySrc);

  it('KIS 주문 함수 5종 import 0건', () => {
    const kisOrderFns = [
      'placeKisMarketBuyOrder',
      'placeKisMarketSellOrder',
      'placeKisLimitBuyOrder',
      'placeKisLimitSellOrder',
      'cancelKisOrder',
    ];
    for (const fn of kisOrderFns) {
      expect(recoveryCode).not.toContain(fn);
      expect(sanityCode).not.toContain(fn);
    }
  });

  it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    for (const m of ['autoTradeEngine', 'orderExecutor', 'trancheExecutor']) {
      expect(recoveryCode).not.toContain(m);
      expect(sanityCode).not.toContain(m);
    }
  });

  it('Gate threshold + condition weight + STRONG_BUY 변경 0건', () => {
    for (const t of ['setGateThreshold', 'GATE_RELAX', 'STRONG_BUY_OVERRIDE', 'condition_weight']) {
      expect(recoveryCode).not.toContain(t);
      expect(sanityCode).not.toContain(t);
    }
  });

  it('SELL_ONLY 해제 + sanity violation clamp 후 OK 0건 (절대 불변식)', () => {
    expect(recoveryCode).not.toMatch(/sanity[^a-z]*clamp[^a-z]*ok/i);
    expect(sanityCode).not.toMatch(/sanity[^a-z]*clamp[^a-z]*ok/i);
    expect(recoveryCode).not.toContain('disable_sell_only');
    expect(sanityCode).not.toContain('disable_sell_only');
  });

  it('외부 API 호출 0건 (fetch / axios / node-fetch / kisClient direct)', () => {
    for (const t of ['await fetch(', 'axios.get(', 'axios.post(', 'node-fetch']) {
      expect(recoveryCode).not.toContain(t);
      expect(sanityCode).not.toContain(t);
    }
  });

  it('SECTOR_ENERGY_RECOVERY_PHASE2_THRESHOLDS Object.freeze drift 가드', () => {
    expect(SECTOR_ENERGY_RECOVERY_PHASE2_THRESHOLDS.RECOVERED_COVERAGE_MIN).toBe(0.8);
    expect(Object.isFrozen(SECTOR_ENERGY_RECOVERY_PHASE2_THRESHOLDS)).toBe(true);
  });

  it('SECTOR_ENERGY_SANITY_THRESHOLDS Object.freeze drift 가드', () => {
    expect(Object.isFrozen(SECTOR_ENERGY_SANITY_THRESHOLDS)).toBe(true);
  });
});

// ===========================================================================
// §11. 운영 시나리오 — 사용자 §"운영 출력 기대값" 정합
// ===========================================================================

describe('ADR-0446 §11. 운영 시나리오 (사용자 §"운영 출력 기대값")', () => {
  it('beforeCoverage 18.7% → afterCoverage 42.5% 시나리오', () => {
    // 91 rows, 17 with code (~18.7%) before, 39 after backfill (~42.5%)
    const before: RecoveryRowInput[] = [];
    const after: RecoveryRowInput[] = [];
    for (let i = 0; i < 91; i++) {
      before.push(makeIndexRow({
        indexCode: i < 17 ? `c${i}` : null,
        indexName: `idx${i}`,
      }));
      after.push(makeIndexRow({
        indexCode: i < 39 ? `c${i}` : null,
        indexName: `idx${i}`,
        indexCodeSource: i < 17 ? 'RAW' : i < 39 ? 'NAME_LOOKUP' : null,
      }));
    }
    const r = evaluateIndexCodeRecovery({
      rowsBeforeBackfill: before,
      rowsAfterBackfill: after,
      fallbackUsed: 'STOCK_DAILY', // 사용자 명시 결과 PARTIAL → BLOCKED leadership
      symmetryValidationPassed: false,
      sanityViolationCount: 0,
    });
    expect(r.beforeIndexCodeCoverage).toBeGreaterThan(0.18);
    expect(r.beforeIndexCodeCoverage).toBeLessThan(0.20);
    expect(r.afterIndexCodeCoverage).toBeGreaterThan(0.42);
    expect(r.afterIndexCodeCoverage).toBeLessThan(0.43);
    expect(r.backfilledByNameLookup).toBe(22); // 39 - 17
    expect(r.recoveryStatus).toBe('PARTIAL');
    expect(r.leadershipConfidence).toBe('BLOCKED'); // fallback STOCK_DAILY
  });

  it('Sanity 31건 (18+8+5) → BLOCKED + operatorAction', () => {
    const state = createSanityViolationState();
    for (let i = 0; i < 18; i++) {
      recordSanityViolation(state, { kind: 'SECTOR_PCT_BOUND_EXCEEDED', scope: 'SECTOR', pct: 50, bound: 30, sector: `s${i}` });
    }
    for (let i = 0; i < 8; i++) {
      recordSanityViolation(state, { kind: 'STOCK_VOLUME_PCT_CHANGE_EXCEEDED', scope: 'STOCK_VOLUME', pct: 1500, bound: 1000, code: `${100000 + i}` });
    }
    for (let i = 0; i < 5; i++) {
      recordSanityViolation(state, { kind: 'STOCK_RETURN_PCT_CHANGE_EXCEEDED', scope: 'STOCK_RETURN', pct: 95, bound: 90, code: `${200000 + i}` });
    }
    const d = finalizeSanityDiagnostic(state);
    expect(d.totalViolations).toBe(31);
    expect(d.sectorPctViolations).toBe(18);
    expect(d.stockVolumeViolations).toBe(8);
    expect(d.stockReturnViolations).toBe(5);
    expect(d.confidenceImpact).toBe('BLOCKED');
    const section = formatSanityDiagnosticSection(d);
    expect(section).toContain('operatorAction');
  });
});
