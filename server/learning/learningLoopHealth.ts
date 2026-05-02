// @responsibility read-only self-learning loop health snapshot
import fs from 'fs';
import { F2W_AUDIT_FILE } from '../persistence/paths.js';
import { loadFailurePatterns } from '../persistence/failurePatternRepo.js';
import { loadBiasHeatmap, loadRecentReflections } from '../persistence/reflectionRepo.js';
import { loadReflectionImpactRecords } from '../persistence/reflectionImpactRepo.js';
import type { BiasType, ReflectionReport } from './reflectionTypes.js';

export type LearningLoopHealthLevel =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'STATELESS'
  | 'INSUFFICIENT_DATA';

export type LearningLoopVerdict = LearningLoopHealthLevel;

export interface LearningLoopHealthSnapshot {
  capturedAt: string;
  windowDays: number;
  level: LearningLoopHealthLevel;
  metrics: {
    f2wAuditActivity7d: number;
    reflectionImpactMeaningfulRatio7d: number;
    failurePatternActiveCount: number;
    biasHeatmapVariance7d: number;
    shadowWalkForwardFresh: boolean;
    counterfactualFresh: boolean;
    rejectionShadowSamples: number;
  };
  warnings: string[];
  /** Backward-compatible alias for older Telegram/tests. */
  overallVerdict: LearningLoopHealthLevel;
  /** Backward-compatible diagnostic aliases. */
  biasScoreVariance7d: {
    samples: number;
    avgVariancePerBias: Partial<Record<BiasType, number>>;
    statelessCount: number;
    verdict: 'STATELESS' | 'STATEFUL' | 'INSUFFICIENT';
  };
  failurePatternIngestion: {
    activePatterns: number;
    ingestedToReflection: boolean;
    lastIngestionAt?: string;
  };
  reflectionImpactPhase: {
    phase1Active: boolean;
    phase2Active: boolean;
    reason: string;
  };
  silentVerdictRatio7d: {
    totalReflections: number;
    silentCount: number;
    ratio: number;
  };
}

export const LEARNING_LOOP_HEALTH_CONSTANTS = {
  DEFAULT_WINDOW_DAYS: 7,
  MIN_WINDOW_DAYS: 3,
  MAX_WINDOW_DAYS: 30,
  MIN_BUSINESS_DAYS_FOR_VERDICT: 3,
  REFLECTION_IMPACT_MEANINGFUL_LOW: 0.15,
  REFLECTION_IMPACT_MEANINGFUL_HEALTHY: 0.35,
  BIAS_STATELESS_VARIANCE_EPSILON: 0.000001,
} as const;

export interface LearningLoopHealthOptions {
  windowDays?: number;
  biasStatelessVarianceThreshold?: number;
}

export function resolveWindowDays(input?: number): number {
  if (input === undefined || !Number.isFinite(input)) {
    return LEARNING_LOOP_HEALTH_CONSTANTS.DEFAULT_WINDOW_DAYS;
  }
  return Math.max(
    LEARNING_LOOP_HEALTH_CONSTANTS.MIN_WINDOW_DAYS,
    Math.min(LEARNING_LOOP_HEALTH_CONSTANTS.MAX_WINDOW_DAYS, Math.floor(input)),
  );
}

export function resolveBiasStatelessThreshold(input?: number): number {
  const envRaw = process.env.LEARNING_BIAS_STATELESS_VARIANCE_THRESHOLD;
  if (envRaw !== undefined && envRaw !== '') {
    const envParsed = Number(envRaw);
    if (Number.isFinite(envParsed) && envParsed >= 0) return envParsed;
  }
  if (input !== undefined && Number.isFinite(input) && input >= 0) return input;
  return LEARNING_LOOP_HEALTH_CONSTANTS.BIAS_STATELESS_VARIANCE_EPSILON;
}

export function computeJaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string): Set<string> => {
    if (!s || typeof s !== 'string') return new Set();
    return new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean),
    );
  };
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function computeVariance(values: number[]): number {
  const safe = values.filter((v) => Number.isFinite(v));
  if (safe.length <= 1) return 0;
  const mean = safe.reduce((sum, v) => sum + v, 0) / safe.length;
  return safe.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (safe.length - 1);
}

