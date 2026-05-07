/**
 * @responsibility ADR-0424 회귀 — SectorEnergy indexCode provider/cache repair
 *
 * 사용자 §J 명시 11 케이스 + ADR 본문 정합 가드.
 *
 * 핵심 불변식 (사용자 명시 — 본 테스트가 영구 보호):
 *   1. indexCodeCoverage 0.0% 를 억지로 OK/PARTIAL 로 바꾸지 않는다.
 *   2. STOCK_DAILY fallback 을 정상 sector-index leadership source 로 승격하지 않는다.
 *   3. SectorEnergy STALE 은 true no-leadership 이 아니다.
 *   4. provider/cache/schema/mapping 문제와 실제 섹터 리더십 부재를 분리한다.
 *   5. Gate2 완화보다 sector indexCode provider/cache 복구가 먼저다.
 *   6. Gate threshold / weight / 매매 정책 절대 변경 금지.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  resolveIndexCodeBySectorName,
  isSectorIndexCodeBackfillDisabled,
} from './sectorEnergyMaster.js';
import {
  backfillIndexCodes,
  validateIndexResponseSymmetry,
  type SymmetryValidationResult,
} from './sectorEnergyProvider.js';
import type { KrxIndexDailyRow } from './krxOpenApi.js';
import {
  classifyRepairStatus,
  evaluateSectorEnergyQualityDiagnostic,
  formatSectorEnergyQualityDiagnosticSection,
} from './sectorEnergyQualityDiagnostic.js';

function makeRow(indexName: string, indexCode: string, baseDate = '20260507'): KrxIndexDailyRow {
  return {
    baseDate,
    indexCode,
    indexName,
    close: 100,
    change: 1,
    changePct: 1,
    open: 99,
    high: 101,
    low: 98,
    volume: 1000,
    value: 100000,
    marketCap: 1_000_000,
  };
}

describe('ADR-0424 §J 사용자 명시 11 케이스', () => {
  it('1. provider row 에 indexCode 가 있으면 coverage 가 0 이 아니다', () => {
    const todayRows: KrxIndexDailyRow[] = [
      makeRow('반도체', '1KSI3032'),
      makeRow('이차전지', '1KSI3035'),
      makeRow('금융', '1KSI3015'),
    ];
    const sym = validateIndexResponseSymmetry(todayRows, todayRows);
    expect(sym.todayCodeFillRatio).toBe(1);
    expect(sym.todayRowsTotal).toBe(3);
    expect(sym.todayRowsWithIndexCode).toBe(3);
  });

  it('2. backfill 후 indexCode 유지 — NAME_LOOKUP source 표시', () => {
    const rows: KrxIndexDailyRow[] = [
      makeRow('반도체', ''), // 비어 있음 → backfill 대상
      makeRow('금융', '1KSI3015'), // 이미 채워짐
    ];
    const result = backfillIndexCodes(rows);
    expect(result.backfilledCount).toBe(1);
    expect(result.rows[0].indexCode).not.toBe(''); // 회복됨
    expect(result.rows[0].indexCodeSource).toBe('NAME_LOOKUP');
    expect(result.rows[1].indexCode).toBe('1KSI3015'); // 변경 없음
    expect(result.rows[1].indexCodeSource).toBe('RAW');
  });

  it('3. STOCK_DAILY fallback 만 있으면 OK 가 아니다 (사용자 §E 정합)', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 11,
      totalSectorRows: 12,
      rowsWithIndexCode: 0, // STOCK_DAILY 입력은 indexCode 부재
      symmetryValidationPassed: false,
      fallbackUsed: 'STOCK_DAILY',
      sourceTier: 'STOCK_DAILY',
    });
    expect(diag.dataQuality).not.toBe('OK');
    expect(diag.shouldBlockLeadershipConfidence).toBe(true);
    expect(diag.repairStatus).toBe('STILL_STALE');
  });

  it('4. validSectorCount 11/12 + indexCodeCoverage=0 → STALE + INDEX_CODE_COVERAGE_ZERO', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 11,
      totalSectorRows: 12,
      rowsWithIndexCode: 0,
      symmetryValidationPassed: false,
    });
    expect(diag.dataQuality).toBe('STALE');
    expect(diag.reasons).toContain('INDEX_CODE_COVERAGE_ZERO');
  });

  it('5. symmetryValidation 이 indexCode 필드를 정확히 카운트', () => {
    const todayRows: KrxIndexDailyRow[] = [
      makeRow('반도체', '1KSI3032'),
      makeRow('이차전지', '1KSI3035'),
      makeRow('금융', ''), // indexCode 없음
    ];
    const sym = validateIndexResponseSymmetry(todayRows, todayRows);
    expect(sym.todayRowsWithIndexCode).toBe(2);
    expect(sym.todayRowsTotal).toBe(3);
  });

  it('6. indexCodeCoverage>=0.8 + symmetry pass + fallback NONE → PARTIAL/OK 가능', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12,
      symmetryValidationPassed: true,
      fallbackUsed: 'NONE',
    });
    expect(diag.dataQuality).toBe('OK');
    expect(diag.shouldBlockLeadershipConfidence).toBe(false);
  });

  it('7. cache fresh 라도 indexCodeCoverage=0 → OK 금지', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 0,
      symmetryValidationPassed: true,
      fallbackUsed: 'CACHE',
      cacheAgeMs: 60_000, // 1분 — fresh
    });
    expect(diag.dataQuality).not.toBe('OK');
    expect(diag.shouldBlockLeadershipConfidence).toBe(true);
  });

  it('8. sourceTier 선택 우선순위 — backfill 만으로 STOCK_DAILY 회피 가능', () => {
    // ADR-0424 시나리오: KRX 가 IDX_IND_CD 누락 → backfill → symmetry pass → STOCK_DAILY fallback 미진입.
    // backfill 없이는 fallback 됐을 시나리오를 backfill 로 회피하는 정합성 검증.
    const rawRows: KrxIndexDailyRow[] = [
      makeRow('반도체', ''), // KRX 결손
      makeRow('금융', ''), // KRX 결손
      makeRow('이차전지', ''), // KRX 결손
    ];
    const symBeforeBackfill = validateIndexResponseSymmetry(rawRows, rawRows);
    expect(symBeforeBackfill.valid).toBe(false); // raw 상태면 fail
    expect(symBeforeBackfill.todayCodeFillRatio).toBe(0);

    const backfilled = backfillIndexCodes(rawRows);
    expect(backfilled.backfilledCount).toBe(3);
    const symAfterBackfill = validateIndexResponseSymmetry(backfilled.rows, backfilled.rows);
    expect(symAfterBackfill.valid).toBe(true); // backfill 후 pass
    expect(symAfterBackfill.todayCodeFillRatio).toBe(1);
  });

  it('9. /sector_energy_diag formatter 가 ADR-0424 블록 표시', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12,
      symmetryValidationPassed: true,
      fallbackUsed: 'NONE',
      sourceTier: 'KRX_CODE',
      indexCodeBackfilledCount: 5, // backfill 발생
    });
    const section = formatSectorEnergyQualityDiagnosticSection(diag);
    expect(section).not.toBeNull();
    expect(section).toContain('indexCodeBackfilledCount: 5');
    expect(section).toContain('NAME_LOOKUP');
    expect(section).toContain('repairStatus: RECOVERED');
    expect(section).toContain('operatorAction');
  });

  it('10. /scan_blockers 가 SectorEnergy repaired state 반영 — RECOVERED 시 leadership BLOCKED 아님', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12, // backfill 후 100%
      symmetryValidationPassed: true,
      fallbackUsed: 'NONE',
      sourceTier: 'KRX_CODE',
      indexCodeBackfilledCount: 8,
    });
    expect(diag.dataQuality).toBe('OK');
    expect(diag.shouldBlockLeadershipConfidence).toBe(false);
    expect(diag.repairStatus).toBe('RECOVERED');
    // ADR-0422 SECTOR_DATA_STALE_DOMINANT 가 더 이상 강제되지 않음 — isStale 입력으로 false 전달.
  });

  it('11. 회귀 안전 가드 — Gate threshold / scoring formula / KIS order 변경 0', () => {
    const providerSrc = readFileSync('server/clients/sectorEnergyProvider.ts', 'utf8');
    const masterSrc = readFileSync('server/clients/sectorEnergyMaster.ts', 'utf8');
    const diagSrc = readFileSync('server/clients/sectorEnergyQualityDiagnostic.ts', 'utf8');

    // Gate threshold 변경 0
    for (const src of [providerSrc, masterSrc, diagSrc]) {
      expect(src).not.toMatch(/setGateThreshold|setMinGateScore|MIN_GATE.*=.*[0-9]/);
    }
    // scoring formula 변경 0 (sectorEnergy point/score formula 미터치)
    expect(providerSrc).not.toMatch(/setSectorScore|sectorScoreFormula\s*=/);
    // STOCK_DAILY 를 OK 로 강제 0
    expect(diagSrc).not.toMatch(/STOCK_DAILY[\s\S]{0,80}=\s*'OK'/);
    // KIS order path 변경 0 (provider 가 placeKisOrder 호출 0)
    expect(providerSrc).not.toMatch(/placeKisOrder|placeKisMarketBuyOrder|placeKisSellOrder/);
    expect(masterSrc).not.toMatch(/placeKisOrder|placeKisMarketBuyOrder|placeKisSellOrder/);
  });
});

describe('ADR-0424 SECTOR_INDEX_MASTER 역변환 SSOT', () => {
  it('resolveIndexCodeBySectorName — alias 매칭', () => {
    expect(resolveIndexCodeBySectorName('반도체')).toBeTruthy();
    expect(resolveIndexCodeBySectorName('금융')).toBeTruthy();
    expect(resolveIndexCodeBySectorName('이차전지')).toBeTruthy();
  });

  it('resolveIndexCodeBySectorName — 빈/null/공백 안전 fallback', () => {
    expect(resolveIndexCodeBySectorName('')).toBeNull();
    expect(resolveIndexCodeBySectorName(null)).toBeNull();
    expect(resolveIndexCodeBySectorName(undefined)).toBeNull();
    expect(resolveIndexCodeBySectorName('   ')).toBeNull();
    expect(resolveIndexCodeBySectorName('알 수 없는 섹터명')).toBeNull();
  });

  it('isSectorIndexCodeBackfillDisabled — ENV 정확 비교 (ADR-0157)', () => {
    const original = process.env.SECTOR_INDEX_CODE_BACKFILL_DISABLED;
    try {
      delete process.env.SECTOR_INDEX_CODE_BACKFILL_DISABLED;
      expect(isSectorIndexCodeBackfillDisabled()).toBe(false);
      process.env.SECTOR_INDEX_CODE_BACKFILL_DISABLED = 'true';
      expect(isSectorIndexCodeBackfillDisabled()).toBe(true);
      // truthy 거부 (ADR-0157 정확 비교)
      process.env.SECTOR_INDEX_CODE_BACKFILL_DISABLED = '1';
      expect(isSectorIndexCodeBackfillDisabled()).toBe(false);
      process.env.SECTOR_INDEX_CODE_BACKFILL_DISABLED = 'TRUE';
      expect(isSectorIndexCodeBackfillDisabled()).toBe(false);
    } finally {
      if (original === undefined) {
        delete process.env.SECTOR_INDEX_CODE_BACKFILL_DISABLED;
      } else {
        process.env.SECTOR_INDEX_CODE_BACKFILL_DISABLED = original;
      }
    }
  });
});

describe('ADR-0424 backfillIndexCodes 결정 트리', () => {
  it('빈 입력 → 빈 결과', () => {
    expect(backfillIndexCodes([])).toEqual({ rows: [], backfilledCount: 0 });
  });

  it('모두 채워진 입력 → backfill 0건 + RAW source 표시', () => {
    const rows: KrxIndexDailyRow[] = [
      makeRow('반도체', '1KSI3032'),
      makeRow('금융', '1KSI3015'),
    ];
    const result = backfillIndexCodes(rows);
    expect(result.backfilledCount).toBe(0);
    expect(result.rows[0].indexCodeSource).toBe('RAW');
    expect(result.rows[1].indexCodeSource).toBe('RAW');
  });

  it('일부 비어있음 → 매칭되는 것만 backfill', () => {
    const rows: KrxIndexDailyRow[] = [
      makeRow('반도체', ''), // 매칭됨
      makeRow('알 수 없는 섹터', ''), // 매칭 안 됨
      makeRow('금융', '1KSI3015'), // 이미 채워짐
    ];
    const result = backfillIndexCodes(rows);
    expect(result.backfilledCount).toBe(1);
    expect(result.rows[0].indexCode).not.toBe('');
    expect(result.rows[0].indexCodeSource).toBe('NAME_LOOKUP');
    expect(result.rows[1].indexCode).toBe(''); // 매칭 실패 → 보존
    expect(result.rows[1].indexCodeSource).toBeUndefined();
    expect(result.rows[2].indexCodeSource).toBe('RAW');
  });

  it('ENV 비활성 시 입력 그대로 반환', () => {
    const original = process.env.SECTOR_INDEX_CODE_BACKFILL_DISABLED;
    try {
      process.env.SECTOR_INDEX_CODE_BACKFILL_DISABLED = 'true';
      const rows: KrxIndexDailyRow[] = [makeRow('반도체', '')];
      const result = backfillIndexCodes(rows);
      expect(result.backfilledCount).toBe(0);
      expect(result.rows[0].indexCode).toBe(''); // 변경 없음
      expect(result.rows[0].indexCodeSource).toBeUndefined();
    } finally {
      if (original === undefined) {
        delete process.env.SECTOR_INDEX_CODE_BACKFILL_DISABLED;
      } else {
        process.env.SECTOR_INDEX_CODE_BACKFILL_DISABLED = original;
      }
    }
  });

  it('symmetry validation 결과에 backfilledCount 첨부', () => {
    // backfill 없이 raw symmetry 검증
    const raw: KrxIndexDailyRow[] = [makeRow('반도체', '1KSI3032')];
    const symRaw = validateIndexResponseSymmetry(raw, raw);
    expect(symRaw.backfilledCount).toBeUndefined(); // 본 함수는 backfill stats 자체는 caller 측 합성
    expect(symRaw.todayRowsWithIndexCode).toBe(1);
  });
});

describe('ADR-0424 classifyRepairStatus SSOT 결정 트리', () => {
  it('NOT_NEEDED — fallback NONE + OK + backfilled 0', () => {
    const status = classifyRepairStatus('OK', 1.0, true, 'NONE', 0);
    expect(status).toBe('NOT_NEEDED');
  });

  it('RECOVERED — fallback NONE + symmetry pass + coverage>=0.8 + backfilled>0', () => {
    const status = classifyRepairStatus('OK', 1.0, true, 'NONE', 5);
    expect(status).toBe('RECOVERED');
  });

  it('PARTIAL — coverage>0 + fallback 활성', () => {
    const status = classifyRepairStatus('PARTIAL', 0.5, true, 'STOCK_DAILY', 0);
    expect(status).toBe('PARTIAL');
  });

  it('PARTIAL — coverage>0 + symmetry 미통과', () => {
    const status = classifyRepairStatus('STALE', 0.5, false, 'NONE', 0);
    expect(status).toBe('PARTIAL');
  });

  it('STILL_STALE — coverage=0', () => {
    const status = classifyRepairStatus('STALE', 0, false, 'STOCK_DAILY', 0);
    expect(status).toBe('STILL_STALE');
  });

  it('STILL_STALE — FAILED', () => {
    const status = classifyRepairStatus('FAILED', 0, false, 'NONE', 0);
    expect(status).toBe('STILL_STALE');
  });

  it('NOT_NEEDED 절대 RECOVERED 변경 0 — fallback 활성 시', () => {
    // 사용자 §H — fallback 활성 시 RECOVERED 절대 금지.
    const status = classifyRepairStatus('PARTIAL', 1.0, true, 'STOCK_DAILY', 5);
    expect(status).not.toBe('RECOVERED');
    expect(status).toBe('PARTIAL');
  });
});

describe('ADR-0424 wiring 정적 가드', () => {
  it('sectorEnergyProvider 가 backfillIndexCodes 진입점에서 호출', () => {
    const src = readFileSync('server/clients/sectorEnergyProvider.ts', 'utf8');
    expect(src).toMatch(/backfillIndexCodes/);
    // symmetry validation 호출 *전* 에 backfill 적용
    const backfillIdx = src.indexOf('backfillIndexCodes(todayIdx)');
    const symmetryIdx = src.indexOf('validateIndexResponseSymmetry(todayIdxBackfilled');
    expect(backfillIdx).toBeGreaterThan(0);
    expect(symmetryIdx).toBeGreaterThan(backfillIdx);
  });

  it('aggregateIndexDeltas 도 backfilled rows 사용', () => {
    const src = readFileSync('server/clients/sectorEnergyProvider.ts', 'utf8');
    // 모든 aggregateIndexDeltas 호출이 backfilled rows 사용
    const matches = src.match(/aggregateIndexDeltas\(todayIdx[^B]/g);
    expect(matches).toBeNull(); // 비-backfilled 사용 0건
    expect(src).toMatch(/aggregateIndexDeltas\(todayIdxBackfilled,\s*pastIdxBackfilled\)/);
  });

  it('SymmetryValidationResult.backfilledCount 옵셔널 필드 존재', () => {
    const src = readFileSync('server/clients/sectorEnergyProvider.ts', 'utf8');
    expect(src).toMatch(/backfilledCount\?:\s*number/);
  });

  it('SectorEnergyQualityDiagnostic 가 indexCodeBackfilledCount + repairStatus 옵셔널 필드 보유', () => {
    const src = readFileSync('server/clients/sectorEnergyQualityDiagnostic.ts', 'utf8');
    expect(src).toMatch(/indexCodeBackfilledCount\?:\s*number/);
    expect(src).toMatch(/repairStatus\?:\s*'RECOVERED'/);
  });

  it('macroState schema 에 ADR-0424 신규 필드 영속', () => {
    const src = readFileSync('server/persistence/macroStateRepo.ts', 'utf8');
    expect(src).toMatch(/indexCodeBackfilledCount\?:\s*number/);
    expect(src).toMatch(/repairStatus\?:\s*'RECOVERED'/);
  });

  it('formatter 가 backfilledCount + repairStatus 표시', () => {
    const src = readFileSync('server/clients/sectorEnergyQualityDiagnostic.ts', 'utf8');
    expect(src).toMatch(/indexCodeBackfilledCount/);
    expect(src).toMatch(/repairStatus/);
    expect(src).toMatch(/NAME_LOOKUP/);
  });
});

describe('ADR-0424 안전 invariant — STOCK_DAILY 승격 절대 금지', () => {
  it('STOCK_DAILY fallback + backfill 5건 → 여전히 PARTIAL (RECOVERED 아님)', () => {
    // 사용자 §H 핵심 — STOCK_DAILY fallback 은 backfill 이 발생해도 RECOVERED 격상 금지.
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 11,
      totalSectorRows: 12,
      rowsWithIndexCode: 12, // STOCK_DAILY 도 STATIC_MAP 등으로 backfill 가능 (가상 시나리오)
      symmetryValidationPassed: true,
      fallbackUsed: 'STOCK_DAILY',
      sourceTier: 'STOCK_DAILY',
      indexCodeBackfilledCount: 5,
    });
    // STOCK_DAILY fallback 은 ADR-0423 결정 트리 §C-5 에 의해 PARTIAL 강제.
    expect(diag.dataQuality).toBe('PARTIAL');
    // RECOVERED 절대 금지 (사용자 §H).
    expect(diag.repairStatus).not.toBe('RECOVERED');
    expect(diag.repairStatus).toBe('PARTIAL');
  });

  it('YAHOO_ETF fallback + backfill → PARTIAL 유지', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12,
      symmetryValidationPassed: true,
      fallbackUsed: 'ETF',
      sourceTier: 'YAHOO_ETF',
      indexCodeBackfilledCount: 12,
    });
    expect(diag.dataQuality).toBe('PARTIAL');
    expect(diag.repairStatus).not.toBe('RECOVERED');
  });

  it('CACHE fallback + backfill → PARTIAL + repairStatus=PARTIAL', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12,
      symmetryValidationPassed: true,
      fallbackUsed: 'CACHE',
      sourceTier: 'CACHE',
      indexCodeBackfilledCount: 3,
    });
    expect(diag.dataQuality).toBe('PARTIAL');
    expect(diag.repairStatus).toBe('PARTIAL');
  });
});

describe('ADR-0424 사용자 운영 시나리오 정합', () => {
  it('Before: sourceTier=STOCK_DAILY + coverage=0 + STALE → STILL_STALE + leadership BLOCKED', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 11,
      totalSectorRows: 12,
      rowsWithIndexCode: 0,
      symmetryValidationPassed: false,
      fallbackUsed: 'STOCK_DAILY',
      sourceTier: 'STOCK_DAILY',
    });
    expect(diag.dataQuality).toBe('STALE');
    expect(diag.indexCodeCoverage).toBe(0);
    expect(diag.shouldBlockLeadershipConfidence).toBe(true);
    expect(diag.repairStatus).toBe('STILL_STALE');
  });

  it('After: backfill 로 sourceTier=KRX_CODE + coverage=1 + symmetry pass → RECOVERED + leadership OK', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12, // backfill 로 회복
      symmetryValidationPassed: true,
      fallbackUsed: 'NONE', // backfill 후 fallback 미진입
      sourceTier: 'KRX_CODE',
      indexCodeBackfilledCount: 12,
    });
    expect(diag.dataQuality).toBe('OK');
    expect(diag.indexCodeCoverage).toBe(1);
    expect(diag.shouldBlockLeadershipConfidence).toBe(false);
    expect(diag.repairStatus).toBe('RECOVERED');
  });
});
