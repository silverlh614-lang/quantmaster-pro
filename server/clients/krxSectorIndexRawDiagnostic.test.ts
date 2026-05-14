/**
 * KRX-SECTOR-INDEXCODE-RAW-DIAGNOSTIC-001 회귀 — KRX 섹터 indexCode raw 입력 부검 SSOT.
 *
 * 진단 전용 — 매매 / scoring / Gate threshold 영향 0 검증.
 * evaluateKrxSectorIndexRawDiagnostic 결정 트리 first-match + log throttle + ENV gate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  evaluateKrxSectorIndexRawDiagnostic,
  formatKrxSectorIndexRawDiagnosticSection,
  formatKrxSectorIndexRawDiagnosticCompactLine,
  logKrxSectorIndexRawDiagnostic,
  isKrxSectorIndexRawDiagnosticDisabled,
  __resetKrxSectorIndexRawDiagnosticLogForTests,
  type EvaluateKrxSectorIndexRawInput,
} from './sectorEnergyIndexCodeRecoveryDiagnostic.js';

function makeInput(over: Partial<EvaluateKrxSectorIndexRawInput> = {}): EvaluateKrxSectorIndexRawInput {
  return {
    rawTodayRows: [],
    backfillInvoked: false,
    backfilledCount: 0,
    finalSourceTier: 'KRX_CODE',
    ...over,
  };
}

describe('KRX-SECTOR-INDEXCODE-RAW-DIAGNOSTIC-001 — evaluateKrxSectorIndexRawDiagnostic', () => {
  beforeEach(() => {
    __resetKrxSectorIndexRawDiagnosticLogForTests();
    delete process.env.KRX_SECTOR_INDEX_RAW_DIAGNOSTIC_DISABLED;
  });
  afterEach(() => {
    delete process.env.KRX_SECTOR_INDEX_RAW_DIAGNOSTIC_DISABLED;
  });

  // 1) KRX_ROWS_EMPTY
  it('totalRawRows === 0 → KRX_ROWS_EMPTY', () => {
    const diag = evaluateKrxSectorIndexRawDiagnostic(makeInput({ rawTodayRows: [] }));
    expect(diag.breakPoint).toBe('KRX_ROWS_EMPTY');
    expect(diag.totalRawRows).toBe(0);
    expect(diag.operatorHint).toContain('비어');
  });

  // 2) KRX_ROWS_HAVE_NO_INDEX_NAME
  it('row 있으나 indexCode + indexName 모두 부재 → KRX_ROWS_HAVE_NO_INDEX_NAME', () => {
    const diag = evaluateKrxSectorIndexRawDiagnostic(
      makeInput({ rawTodayRows: [{ indexCode: '', indexName: '' }, { indexCode: null, indexName: null }] }),
    );
    expect(diag.breakPoint).toBe('KRX_ROWS_HAVE_NO_INDEX_NAME');
    expect(diag.rowsMissingCodeAndName).toBe(2);
    expect(diag.rowsWithIndexCode).toBe(0);
    expect(diag.rowsWithIndexName).toBe(0);
  });

  // 3) KRX_ROWS_HAVE_INDEX_CODE_BUT_NOT_IN_MASTER
  it('indexCode 있으나 master 미등록 + missing-name row 0 → KRX_ROWS_HAVE_INDEX_CODE_BUT_NOT_IN_MASTER', () => {
    const diag = evaluateKrxSectorIndexRawDiagnostic(
      makeInput({
        rawTodayRows: [
          { indexCode: '9999XXXX', indexName: '' },
          { indexCode: '8888YYYY', indexName: '' },
        ],
      }),
    );
    expect(diag.breakPoint).toBe('KRX_ROWS_HAVE_INDEX_CODE_BUT_NOT_IN_MASTER');
    expect(diag.rowsWithIndexCode).toBe(2);
    expect(diag.indexCodeInMasterCount).toBe(0);
  });

  // 4) BACKFILL_NOT_INVOKED
  it('missing-code-have-name row 있으나 backfill 미호출 → BACKFILL_NOT_INVOKED', () => {
    const diag = evaluateKrxSectorIndexRawDiagnostic(
      makeInput({
        rawTodayRows: [{ indexCode: '', indexName: '반도체' }],
        backfillInvoked: false,
      }),
    );
    expect(diag.breakPoint).toBe('BACKFILL_NOT_INVOKED');
    expect(diag.rowsMissingCodeButHaveName).toBe(1);
    expect(diag.backfillInvoked).toBe(false);
  });

  // 5) KRX_ROWS_HAVE_INDEX_NAME_BUT_ALIAS_MISS
  it('backfill 호출 + 매칭 0 + alias resolvable 0 → KRX_ROWS_HAVE_INDEX_NAME_BUT_ALIAS_MISS', () => {
    const diag = evaluateKrxSectorIndexRawDiagnostic(
      makeInput({
        rawTodayRows: [
          { indexCode: '', indexName: '존재하지않는섹터XYZ' },
          { indexCode: '', indexName: '미등록인덱스ABC' },
        ],
        backfillInvoked: true,
        backfilledCount: 0,
      }),
    );
    expect(diag.breakPoint).toBe('KRX_ROWS_HAVE_INDEX_NAME_BUT_ALIAS_MISS');
    expect(diag.aliasResolvableCount).toBe(0);
    expect(diag.unresolvedIndexNameCount).toBe(2);
    expect(diag.sampleUnresolvedNames).toContain('존재하지않는섹터XYZ');
  });

  // 6) BACKFILL_INVOKED_BUT_ZERO_MATCH
  it('backfill 호출 + 매칭 0 + alias resolvable > 0 → BACKFILL_INVOKED_BUT_ZERO_MATCH', () => {
    const diag = evaluateKrxSectorIndexRawDiagnostic(
      makeInput({
        rawTodayRows: [{ indexCode: '', indexName: '반도체' }],
        backfillInvoked: true,
        backfilledCount: 0,
      }),
    );
    expect(diag.breakPoint).toBe('BACKFILL_INVOKED_BUT_ZERO_MATCH');
    expect(diag.aliasResolvableCount).toBe(1);
    expect(diag.backfilledCount).toBe(0);
  });

  // 7) BACKFILL_RECOVERED
  it('backfilledCount > 0 → BACKFILL_RECOVERED', () => {
    const diag = evaluateKrxSectorIndexRawDiagnostic(
      makeInput({
        rawTodayRows: [
          { indexCode: '', indexName: '반도체' },
          { indexCode: '', indexName: '이차전지' },
        ],
        backfillInvoked: true,
        backfilledCount: 2,
      }),
    );
    expect(diag.breakPoint).toBe('BACKFILL_RECOVERED');
    expect(diag.backfilledCount).toBe(2);
  });

  // 8) FALLBACK_TO_KIS_BASKET
  it('missing-name row 0 + finalSourceTier=KIS_STOCK_BASKET_DERIVED → FALLBACK_TO_KIS_BASKET', () => {
    const diag = evaluateKrxSectorIndexRawDiagnostic(
      makeInput({ rawTodayRows: [], finalSourceTier: 'KIS_STOCK_BASKET_DERIVED' }),
    );
    // rawTodayRows 빈 배열 → KRX_ROWS_EMPTY 가 우선. KIS path 미진입 시 rawTodayRows 가 []이므로
    // FALLBACK_TO_KIS_BASKET 는 row 가 있고 missing-name 0인 케이스에서만 발생.
    expect(diag.breakPoint).toBe('KRX_ROWS_EMPTY');

    const diag2 = evaluateKrxSectorIndexRawDiagnostic(
      makeInput({
        rawTodayRows: [{ indexCode: '1KSI3030', indexName: '반도체' }],
        finalSourceTier: 'KIS_STOCK_BASKET_DERIVED',
      }),
    );
    expect(diag2.breakPoint).toBe('FALLBACK_TO_KIS_BASKET');
    expect(diag2.indexCodeInMasterCount).toBe(1);
  });

  // 9) FALLBACK_TO_STOCK_DAILY
  it('missing-name row 0 + finalSourceTier=STOCK_DAILY → FALLBACK_TO_STOCK_DAILY', () => {
    const diag = evaluateKrxSectorIndexRawDiagnostic(
      makeInput({
        rawTodayRows: [{ indexCode: '1KSI3030', indexName: '반도체' }],
        finalSourceTier: 'STOCK_DAILY',
      }),
    );
    expect(diag.breakPoint).toBe('FALLBACK_TO_STOCK_DAILY');
  });

  // 10) UNKNOWN
  it('master 등록 row + missing-name 0 + finalSourceTier=KRX_CODE → UNKNOWN', () => {
    const diag = evaluateKrxSectorIndexRawDiagnostic(
      makeInput({
        rawTodayRows: [{ indexCode: '1KSI3030', indexName: '반도체' }],
        finalSourceTier: 'KRX_CODE',
      }),
    );
    expect(diag.breakPoint).toBe('UNKNOWN');
  });

  // 11) sample 한도 + literal invariant
  it('sample 배열 한도 (≤20) + executionImpact/liveExecutionAllowed literal 강제', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      indexCode: '',
      indexName: `미등록섹터${i}`,
    }));
    const diag = evaluateKrxSectorIndexRawDiagnostic(
      makeInput({ rawTodayRows: rows, backfillInvoked: true, backfilledCount: 0 }),
    );
    expect(diag.sampleIndexNames.length).toBeLessThanOrEqual(20);
    expect(diag.sampleUnresolvedNames.length).toBeLessThanOrEqual(20);
    expect(diag.sampleRawKeysTop.length).toBeLessThanOrEqual(30);
    expect(diag.executionImpact).toBe('NONE');
    expect(diag.liveExecutionAllowed).toBe(false);
    // formatter 출력에 진단 전용 invariant 노출
    const section = formatKrxSectorIndexRawDiagnosticSection(diag);
    expect(section).toContain('executionImpact: NONE');
    expect(section).toContain('liveExecutionAllowed: false');
    const compact = formatKrxSectorIndexRawDiagnosticCompactLine(diag);
    expect(compact).toContain('ADR-0446');
    expect(compact).toContain('KRX_ROWS_HAVE_INDEX_NAME_BUT_ALIAS_MISS');
  });

  // 12) log throttle + ENV gate
  it('같은 breakPoint 60초 throttle + ENV disabled no-op', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const diag = evaluateKrxSectorIndexRawDiagnostic(makeInput({ rawTodayRows: [] }));
      // 첫 호출 — 로그 1회
      logKrxSectorIndexRawDiagnostic(diag, 1_000);
      expect(logSpy).toHaveBeenCalledTimes(1);
      // 59초 후 같은 breakPoint — throttle (로그 0)
      logKrxSectorIndexRawDiagnostic(diag, 1_000 + 59_000);
      expect(logSpy).toHaveBeenCalledTimes(1);
      // 60초 후 — 다시 로그
      logKrxSectorIndexRawDiagnostic(diag, 1_000 + 60_001);
      expect(logSpy).toHaveBeenCalledTimes(2);
      // ENV disabled — no-op (throttle Map 초기화 후)
      __resetKrxSectorIndexRawDiagnosticLogForTests();
      process.env.KRX_SECTOR_INDEX_RAW_DIAGNOSTIC_DISABLED = 'true';
      expect(isKrxSectorIndexRawDiagnosticDisabled()).toBe(true);
      logKrxSectorIndexRawDiagnostic(diag, 2_000_000);
      expect(logSpy).toHaveBeenCalledTimes(2);
      // ADR-0157 정확 비교 — '1' / 'TRUE' / 'yes' 거부
      process.env.KRX_SECTOR_INDEX_RAW_DIAGNOSTIC_DISABLED = '1';
      expect(isKrxSectorIndexRawDiagnosticDisabled()).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });
});
