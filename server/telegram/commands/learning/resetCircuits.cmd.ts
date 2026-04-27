// @responsibility resetCircuits.cmd 텔레그램 모듈
// @responsibility: /reset_circuits — KIS/KRX 회로 즉시 해제 (저녁 추천 스캔 전 일괄 reset).
import { resetKisCircuits } from '../../../clients/kisClient.js';
import { _resetKrxOpenApiBreaker } from '../../../clients/krxOpenApi.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const resetCircuits: TelegramCommand = {
  name: '/reset_circuits',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: 'KIS/KRX 회로 즉시 해제 (저녁 스캔 전 권장)',
  async execute({ reply }) {
    const cleared = resetKisCircuits();
    try {
      _resetKrxOpenApiBreaker();
    } catch (e) {
      console.warn('[TelegramBot] KRX 회로 reset 실패:', e instanceof Error ? e.message : e);
    }
    await reply(
      `🔧 <b>[회로 차단 해제]</b>\n` +
      `해제된 KIS 회로: ${cleared}개\n` +
      `KRX OpenAPI 회로: 함께 reset 시도\n` +
      `<i>저녁 스캔/추천 작업 전 호출 권장. 이후 5xx 가 다시 누적되면 재차 차단됩니다.</i>`,
    );
  },
};

commandRegistry.register(resetCircuits);

export default resetCircuits;
