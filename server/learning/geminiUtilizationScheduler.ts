// @responsibility GeminiUtilizationScheduler — schedules recommendation-only learning reflection assistance
import { loadReflectionBudget } from '../persistence/reflectionRepo.js';
import { loadCurrentSchemaRecords } from '../persistence/attributionRepo.js';
import { appendJson, readJson, GEMINI_LEARNING_RUNS_FILE } from './learningStorage.js';
import type { GeminiLearningSchedule } from './learningTypes.js';
import { LEARNING_GEMINI_UTILIZATION_TARGET, LEARNING_TRADING_DAYS_PER_MONTH } from './learningConstants.js';
function kstEod(now: Date): string {
  const d = new Date(now.getTime() + 9 * 3600000);
  d.setUTCHours(10, 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}
export function getGeminiLearningRuns(): GeminiLearningSchedule[] { return readJson(GEMINI_LEARNING_RUNS_FILE, []); }
export function scheduleGeminiLearningReflection(now: Date = new Date()): GeminiLearningSchedule {
  const budget = loadReflectionBudget();
  const callsThisMonth = budget.callCount ?? 0;
  const utilizationRate = Math.max(0, Math.min(1, callsThisMonth / LEARNING_TRADING_DAYS_PER_MONTH));
  const month = now.toISOString().slice(0, 7);
  const hasData = loadCurrentSchemaRecords().some(r => r.closedAt.startsWith(month));
  const res: GeminiLearningSchedule = { callsThisMonth, tradingDaysThisMonth: LEARNING_TRADING_DAYS_PER_MONTH, utilizationRate, lastCallAt: budget.lastReflectionDate, nextScheduledAt: utilizationRate < LEARNING_GEMINI_UTILIZATION_TARGET ? kstEod(now) : undefined, diagnostic: hasData ? 'learning reflection scheduled with closed/outcome/attribution data' : 'no sufficient sample', recommendationOnly: true, conditionWeightsChanged: 0 };
  appendJson(GEMINI_LEARNING_RUNS_FILE, res);
  return res;
}
export type GeminiLearningSchedulerStatus = 'SCHEDULED' | 'STALE' | 'MISSED' | 'IDLE';
export function collectGeminiLearningSchedulerStatus(now: Date = new Date()) {
  const runs = getGeminiLearningRuns();
  const last = runs.at(-1);
  const staleSchedules = runs.filter((r) => {
    const next = r.nextScheduledAt ? new Date(r.nextScheduledAt).getTime() : NaN;
    return Number.isFinite(next) && next < now.getTime();
  });
  const nextMs = last?.nextScheduledAt ? new Date(last.nextScheduledAt).getTime() : NaN;
  const stale = Number.isFinite(nextMs) && nextMs < now.getTime();
  const nextScheduledAt = stale ? kstEod(now) : last?.nextScheduledAt;
  const schedulerStatus: GeminiLearningSchedulerStatus = stale ? 'STALE' : nextScheduledAt ? 'SCHEDULED' : staleSchedules.length ? 'MISSED' : 'IDLE';
  const lastRunAt = [...runs].reverse().find((r) => r.lastCallAt)?.lastCallAt;
  return {
    lastScheduledAt: last?.nextScheduledAt,
    lastRunAt,
    nextScheduledAt,
    schedulerStatus,
    missedCount: staleSchedules.length,
    recommendationOnly: true as const,
    executionImpact: 'NONE' as const,
    brokerOrdersCreated: 0 as const,
  };
}
export function ensureGeminiLearningScheduleFresh(now: Date = new Date()) {
  const status = collectGeminiLearningSchedulerStatus(now);
  if (status.schedulerStatus === 'STALE' || status.schedulerStatus === 'MISSED') {
    const budget = loadReflectionBudget();
    appendJson<GeminiLearningSchedule>(GEMINI_LEARNING_RUNS_FILE, {
      callsThisMonth: budget.callCount ?? 0,
      tradingDaysThisMonth: LEARNING_TRADING_DAYS_PER_MONTH,
      utilizationRate: Math.max(0, Math.min(1, (budget.callCount ?? 0) / LEARNING_TRADING_DAYS_PER_MONTH)),
      lastCallAt: budget.lastReflectionDate,
      nextScheduledAt: status.nextScheduledAt ?? kstEod(now),
      diagnostic: `stale schedule rescheduled; previousNextScheduledAt=${status.lastScheduledAt ?? 'N/A'}; executionImpact=NONE`,
      recommendationOnly: true,
      conditionWeightsChanged: 0,
    });
  }
  return status;
}
