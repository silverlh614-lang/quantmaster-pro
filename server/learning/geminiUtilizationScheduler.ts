// @responsibility GeminiUtilizationScheduler — schedules recommendation-only learning reflection assistance
import { loadReflectionBudget } from '../persistence/reflectionRepo.js';
import { loadCurrentSchemaRecords } from '../persistence/attributionRepo.js';
import { appendJson, readJson, GEMINI_LEARNING_RUNS_FILE } from './learningStorage.js';
import type { GeminiLearningSchedule } from './learningTypes.js';
import { LEARNING_GEMINI_UTILIZATION_TARGET, LEARNING_TRADING_DAYS_PER_MONTH } from './learningConstants.js';
function kstEod(now: Date): string { const d = new Date(now.getTime() + 9 * 3600000); d.setUTCHours(10, 0, 0, 0); if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString(); }
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
