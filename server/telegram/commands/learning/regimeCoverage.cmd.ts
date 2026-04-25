// @responsibility: /regime_coverage — 레짐별 학습 샘플 수 / 목표 / 부족 상태.
import { formatRegimeCoverage } from '../../../learning/regimeBalancedSampler.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const regimeCoverage: TelegramCommand = {
  name: '/regime_coverage',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '레짐별 학습 샘플 커버리지',
  async execute({ reply }) {
    await reply(formatRegimeCoverage());
  },
};

commandRegistry.register(regimeCoverage);

export default regimeCoverage;
