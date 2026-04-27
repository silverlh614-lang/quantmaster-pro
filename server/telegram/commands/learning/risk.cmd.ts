// @responsibility risk.cmd 텔레그램 모듈
// @responsibility: /risk /risk_budget — 계좌 리스크 예산 + Fractional Kelly 캡 현황 (signalScanner 게이트와 동일 로직).
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
  description: '계좌 리스크 예산 + Fractional Kelly 캡 현황',
  async execute({ reply }) {
    const settings = loadTradingSettings();
    const totalAssets = settings.startingCapital ?? 0;
    const budget = getAccountRiskBudget({ totalAssets });
    await reply(
      formatAccountRiskBudget(budget) +
      `\n\n<i>총 자본 기준: ${(totalAssets / 10_000).toLocaleString()}만원 (settings.startingCapital)\n` +
      `Fractional Kelly: STRONG_BUY ≤0.5 / BUY ≤0.25 / HOLD ≤0.1</i>`,
    );
  },
};

commandRegistry.register(risk);

export default risk;
