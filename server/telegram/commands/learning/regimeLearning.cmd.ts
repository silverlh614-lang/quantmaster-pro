// @responsibility /regime_learning diagnostic commands for regime-specific Shadow Learning Bank.
import {
  collectRegimeLearningBank,
  collectRegimeLearningConsistency,
  formatRegimeConditionAttribution,
  formatRegimeLearningConsistency,
  formatRegimeLearningDetail,
  formatRegimeLearningSummary,
} from '../../../learning/regimeLearningBank.js';
import {
  formatRegimeLearningBackfillDryRun,
  formatRegimeLearningBackfillRun,
  formatRegimeUnknownAnalysis,
  formatRegimeUnknownRepair,
  regimeLearningBackfillDryRun,
  regimeLearningBackfillRun,
  regimeUnknownAnalysis,
  regimeUnknownRepairDryRun,
  regimeUnknownRepairRun,
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

const regimeUnknownAnalysisCmd: TelegramCommand = {
  name: '/regime_unknown_analysis',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Analyze UNKNOWN regime learning samples and recovery blockers',
  async execute({ reply }) {
    await reply(formatRegimeUnknownAnalysis(regimeUnknownAnalysis()));
  },
};

const regimeUnknownRepairDryrunCmd: TelegramCommand = {
  name: '/regime_unknown_repair_dryrun',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Dry-run UNKNOWN regime low-confidence repair',
  async execute({ reply }) {
    await reply(formatRegimeUnknownRepair(regimeUnknownRepairDryRun(), 'dryrun'));
  },
};

const regimeUnknownRepairRunCmd: TelegramCommand = {
  name: '/regime_unknown_repair_run',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Run UNKNOWN regime repair executionImpact=NONE',
  async execute({ reply }) {
    await reply(formatRegimeUnknownRepair(regimeUnknownRepairRun(), 'run'));
  },
};

const regimeConditionAttribution: TelegramCommand = {
  name: '/regime_condition_attribution',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Regime-specific condition attribution diagnostics',
  usage: '/regime_condition_attribution [regime]',
  async execute({ args, reply }) {
    await reply(formatRegimeConditionAttribution(args[0], collectRegimeLearningBank()));
  },
};

commandRegistry.register(regimeLearning);
commandRegistry.register(regimeLearningDetail);
commandRegistry.register(regimeLearningBackfillDryrun);
commandRegistry.register(regimeLearningBackfillRunCmd);
commandRegistry.register(regimeLearningConsistency);
commandRegistry.register(regimeUnknownAnalysisCmd);
commandRegistry.register(regimeUnknownRepairDryrunCmd);
commandRegistry.register(regimeUnknownRepairRunCmd);
commandRegistry.register(regimeConditionAttribution);

export {
  regimeLearningBackfillDryrun,
  regimeLearningBackfillRunCmd,
  regimeConditionAttribution,
  regimeLearningConsistency,
  regimeLearningDetail,
  regimeUnknownAnalysisCmd,
  regimeUnknownRepairDryrunCmd,
  regimeUnknownRepairRunCmd,
};
export default regimeLearning;
