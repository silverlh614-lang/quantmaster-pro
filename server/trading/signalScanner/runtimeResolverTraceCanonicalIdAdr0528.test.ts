// @responsibility ADR-0528 canonical sourceSnapshotId alignment test for runtime resolver trace modules.

import { describe, expect, it } from 'vitest';
import { formatRuntimeResolverTraceStep26 } from './runtimeResolverTraceStep26.js';
import type { ScanSummary } from './scanDiagnostics/scanSummaryTypes.js';

function makeSummaryWithScanEvaluationOnly(): ScanSummary {
  return {
    time: '2026-05-25T13:10:00.000+09:00',
    // snapshotId intentionally absent — canonical id must fall back to scanEvaluation.scanId.
    candidates: 12,
    trackB: 0,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    quoteFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    scanEvaluation: {
      scanId: 'scan-eval-2026-05-25T13:10:00',
    } as unknown as ScanSummary['scanEvaluation'],
  } as ScanSummary;
}

function makeSummaryWithoutAnyId(): ScanSummary {
  return {
    // time also absent so the only remaining fallback is NO_SCAN_SUMMARY.
    candidates: 0,
    trackB: 0,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    quoteFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
  } as unknown as ScanSummary;
}

function extractHeaderSourceSnapshotId(output: string): string {
  const line = output.split('\n').find((row) => row.startsWith('sourceSnapshotId='));
  return line ? line.slice('sourceSnapshotId='.length) : 'MISSING';
}

function extractModuleSourceSnapshotIds(output: string): string[] {
  return output
    .split('\n')
    .filter((row) => row.trimStart().startsWith('sourceSnapshotId='))
    // The header line does not start with whitespace; module lines are indented.
    .filter((row) => row.startsWith('  sourceSnapshotId='))
    .map((row) => row.trim().slice('sourceSnapshotId='.length));
}

describe('runtimeResolverTrace canonical sourceSnapshotId alignment (ADR-0528)', () => {
  it('aligns every module sourceSnapshotId with the header canonical scanEvaluation.scanId', () => {
    const output = formatRuntimeResolverTraceStep26(makeSummaryWithScanEvaluationOnly());
    const headerId = extractHeaderSourceSnapshotId(output);
    const moduleIds = extractModuleSourceSnapshotIds(output);

    expect(headerId).toBe('scan-eval-2026-05-25T13:10:00');
    expect(headerId).not.toBe('NO_SCAN_SUMMARY');
    expect(moduleIds.length).toBeGreaterThan(0);
    for (const moduleId of moduleIds) {
      expect(moduleId).toBe(headerId);
      expect(moduleId).not.toBe('NO_SCAN_SUMMARY');
    }
  });

  it('retains NO_SCAN_SUMMARY fallback for header and modules when no id is resolvable', () => {
    const output = formatRuntimeResolverTraceStep26(makeSummaryWithoutAnyId());
    const headerId = extractHeaderSourceSnapshotId(output);
    const moduleIds = extractModuleSourceSnapshotIds(output);

    expect(headerId).toBe('NO_SCAN_SUMMARY');
    expect(moduleIds.length).toBeGreaterThan(0);
    for (const moduleId of moduleIds) {
      expect(moduleId).toBe('NO_SCAN_SUMMARY');
    }
  });
});
