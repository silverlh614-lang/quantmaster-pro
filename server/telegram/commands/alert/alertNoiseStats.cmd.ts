// @responsibility /alert_noise_stats command for ADR-0468 notification hygiene diagnostics.
import { formatAlertNoiseStats, getAlertNoiseStats } from '../../../alerts/alertNoisePolicy.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const alertNoiseStats: TelegramCommand = {
  name: '/alert_noise_stats',
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Telegram alert noise suppression stats for today',
  async execute({ reply }) {
    await reply(formatAlertNoiseStats(getAlertNoiseStats()));
  },
};

commandRegistry.register(alertNoiseStats);

export default alertNoiseStats;