function cutoffDate(now: Date, windowDays: number): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - windowDays + 1);
  return d.toISOString().slice(0, 10);
}

function countF2WAuditActivity(cutoff: string): number {
  if (!fs.existsSync(F2W_AUDIT_FILE)) return 0;
  try {
    const runs = JSON.parse(fs.readFileSync(F2W_AUDIT_FILE, 'utf-8')) as Array<{
      ranAt?: string;
      adjustments?: Array<{ action?: string }>;
    }>;
    return runs.filter((run) => {
      const date = String(run.ranAt ?? '').slice(0, 10);
      if (date < cutoff) return false;
      return (run.adjustments ?? []).some((a) => a.action && a.action !== 'NONE');
    }).length;
  } catch {
    return 0;
  }
}

function computeReflectionImpactMeaningfulRatio(cutoff: string): number {
  const records = loadReflectionImpactRecords().filter((r) => r.date >= cutoff);
  if (records.length === 0) return 0;
  return records.filter((r) => r.meaningful).length / records.length;
}

function computeBiasVariance(
  now: Date,
  windowDays: number,
  threshold: number,
): Pick<LearningLoopHealthSnapshot, 'biasScoreVariance7d'> & { avgVariance: number } {
  const cutoff = cutoffDate(now, windowDays);
  const entries = loadBiasHeatmap().filter((e) => e.date >= cutoff);
  if (entries.length < LEARNING_LOOP_HEALTH_CONSTANTS.MIN_BUSINESS_DAYS_FOR_VERDICT) {
    return {
      avgVariance: 0,
      biasScoreVariance7d: {
        samples: entries.length,
        avgVariancePerBias: {},
        statelessCount: 0,
        verdict: 'INSUFFICIENT',
      },
    };
  }

  const byBias = new Map<BiasType, number[]>();
  for (const entry of entries) {
    for (const score of entry.scores ?? []) {
      if (!byBias.has(score.bias)) byBias.set(score.bias, []);
      byBias.get(score.bias)!.push(score.score);
    }
  }

  const avgVariancePerBias: Partial<Record<BiasType, number>> = {};
  const variances: number[] = [];
  let statelessCount = 0;
  for (const [bias, values] of byBias) {
    const variance = computeVariance(values);
    avgVariancePerBias[bias] = variance;
    variances.push(variance);
    if (variance <= threshold) statelessCount++;
  }
  const avgVariance =
    variances.length > 0 ? variances.reduce((sum, v) => sum + v, 0) / variances.length : 0;

  return {
    avgVariance,
    biasScoreVariance7d: {
      samples: entries.length,
      avgVariancePerBias,
      statelessCount,
      verdict: avgVariance <= threshold ? 'STATELESS' : 'STATEFUL',
    },
  };
}

function computeSilentVerdictRatio7d(
  reports: ReflectionReport[],
): LearningLoopHealthSnapshot['silentVerdictRatio7d'] {
  if (reports.length === 0) return { totalReflections: 0, silentCount: 0, ratio: 0 };
  const silentCount = reports.filter((r) => r.dailyVerdict === 'SILENT').length;
  return { totalReflections: reports.length, silentCount, ratio: silentCount / reports.length };
}

function deriveLevel(metrics: LearningLoopHealthSnapshot['metrics'], reports: ReflectionReport[]): LearningLoopHealthLevel {
  if (reports.length < LEARNING_LOOP_HEALTH_CONSTANTS.MIN_BUSINESS_DAYS_FOR_VERDICT) {
    return 'INSUFFICIENT_DATA';
  }
  const impactLow =
    metrics.reflectionImpactMeaningfulRatio7d <=
    LEARNING_LOOP_HEALTH_CONSTANTS.REFLECTION_IMPACT_MEANINGFUL_LOW;
  if (metrics.biasHeatmapVariance7d <= LEARNING_LOOP_HEALTH_CONSTANTS.BIAS_STATELESS_VARIANCE_EPSILON && impactLow) {
    return 'STATELESS';
  }
  if (metrics.f2wAuditActivity7d === 0 && impactLow) return 'DEGRADED';

  const healthySignals = [
    metrics.f2wAuditActivity7d > 0,
    metrics.reflectionImpactMeaningfulRatio7d >=
      LEARNING_LOOP_HEALTH_CONSTANTS.REFLECTION_IMPACT_MEANINGFUL_HEALTHY,
    metrics.failurePatternActiveCount > 0,
    metrics.biasHeatmapVariance7d > LEARNING_LOOP_HEALTH_CONSTANTS.BIAS_STATELESS_VARIANCE_EPSILON,
  ].filter(Boolean).length;

  return healthySignals >= 3 ? 'HEALTHY' : 'DEGRADED';
}

