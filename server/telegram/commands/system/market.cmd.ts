// @responsibility market.cmd 텔레그램 모듈
// @responsibility: /market 명령 — 시장 요약 리포트 생성을 비동기 트리거.
import { sendMarketSummaryOnDemand } from '../../../alerts/reportGenerator.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const market: TelegramCommand = {
  name: '/market',
  category: 'MKT',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '시장상황 요약 레포트 즉시 생성',
  async execute({ reply }) {
    await reply('📡 시장상황 요약 생성 중...');
    await sendMarketSummaryOnDemand().catch(console.error);
  },
};

commandRegistry.register(market);

export default market;
