// @responsibility SampleStarvationGuard — turns sample starvation into actionable repair routing
import { loadGhostPortfolio } from '../persistence/reflectionRepo.js';
import { loadCurrentSchemaRecords } from '../persistence/attributionRepo.js';
import type { LearningGhostCase, StarvationAnalysis, StarvationReason } from './learningTypes.js';
import { LEARNING_ATTRIBUTION_TARGET_7D } from './learningConstants.js';
function recent(iso: string | undefined, days: number, now: Date) { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) && t >= now.getTime() - days * 86400000; }
export function analyzeSampleStarvation(now: Date = new Date(), targetSampleCount = LEARNING_ATTRIBUTION_TARGET_7D): StarvationAnalysis {
  const ghosts = loadGhostPortfolio() as LearningGhostCase[];
  const attrs = loadCurrentSchemaRecords();
  const samples7d = attrs.filter(r => recent(r.closedAt, 7, now)).length;
  const reasons: Record<StarvationReason, number> = { no_close: 0, close_without_label: 0, label_without_attribution: 0, attribution_threshold_too_high: 0, data_quarantine_too_many: 0, duplicate_suppression_too_strict: 0, none: 0, resolved: 0 };
  reasons.no_close = ghosts.filter(g => !g.closed).length;
  reasons.close_without_label = ghosts.filter(g => g.closed && !g.outcomeLabel).length;
  reasons.label_without_attribution = ghosts.filter(g => g.closed && !!g.outcomeLabel && !g.attributionProcessed && !['DATA_CORRUPTED','QUARANTINED','ACTIVE'].includes(g.outcomeLabel)).length;
  reasons.data_quarantine_too_many = ghosts.filter(g => ['DATA_CORRUPTED','QUARANTINED'].includes(g.outcomeLabel ?? '') || ['CORRUPTED','QUARANTINED'].includes(g.dataQuality ?? '')).length;
  if (samples7d < targetSampleCount && Object.values(reasons).every(v => v === 0)) reasons.attribution_threshold_too_high = targetSampleCount - samples7d;
  let previousStarvationReason: StarvationReason = 'none';
  for (const [k, v] of Object.entries(reasons) as Array<[StarvationReason, number]>) if (!['none','resolved'].includes(k) && v > (reasons[previousStarvationReason] ?? 0)) previousStarvationReason = k;
  const starvationFlag = samples7d < targetSampleCount;
  const primaryReason: StarvationReason = starvationFlag ? previousStarvationReason : 'resolved';
  if (!starvationFlag) reasons.resolved = samples7d;
  const action = primaryReason === 'no_close' ? 'run GhostCloseResolver' : primaryReason === 'close_without_label' ? 'run GhostOutcomeFinalizer' : primaryReason === 'label_without_attribution' ? 'run AttributionBackfillEngine' : primaryReason === 'attribution_threshold_too_high' ? 'send to SuggestThresholdCalibrator' : primaryReason === 'data_quarantine_too_many' ? 'inspect data provider quarantine' : 'no repair needed';
  return { starvationFlag, targetSampleCount, samples7d, reasons, primaryReason, previousStarvationReason: previousStarvationReason === 'none' ? undefined : previousStarvationReason, recommendedAction: action };
}
