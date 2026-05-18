// @responsibility Keep recent scan evaluation cases for shadow-learning diagnostics.

import type { ScanEvaluationResult } from './scanEvaluationState.js';

const MAX_RECENT_SCAN_CASES = 50;
const recentScanCases: ScanEvaluationResult[] = [];

export function recordScanCase(result: ScanEvaluationResult): void {
  recentScanCases.push(result);
  if (recentScanCases.length > MAX_RECENT_SCAN_CASES) {
    recentScanCases.splice(0, recentScanCases.length - MAX_RECENT_SCAN_CASES);
  }
}

export function listRecentScanCases(): ScanEvaluationResult[] {
  return [...recentScanCases];
}

export function __resetScanCasesForTests(): void {
  recentScanCases.splice(0, recentScanCases.length);
}
