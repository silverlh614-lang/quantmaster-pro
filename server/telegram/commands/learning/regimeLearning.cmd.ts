// @responsibility /regime_learning diagnostic commands for regime-specific Shadow Learning Bank.
import {
  collectRegimeLearningBank,
  formatRegimeLearningDetail,
  formatRegimeLearningSummary,
} from '../../../learning/regimeLearningBank.js';
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

commandRegistry.register(regimeLearning);
commandRegistry.register(regimeLearningDetail);

export { regimeLearningDetail };
export default regimeLearning;
