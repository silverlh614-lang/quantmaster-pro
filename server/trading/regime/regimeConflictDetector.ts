// @responsibility Detect and emit operational warnings for regime snapshot conflicts.
import { defaultWarnTtlSec, emitOperationalWarn } from '../../observability/operationalWarn.js';
import type { RegimeConflictCode, RegimeSnapshot } from './effectiveRegimeSnapshot.js';
import { listMacroDataHealthIssues } from './macroDataHealthRouter.js';

function isR6Regime(value: string | undefined): boolean {
  return value === 'R6_DEFENSE' ||
    value === 'R6_PANIC' ||
    value === 'R6_CONFIRMATION_WAIT' ||
    value === 'R6_RECOVERY_WATCH';
}

function displayLooksGreen(value: string): boolean {
  return value === 'GREEN' || value === 'OK' || value.includes('GREEN') || value.includes('OK');
}

export function detectRegimeConflicts(snapshot: RegimeSnapshot): RegimeConflictCode[] {
  const conflicts = new Set<RegimeConflictCode>();
  const r6Active = snapshot.riskOverride === 'R6_DEFENSE' || isR6Regime(snapshot.effectiveRegime);

  if (r6Active && (displayLooksGreen(snapshot.displayRegime) || (snapshot.mhs ?? 0) >= 60)) {
    conflicts.add('GREEN_WITH_R6');
  }

  if (snapshot.riskOverride === 'R6_DEFENSE' && !isR6Regime(snapshot.effectiveRegime)) {
    conflicts.add('RISK_OVERRIDE_WITH_NON_R6');
  }

  if (((snapshot.mhs ?? 50) >= 60 && (snapshot.biasScore ?? 0) <= -20) ||
      ((snapshot.mhs ?? 50) <= 40 && (snapshot.biasScore ?? 0) >= 20)) {
    conflicts.add('MHS_BIAS_CONFLICT');
  }

  if ((r6Active && snapshot.displayRegime !== 'R6_DEFENSE') ||
      (!r6Active && displayLooksGreen(snapshot.displayRegime) && (snapshot.biasScore ?? 0) <= -35)) {
    conflicts.add('DISPLAY_REGIME_CONFLICT');
  }

  return Array.from(conflicts);
}

function warnCodeForConflict(conflict: RegimeConflictCode): string {
  switch (conflict) {
    case 'GREEN_WITH_R6': return 'P1_GREEN_WITH_R6_BLOCKED';
    case 'RISK_OVERRIDE_WITH_NON_R6': return 'P1_RISK_OVERRIDE_WITH_NON_R6';
    case 'MHS_BIAS_CONFLICT': return 'P1_MHS_BIAS_CONFLICT';
    case 'DISPLAY_REGIME_CONFLICT': return 'P1_REGIME_CONFLICT';
  }
}

export function emitRegimeConflictWarnings(snapshot: RegimeSnapshot): void {
  for (const conflict of snapshot.conflicts) {
    emitOperationalWarn({
      priority: 'P1',
      domain: 'REGIME',
      code: warnCodeForConflict(conflict),
      message: `Regime snapshot conflict detected: ${conflict}`,
      executionImpact: 'REGIME_DISPLAY_CONFLICT',
      mode: snapshot.engineMode,
      regime: snapshot.displayRegime,
      dedupKey: `regime-conflict:${conflict}:${snapshot.displayRegime}:${snapshot.effectiveRegime}`,
      ttlSec: defaultWarnTtlSec('P1'),
      details: {
        snapshotId: snapshot.snapshotId,
        asOf: snapshot.asOf,
        detectedRegime: snapshot.detectedRegime,
        effectiveRegime: snapshot.effectiveRegime,
        riskOverride: snapshot.riskOverride,
        mhs: snapshot.mhs,
        biasScore: snapshot.biasScore,
      },
    });
  }
}

export function emitRegimeDataHealthWarnings(snapshot: RegimeSnapshot): void {
  const issues = listMacroDataHealthIssues(snapshot.dataHealth);
  if (issues.length === 0) return;

  const stale = snapshot.stale || issues.some((issue) => issue.endsWith(':STALE'));
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DATA',
    code: stale ? 'P1_MACRO_STATE_STALE' : 'P1_MACRO_DATA_HEALTH_DEGRADED',
    message: `Regime macro data health is ${snapshot.sourceHealth}`,
    executionImpact: 'NONE',
    mode: snapshot.engineMode,
    regime: snapshot.displayRegime,
    dedupKey: `regime-data-health:${snapshot.sourceHealth}:${issues.join('|')}`,
    ttlSec: defaultWarnTtlSec('P1'),
    details: {
      reason: 'providerIssue=true marketSignal=false',
      snapshotId: snapshot.snapshotId,
      asOf: snapshot.asOf,
      providerIssue: snapshot.providerIssue,
      marketSignal: snapshot.marketSignal,
      issues,
      dataHealth: snapshot.dataHealth,
    },
  });
}
