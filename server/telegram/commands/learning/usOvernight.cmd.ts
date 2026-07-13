// @responsibility ADR-0604 /us_overnight — 미국 야간↔KOSPI stratify 관측 표 출력 (읽기 전용).
import { buildUsOvernightStratifyLines } from '../../../learning/usOvernightStratifyLedger.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const usOvernight: TelegramCommand = {
  name: '/us_overnight',
  aliases: [],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '미국 야간(SPX 밴드)별 KOSPI 당일 수익 실측 — ADR-0604 관측, executionImpact=NONE',
  usage: '/us_overnight',
  async execute({ reply }) {
    await reply(buildUsOvernightStratifyLines());
  },
};

commandRegistry.register(usOvernight);
