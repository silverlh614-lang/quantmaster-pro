// @responsibility /learning_outcomes compact ADR-0522 outcome closure summary; read-only.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  formatLearningOutcomesSummary,
  outcomeClosureRepo,
} from '../../../learning/outcomeClosure.js';

const learningOutcomes: TelegramCommand = {
  name: '/learning_outcomes',
  aliases: ['/outcome_labels', '/outcome_attribution'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Outcome label closure and attribution compact summary',
  usage: '/learning_outcomes',
  async execute({ reply }) {
    await reply([
      formatLearningOutcomesSummary(outcomeClosureRepo.summarizeLearningOutcomes()),
      '',
      'note: learning diagnostic only; no provider fetch, no broker order, no live promotion.',
    ].join('\n'));
  },
};

commandRegistry.register(learningOutcomes);

export default learningOutcomes;
