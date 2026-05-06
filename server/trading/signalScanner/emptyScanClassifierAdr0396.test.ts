// @responsibility ADR-0396 emptyScanClassifier DEGRADED 격상 회귀
import { describe, it, expect } from 'vitest';
import { classifyEmptyScanReason } from './emptyScanClassifier.js';
import type { ScanSummary } from './scanDiagnostics.js';

function makeBaseSummary(overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
    candidates: 5,
    yahooFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    counterfactualRecordedToday: 0,
    pendingTraces: [],
    summary: '',
    ...overrides,
  } as ScanSummary;
}

describe('ADR-0396 (= 사용자 명시 ADR-0371): emptyScanClassifier DEGRADED 격상', () => {
  it('sectorEnergyQuality=FAILED → DATA_INVALID (기존 ADR-0127 보존)', () => {
    const summary = makeBaseSummary({
      sectorEnergyQuality: 'FAILED',
      candidates: 5,
      entries: 0,
    });
    const result = classifyEmptyScanReason(summary);
    expect(result).toBe('DATA_INVALID');
  });

  it('sectorEnergyQuality=DEGRADED → DATA_INVALID (ADR-0396 신규 격상)', () => {
    const summary = makeBaseSummary({
      sectorEnergyQuality: 'DEGRADED',
      candidates: 5,
      entries: 0,
    });
    const result = classifyEmptyScanReason(summary);
    expect(result).toBe('DATA_INVALID');
  });

  it('sectorEnergyQuality=STALE → DATA_INVALID 미적용 (ADR-0396 정책 — 6-8 섹터 fallback 충분)', () => {
    const summary = makeBaseSummary({
      sectorEnergyQuality: 'STALE',
      candidates: 5,
      entries: 0,
    });
    const result = classifyEmptyScanReason(summary);
    expect(result).not.toBe('DATA_INVALID');
  });

  it('sectorEnergyQuality=PARTIAL → DATA_INVALID 미적용', () => {
    const summary = makeBaseSummary({
      sectorEnergyQuality: 'PARTIAL',
      candidates: 5,
      entries: 0,
    });
    const result = classifyEmptyScanReason(summary);
    expect(result).not.toBe('DATA_INVALID');
  });

  it('sectorEnergyQuality=OK → DATA_INVALID 미적용', () => {
    const summary = makeBaseSummary({
      sectorEnergyQuality: 'OK',
      candidates: 5,
      entries: 0,
    });
    const result = classifyEmptyScanReason(summary);
    expect(result).not.toBe('DATA_INVALID');
  });

  it('sectorEnergyQuality 미설정 → DATA_INVALID 미적용 (후방호환)', () => {
    const summary = makeBaseSummary({
      candidates: 5,
      entries: 0,
    });
    const result = classifyEmptyScanReason(summary);
    expect(result).not.toBe('DATA_INVALID');
  });
});
