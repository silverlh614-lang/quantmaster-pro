// @responsibility Detect and emit operational warnings for regime snapshot conflicts.
import { defaultWarnTtlSec, emitOperationalWarn } from '../../observability/operationalWarn.js';
import type { RegimeConflictCode, RegimeSnapshot } from './effectiveRegimeSnapshot.js';

type RegimeConflictRemediationFields = {
  rawMhsLabel?: string;
  rawBiasLabel?: string;
  selectedDisplaySource?: string;
  correctionApplied?: boolean;
  userVisibleSafe?: boolean;
  macroFreshness?: string;
  macroAgeSec?: number;
  macroLastRefreshAttemptAt?: string;
  macroRefreshJobLastRunAt?: string;
  regimeReleaseAllowed?: boolean;
  regimeReleaseBlockedReason?: string;
  executionImpact?: string;
};

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

  if (r6Active && displayLooksGreen(snapshot.displayRegime)) {
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

function resolveMhsBiasConflictSeverity(snapshot: RegimeSnapshot): {
  code: string;
  executionImpact: string;
  correctionApplied: boolean;
  userVisibleSafe: boolean;
} {
  const extra = snapshot as RegimeSnapshot & {
    liveNewBuyAllowed?: boolean;
    telegramDisplayRegime?: string;
  };
  const riskOverride = snapshot.riskOverride;
  const safeOverride = riskOverride === 'BLACK_SWAN' || riskOverride === 'R6_DEFENSE';
  const displaySafe = snapshot.displayRegime === 'R6_DEFENSE';
  const mhsSafe = snapshot.mhsDisplayLabel === 'OVERRIDDEN_BY_R6';
  const liveBlocked = extra.liveNewBuyAllowed === false;
  const telegramDisplayRegime = extra.telegramDisplayRegime ?? snapshot.displayRegime;
  const telegramSafe = telegramDisplayRegime === 'R6_DEFENSE';
  const userVisibleSafe = safeOverride && displaySafe && mhsSafe && liveBlocked && telegramSafe;
  if (userVisibleSafe) {
    return {
      code: 'P1_MHS_BIAS_OVERRIDDEN_BY_R6',
      executionImpact: 'NONE',
      correctionApplied: true,
      userVisibleSafe: true,
    };
  }
  return {
    code: 'P1_MHS_BIAS_CONFLICT',
    executionImpact: 'REGIME_DISPLAY_CONFLICT',
    correctionApplied: false,
    userVisibleSafe: false,
  };
}

export function emitRegimeConflictWarnings(snapshot: RegimeSnapshot): void {
  for (const conflict of snapshot.conflicts) {
    const extra = snapshot as RegimeSnapshot & RegimeConflictRemediationFields;
    const correctionApplied = extra.correctionApplied === true || (conflict === 'GREEN_WITH_R6' && snapshot.displayRegime === 'R6_DEFENSE');
    const userVisibleSafe = correctionApplied ? true : extra.userVisibleSafe === true;
    const mhsBiasSeverity = conflict === 'MHS_BIAS_CONFLICT' ? resolveMhsBiasConflictSeverity(snapshot) : null;
    const executionImpact = mhsBiasSeverity?.executionImpact ??
      (conflict === 'GREEN_WITH_R6' && correctionApplied && userVisibleSafe
        ? 'NEW_BUY_BLOCKED_ONLY'
        : 'REGIME_DISPLAY_CONFLICT');
    emitOperationalWarn({
      priority: 'P1',
      domain: 'REGIME',
      code: mhsBiasSeverity?.code ?? warnCodeForConflict(conflict),
      message: `Regime snapshot conflict detected: ${conflict}`,
      executionImpact,
      mode: snapshot.engineMode,
      regime: snapshot.displayRegime,
      dedupKey: `regime-conflict:${conflict}:${snapshot.displayRegime}:${snapshot.effectiveRegime}`,
      ttlSec: defaultWarnTtlSec('P1'),
      details: {
        snapshotId: snapshot.snapshotId,
        asOf: snapshot.asOf,
        rawMhs: snapshot.mhs,
        rawMhsLabel: extra.rawMhsLabel,
        mhsDisplayLabel: snapshot.mhsDisplayLabel,
        biasLabel: extra.rawBiasLabel,
        detectedRegime: snapshot.detectedRegime,
        effectiveRegime: snapshot.effectiveRegime,
        displayRegime: snapshot.displayRegime,
        displaySeverity: snapshot.displaySeverity,
        riskOverride: snapshot.riskOverride,
        liveNewBuyAllowed: (snapshot as RegimeSnapshot & { liveNewBuyAllowed?: boolean }).liveNewBuyAllowed,
        telegramDisplayRegime: (snapshot as RegimeSnapshot & { telegramDisplayRegime?: string }).telegramDisplayRegime ?? snapshot.displayRegime,
        selectedDisplaySource: extra.selectedDisplaySource,
        correctionApplied: mhsBiasSeverity?.correctionApplied ?? correctionApplied,
        userVisibleSafe: mhsBiasSeverity?.userVisibleSafe ?? userVisibleSafe,
        remediation: correctionApplied
          ? 'Display has been corrected to risk override; verify Telegram does not expose GREEN while R6 is active.'
          : 'Investigate regime presenter/resolver immediately; GREEN may be user-visible during R6.',
        biasScore: snapshot.biasScore,
      },
    });
  }
}

export function emitRegimeDataHealthWarnings(snapshot: RegimeSnapshot): void {
  const issues = listMacroDataHealthIssues(snapshot.dataHealth);
  if (issues.length === 0) return;

  const stale = snapshot.stale || issues.some((issue) => issue.endsWith(':STALE'));
  const macroState = (snapshot.dataHealth?.macroState ?? '').toUpperCase();
  const macroStateStale = macroState === 'HARD_STALE' || macroState === 'SOFT_STALE';
  const staleSources = issues
    .filter((issue) => issue.endsWith(':STALE'))
    .map((issue) => issue.split(':')[0]);
  const code = macroStateStale
    ? 'P1_MACRO_STATE_STALE'
    : stale
      ? 'P1_REGIME_DATA_HEALTH_STALE'
      : 'P1_MACRO_DATA_HEALTH_DEGRADED';
  const extra = snapshot as RegimeSnapshot & RegimeConflictRemediationFields;
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DATA',
    code,
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
      staleSources,
      macroState,
      macroFreshness: extra.macroFreshness,
      macroAgeSec: extra.macroAgeSec,
      macroLastRefreshAttemptAt: extra.macroLastRefreshAttemptAt,
      macroRefreshJobLastRunAt: extra.macroRefreshJobLastRunAt,
      regimeReleaseAllowed: extra.regimeReleaseAllowed,
      regimeReleaseBlockedReason: extra.regimeReleaseBlockedReason,
      executionImpact: extra.executionImpact,
      issues,
      dataHealth: snapshot.dataHealth,
    },
  });
}
