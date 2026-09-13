// @responsibility /risk /risk_budget account risk and current Shadow sizing.
import { loadTradingSettings } from '../../../persistence/tradingSettingsRepo.js';
import {
  getAccountRiskBudget,
  formatAccountRiskBudget,
} from '../../../trading/accountRiskBudget.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const risk: TelegramCommand = {
  name: '/risk',
  aliases: ['/risk_budget'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '계좌 위험예산과 현재 Shadow 실험 정책',
  async execute({ reply }) {
    const settings = loadTradingSettings();
    const totalAssets = settings.startingCapital ?? 0;
    const budget = getAccountRiskBudget({ totalAssets });
    await reply(formatAccountRiskBudget(budget) + '\n\n현재 Shadow는 실험당 1주를 기록하며 실제 주문을 하지 않습니다. /paper · /paper_research');
  },
};

commandRegistry.register(risk);
