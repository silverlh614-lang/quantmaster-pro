// @responsibility /learning_pulse — LearningPulseDiagnostics v2 + legacy 7영역 snapshot compatibility
import fs from 'fs';
import { collectLearningPulseV2 } from '../../../learning/learningPulseDiagnostics.js';
import { collectLearningPulseV3, formatLearningPulseV3 } from '../../../learning/learningOutcomeQuality.js';
import { LEARNING_ATTRIBUTION_TARGET_7D, LEARNING_GEMINI_UTILIZATION_TARGET, LEARNING_SUGGEST_CHANNELS, LEARNING_TRADING_DAYS_PER_MONTH } from '../../../learning/learningConstants.js';
import { loadGhostPortfolio, loadExperimentProposals, loadReflectionBudget } from '../../../persistence/reflectionRepo.js';
import { loadCurrentSchemaRecords } from '../../../persistence/attributionRepo.js';
import { loadConditionWeights } from '../../../persistence/conditionWeightsRepo.js';
import { F2W_AUDIT_FILE, REFLECTION_BUDGET_FILE } from '../../../persistence/paths.js';
import { getRecentAlertHistory } from '../../../persistence/alertHistoryRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
export const PULSE_THRESHOLDS = { GHOST_OPEN_BLOCKER_MIN: 100, GHOST_CLOSE_RATIO_THRESHOLD: 0.1, ATTRIBUTION_TARGET_7D: LEARNING_ATTRIBUTION_TARGET_7D, SUGGEST_SILENCE_THRESHOLD: 1, GEMINI_USE_RATIO_TARGET: LEARNING_GEMINI_UTILIZATION_TARGET, GEMINI_BUSINESS_DAYS_PER_MONTH: LEARNING_TRADING_DAYS_PER_MONTH } as const;
export const SUGGEST_MODULES = LEARNING_SUGGEST_CHANNELS;
type SuggestModule = typeof SUGGEST_MODULES[number];
export function computeGeminiUseRatio(callCount: number): number { return Number.isFinite(callCount) && callCount > 0 ? Math.max(0, Math.min(1, callCount / LEARNING_TRADING_DAYS_PER_MONTH)) : 0; }
function readF2W(errors: string[]) { try { if (!fs.existsSync(F2W_AUDIT_FILE)) return null; const log = JSON.parse(fs.readFileSync(F2W_AUDIT_FILE, 'utf-8')) as any[]; return Array.isArray(log) ? log.at(-1) : null; } catch (e) { errors.push(`f2w:${e instanceof Error ? e.message : String(e)}`); return null; } }
function readBudgetFor(now: Date) { try { if (fs.existsSync(REFLECTION_BUDGET_FILE)) { const b = JSON.parse(fs.readFileSync(REFLECTION_BUDGET_FILE, 'utf-8')) as any; if (b?.month === now.toISOString().slice(0,7)) return b; } } catch { /* fallback below */ } return loadReflectionBudget(); }
function recent(iso: string | undefined, days: number, now: Date) { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) && t >= now.getTime() - days * 86400000; }
const activeStates = new Set(['PROPOSED','AUTO_STARTED','AWAIT_APPROVAL','RUNNING']);
export function collectLearningPulse(now: Date = new Date()) {
  const errors: string[] = [];
  const v2 = collectLearningPulseV2(now);
  const ghosts = loadGhostPortfolio() as any[];
  const open = ghosts.filter(g => !g.closed).length;
  const closedRecent7d = ghosts.filter(g => g.closed && recent(g.closedAt ?? g.lastUpdatedAt, 7, now)).length;
  const closeRatio = open > 0 ? closedRecent7d / open : 0;
  const attr = loadCurrentSchemaRecords();
  const attribution7dCount = attr.filter(r => recent(r.closedAt, 7, now)).length;
  const weightsRaw = loadConditionWeights();
  const vals = Object.values(weightsRaw ?? {}).filter((v): v is number => typeof v === 'number');
  const changedFromDefault = vals.filter(v => v !== 1).length;
  const sunsetCount = vals.filter(v => v <= 0.1).length;
  const untouched = vals.filter(v => v === 1).length;
  const f2wTail = readF2W(errors);
  const recentAlerts = getRecentAlertHistory(500);
  const suggest7d: Record<SuggestModule, number> = { counterfactual: 0, ledger: 0, kellySurface: 0, regime: 0 };
  for (const a of recentAlerts as any[]) {
    if (!recent(a.at, 7, now) || !a.success || !String(a.message).includes('학습 모듈 Suggest')) continue;
    for (const m of SUGGEST_MODULES) if (String(a.message).includes(`Suggest — ${m}`)) { suggest7d[m]++; break; }
  }
  const proposals = loadExperimentProposals();
  const experimentsActive = proposals.filter(p => activeStates.has(p.state)).length;
  const budget = readBudgetFor(now);
  const useRatio = computeGeminiUseRatio(budget.callCount);
  const flags: string[] = [];
  if (open >= PULSE_THRESHOLDS.GHOST_OPEN_BLOCKER_MIN && closeRatio < PULSE_THRESHOLDS.GHOST_CLOSE_RATIO_THRESHOLD) flags.push(`ghost_close_blocker (${open}건 적체)`);
  if (attribution7dCount < PULSE_THRESHOLDS.ATTRIBUTION_TARGET_7D) flags.push(`sample_starvation (attribution ${attribution7dCount}/${PULSE_THRESHOLDS.ATTRIBUTION_TARGET_7D}/7d)`);
  if (Object.values(suggest7d).reduce((a,b)=>a+b,0) < PULSE_THRESHOLDS.SUGGEST_SILENCE_THRESHOLD) flags.push('suggest_silence (4 채널 모두 7일 0건)');
  if (useRatio < PULSE_THRESHOLDS.GEMINI_USE_RATIO_TARGET) flags.push(`gemini_underuse (호출률 ${(useRatio * 100).toFixed(0)}% < 80%)`);
  return { ...v2, v3: collectLearningPulseV3(now), todayKst: new Date(now.getTime() + 9 * 3600000).toISOString().slice(0,10), ghost: { ...v2.ghost, closedRecent7d, closeRatio }, attribution7d: { count: attribution7dCount, target: LEARNING_ATTRIBUTION_TARGET_7D }, weights: { changedFromDefault, sunsetCount, untouched, lastF2WRanAt: f2wTail?.ranAt, lastF2WSkipCount: f2wTail ? f2wTail.adjustments.filter((a: any) => a.action === 'NONE').length : 0, lastF2WTotalRecords: f2wTail?.totalRecords ?? 0 }, suggest7d, experimentsActive, gemini: { ...v2.gemini, month: budget.month, callCount: budget.callCount, tokensUsed: budget.tokensUsed, useRatio }, flags, partialFailure: errors.length > 0 };
}
export function formatLearningPulseMessage(s: ReturnType<typeof collectLearningPulse>): string {
  const totalSuggest = Object.values(s.suggest7d).reduce((a,b)=>a+b,0);
  return [formatLearningPulseV3(s.v3), `🩺 Learning Pulse (${s.todayKst})`, `👻 Ghost Portfolio: OPEN ${s.ghost.open} / 7일 close ${s.ghost.closedRecent7d} / closeRate7d ${(s.ghost.closeRate7d*100).toFixed(1)}% / staleOpenCount ${s.ghost.staleOpenCount}`, `📊 Attribution: ${s.attribution7d.count}/${s.attribution7d.target} (7d) / starvationReason ${s.attribution.starvationReason}`, `⚖️ Condition Weights: changed ${s.weights.changedFromDefault} / untouched ${s.weights.untouched} / sunset ${s.weights.sunsetCount}`, `🔔 Suggest 발사: total7d ${totalSuggest} / counterfactual ${s.suggest7d.counterfactual} / ledger ${s.suggest7d.ledger} / kellySurface ${s.suggest7d.kellySurface} / regime ${s.suggest7d.regime} / blocker ${s.suggest.blocker}`, `🧪 Experiment Proposal: active ${s.experimentsActive}`, `🤖 Gemini: 호출 ${s.gemini.callCount}회 / ~${LEARNING_TRADING_DAYS_PER_MONTH}영업일 → 호출률 ${(s.gemini.useRatio*100).toFixed(0)}% / nextScheduledAt ${s.gemini.nextScheduledAt ?? 'N/A'}`, s.flags.length ? `🚩 진단 플래그: ${s.flags.join(', ')}` : '✅ 모든 채널 정상', s.partialFailure ? '⚠️ 데이터 일부 미확인 — 손상/누락 저장소가 있어 가능한 영역만 표시' : ''].filter(Boolean).join('\n');
}
const learningPulse: TelegramCommand = { name: '/learning_pulse', aliases: ['/lp'], category: 'LRN', visibility: 'ADMIN', riskLevel: 0, description: '학습 루프 v4 진단 (cohort/metadata/counterfactual/condition/holding/promotion)', async execute({ reply }) { try { await reply(formatLearningPulseMessage(collectLearningPulse())); } catch (e) { await reply(`⚠️ /learning_pulse 실패: ${e instanceof Error ? e.message : String(e)}`); } } };
commandRegistry.register(learningPulse);
export default learningPulse;
