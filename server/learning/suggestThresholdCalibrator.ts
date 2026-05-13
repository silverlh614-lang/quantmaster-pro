// @responsibility SuggestThresholdCalibrator — diagnostic proposals only; thresholds are never auto-applied
import { appendJson, readJson, SUGGEST_DIAGNOSTIC_PROPOSALS_FILE } from './learningStorage.js';
import type { SuggestDiagnosticProposal } from './learningTypes.js';
import { LEARNING_SUGGEST_CHANNELS } from './learningConstants.js';
export function loadSuggestDiagnosticProposals(): SuggestDiagnosticProposal[] { return readJson(SUGGEST_DIAGNOSTIC_PROPOSALS_FILE, []); }
export function runSuggestThresholdCalibrator(input: { now?: Date; suggest7d?: Record<string, number>; channelSamples?: Record<string, number>; scores?: Record<string, number> } = {}): { proposals: SuggestDiagnosticProposal[]; blocker: string; diagnosticSuggestCreated: boolean } {
  const now = input.now ?? new Date();
  const total7d = Object.values(input.suggest7d ?? {}).reduce((a, b) => a + b, 0);
  const channels = total7d === 0 ? LEARNING_SUGGEST_CHANNELS : LEARNING_SUGGEST_CHANNELS.filter(c => (input.suggest7d?.[c] ?? 0) === 0);
  const proposals: SuggestDiagnosticProposal[] = [];
  for (const c of channels.slice(0, total7d === 0 ? 1 : channels.length)) {
    const sampleSize = input.channelSamples?.[c] ?? 0;
    const observedScore = input.scores?.[c] ?? 0;
    const currentThreshold = 0.7;
    const blocker = sampleSize <= 0 ? 'NO_INPUT_SAMPLE' : observedScore < currentThreshold ? 'THRESHOLD_NOT_MET' : 'ALERT_PIPELINE_SILENT';
    proposals.push({ id: `suggest-diagnostic-${c}-${now.getTime()}`, createdAt: now.toISOString(), channel: c, currentThreshold, observedScore, sampleSize, blocker, recommendation: `관찰용 threshold relaxation proposal: ${c} 채널 입력/스코어를 점검하되 자동 변경 금지`, riskLevel: 'LOW', autoApply: false });
  }
  for (const p of proposals) appendJson(SUGGEST_DIAGNOSTIC_PROPOSALS_FILE, p);
  return { proposals, blocker: proposals[0]?.blocker ?? 'NONE', diagnosticSuggestCreated: proposals.length > 0 };
}
