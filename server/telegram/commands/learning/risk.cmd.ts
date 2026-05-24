// @responsibility /risk /risk_budget account risk with simplified regime position policy.
import { loadTradingSettings } from '../../../persistence/tradingSettingsRepo.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import {
  getAccountRiskBudget,
  formatAccountRiskBudget,
} from '../../../trading/accountRiskBudget.js';
import { getLiveRegime } from '../../../trading/regimeBridge.js';
import { calculateRegimePositionSizing } from '../../../trading/sizing/regimePositionPolicy.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const risk: TelegramCommand = {
  name: '/risk',
  aliases: ['/risk_budget'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Account risk budget and simplified regime position policy',
  async execute({ reply }) {
    const settings = loadTradingSettings();
    const totalAssets = settings.startingCapital ?? 0;
    const budget = getAccountRiskBudget({ totalAssets });
    const regime = getLiveRegime(loadMacroState());
    const sizing = calculateRegimePositionSizing({
      regime,
      totalEquity: totalAssets,
      currentPositions: 0,
    });
    await reply(
      formatAccountRiskBudget(budget) +
      `\n\n<b>Position policy</b>` +
      `\nregime=${sizing.policy.regime}` +
      `\nmaxPositions=${sizing.policy.maxPositions}` +
      `\nmaxGrossExposurePct=${sizing.policy.maxGrossExposurePct}` +
      `\nperPositionPct=${sizing.policy.perPositionPct}` +
      `\npositionAmount=${Math.round(sizing.positionAmount).toLocaleString()} KRW` +
      `\nexecutionImpact=NONE`,
    );
  },
};

commandRegistry.register(risk);

export default risk;
