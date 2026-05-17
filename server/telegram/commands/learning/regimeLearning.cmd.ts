// @responsibility /regime_learning diagnostic commands for regime-specific Shadow Learning Bank.
import {
  collectRegimeLearningBank,
  collectRegimeLearningConsistency,
  formatRegimeLearningConsistency,
  formatRegimeLearningDetail,
  formatRegimeLearningSummary,
} from '../../../learning/regimeLearningBank.js';
import {
  formatRegimeLearningBackfillDryRun,
  formatRegimeLearningBackfillRun,
  regimeLearningBackfillDryRun,
  regimeLearningBackfillRun,
} from '../../../learning/regimeLearningBackfill.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const regimeLearning: TelegramCommand = {
  name: '/regime_learning',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Regime-specific Shadow Learning Bank summary',
  async execute({ reply }) {
    await reply(formatRegimeLearningSummary(collectRegimeLearningBank()));
  },
};

const regimeLearningDetail: TelegramCommand = {
  name: '/regime_learning_detail',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Regime-specific Shadow Learning Bank detail',
  usage: '/regime_learning_detail <regime>',
  async execute({ args, reply }) {
    const regime = args[0] ?? 'UNKNOWN';
    await reply(formatRegimeLearningDetail(regime, collectRegimeLearningBank()));
  },
};

const regimeLearningBackfillDryrun: TelegramCommand = {
  name: '/regime_learning_backfill_dryrun',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Regime Learning legacy sample backfill dry-run',
  async execute({ reply }) {
    await reply(formatRegimeLearningBackfillDryRun(regimeLearningBackfillDryRun()));
  },
};

const regimeLearningBackfillRunCmd: TelegramCommand = {
  name: '/regime_learning_backfill_run',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Regime Learning legacy sample backfill executionImpact=NONE',
  async execute({ reply }) {
    await reply(formatRegimeLearningBackfillRun(regimeLearningBackfillRun()));
  },
};

const regimeLearningConsistency: TelegramCommand = {
  name: '/regime_learning_consistency',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Regime Learning Bank consistency diagnostics',
  async execute({ reply }) {
    await reply(formatRegimeLearningConsistency(collectRegimeLearningConsistency(collectRegimeLearningBank())));
  },
};

commandRegistry.register(regimeLearning);
commandRegistry.register(regimeLearningDetail);
commandRegistry.register(regimeLearningBackfillDryrun);
commandRegistry.register(regimeLearningBackfillRunCmd);
commandRegistry.register(regimeLearningConsistency);

export {
  regimeLearningBackfillDryrun,
  regimeLearningBackfillRunCmd,
  regimeLearningConsistency,
  regimeLearningDetail,
};
export default regimeLearning;
