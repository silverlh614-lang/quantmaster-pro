// @responsibility /learning_outcomes compact ADR-0522 outcome closure summary; read-only.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import {
  formatLearningOutcomesSummary,
  outcomeClosureRepo,
} from '../../../learning/outcomeClosure.js';
import {
  buildWeightFeedbackReport,
  formatLearningFeedbackLine,
} from '../../../learning/dynamicWeightFeedback.js';
import { buildDiagnosticCommandHint } from '../../renderers/diagnosticButtonBuilder.js';
import { renderLearningCompact, learningSummaryFromOutcomeSummary } from '../../renderers/learningCompactRenderer.js';
import { buildSnapshotBundleFromScanSummary } from '../../renderers/snapshotBundle.js';

const learningOutcomes: TelegramCommand = {
  name: '/learning',
  aliases: ['/learning_outcomes', '/learning_full', '/outcome_labels', '/outcome_attribution'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Outcome label closure and attribution compact summary',
  usage: '/learning',
  menuPriority: 0,
  async execute({ args, command, reply }) {
    const summary = outcomeClosureRepo.summarizeLearningOutcomes();
    const wantsFull = command === '/learning_full' || args.some(arg => ['full', 'detail'].includes(arg.toLowerCase()));
    if (!wantsFull) {
      const feedback = buildWeightFeedbackReport({
        seeds: outcomeClosureRepo.listSeeds(),
        createdAt: new Date(0).toISOString(),
      });
      const bundle = {
        ...buildSnapshotBundleFromScanSummary(getLastScanSummary()),
        learning: {
          ...learningSummaryFromOutcomeSummary(summary),
          feedbackLine: formatLearningFeedbackLine(feedback),
        },
        executionImpact: 'NONE',
        shadowLearning: true,
      };
      await reply([
        renderLearningCompact(bundle),
        buildDiagnosticCommandHint('learning'),
      ].join('\n'));
      return;
    }
    await reply([
      formatLearningOutcomesSummary(summary),
      '',
      'note: learning diagnostic only; no provider fetch, no broker order, no live promotion.',
    ].join('\n'));
  },
};

commandRegistry.register(learningOutcomes);

export default learningOutcomes;