export function collectLearningLoopHealth(
  now: Date = new Date(),
  opts: LearningLoopHealthOptions = {},
): LearningLoopHealthSnapshot {
  const windowDays = resolveWindowDays(opts.windowDays);
  const varianceThreshold = resolveBiasStatelessThreshold(opts.biasStatelessVarianceThreshold);
  const cutoff = cutoffDate(now, windowDays);
  const reports = loadRecentReflections(windowDays);
  const warnings: string[] = [];
  const conditionConfessionCount = reports.reduce(
    (sum, report) => sum + (report.conditionConfession?.length ?? 0),
    0,
  );
  const followUpActionCount = reports.reduce(
    (sum, report) => sum + (report.followUpActions?.length ?? 0),
    0,
  );

  const f2wAuditActivity7d = countF2WAuditActivity(cutoff);
  const reflectionImpactMeaningfulRatio7d = computeReflectionImpactMeaningfulRatio(cutoff);
  const failurePatternActiveCount = loadFailurePatterns().length;
  const { avgVariance, biasScoreVariance7d } = computeBiasVariance(now, windowDays, varianceThreshold);

  warnings.push('shadowWalkForward freshness source unavailable');
  warnings.push('counterfactual freshness source unavailable');
  warnings.push('rejectionShadow samples source unavailable');

  const metrics = {
    f2wAuditActivity7d,
    reflectionImpactMeaningfulRatio7d,
    failurePatternActiveCount,
    biasHeatmapVariance7d: avgVariance,
    shadowWalkForwardFresh: false,
    counterfactualFresh: false,
    rejectionShadowSamples: 0,
  };
  const level = deriveLevel(metrics, reports);
  if (level === 'INSUFFICIENT_DATA') {
    warnings.push(`recent reflections insufficient (${reports.length} < ${LEARNING_LOOP_HEALTH_CONSTANTS.MIN_BUSINESS_DAYS_FOR_VERDICT})`);
  }
  if (conditionConfessionCount === 0) warnings.push('conditionConfession source empty in recent reflections');
  if (followUpActionCount === 0) warnings.push('followUpActions source empty in recent reflections');
  if (level === 'STATELESS') warnings.push('biasHeatmap variance and reflection impact are both near zero');
  if (level === 'DEGRADED') warnings.push('learning activity is partial or weak in the current window');

  return {
    capturedAt: now.toISOString(),
    windowDays,
    level,
    metrics,
    warnings,
    overallVerdict: level,
    biasScoreVariance7d,
    failurePatternIngestion: {
      activePatterns: failurePatternActiveCount,
      ingestedToReflection: failurePatternActiveCount > 0,
    },
    reflectionImpactPhase: {
      phase1Active: true,
      phase2Active: false,
      reason: 'reflectionImpact is measured here as read-only input; behavior changes are routed through F2W/killSwitch/position sizing.',
    },
    silentVerdictRatio7d: computeSilentVerdictRatio7d(reports),
  };
}

export function formatLearningLoopHealthMessage(snap: LearningLoopHealthSnapshot): string {
  const lines = [
    `<b>Self-learning loop health</b>: ${snap.level} (${snap.windowDays}d)`,
    `F2W audit activity: ${snap.metrics.f2wAuditActivity7d}`,
    `Reflection impact meaningful ratio: ${(snap.metrics.reflectionImpactMeaningfulRatio7d * 100).toFixed(0)}%`,
    `Failure patterns active: ${snap.metrics.failurePatternActiveCount}`,
    `Bias heatmap variance: ${snap.metrics.biasHeatmapVariance7d.toFixed(6)}`,
  ];
  if (snap.warnings.length > 0) {
    lines.push('', '<b>Warnings</b>:');
    for (const warning of snap.warnings) lines.push(`- ${warning}`);
  }
  lines.push('', `<i>capturedAt: ${snap.capturedAt}</i>`);
  return lines.join('\n');
}
