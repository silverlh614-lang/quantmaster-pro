// @responsibility circuits.cmd 텔레그램 모듈
// @responsibility: /circuits — KIS/KRX 회로 차단 상태 진단 (저녁 추천 스캔 빈 결과 디버그용).
import { getCircuitBreakerStats } from '../../../clients/kisClient.js';
import { getKrxOpenApiStatus } from '../../../clients/krxOpenApi.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const circuits: TelegramCommand = {
  name: '/circuits',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'KIS/KRX 회로 차단 상태 조회 (저녁 스캔 디버그)',
  async execute({ reply }) {
    const kisCircuits = getCircuitBreakerStats();
    const krxStatus = getKrxOpenApiStatus();
    const kisLines =
      kisCircuits.length === 0
        ? '  (이력 없음)'
        : kisCircuits
            .map(c => {
              const open = c.openFor > 0;
              const tag = open ? `🔴 OPEN (${Math.ceil(c.openFor / 1000)}s 남음)` : '🟢 CLOSED';
              return `  ${tag} ${c.trId} (실패 ${c.consecutiveFailures}회)`;
            })
            .join('\n');
    await reply(
      `⚡ <b>[회로 차단기 상태]</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `<b>KIS</b>:\n${kisLines}\n\n` +
      `<b>KRX OpenAPI</b>: ${krxStatus.circuitState === 'OPEN' ? '🔴 OPEN' : '🟢 ' + krxStatus.circuitState} ` +
      `(실패 ${krxStatus.failures}회)\n\n` +
      `<i>/reset_circuits — 모든 KIS 회로 즉시 해제 (저녁 스캔 전 권장)</i>`,
    );
  },
};

commandRegistry.register(circuits);

export default circuits;
