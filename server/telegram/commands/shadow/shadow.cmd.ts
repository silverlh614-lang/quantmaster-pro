// @responsibility Shadow Learning 조회 명령어 묶음 — read-only Telegram 요약
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { shadowCaseLedger } from '../../../shadow/shadowCaseLedger.js';
import { shadowReturnFlow } from '../../../shadow/shadowReturnFlow.js';
import { formatShadowCase, formatShadowIntegrity, formatShadowOutcomes, formatShadowPromotion, formatShadowReturnFlow, formatShadowStatus, formatShadowSymbol } from '../../../shadow/shadowCommands.js';

function register(name: string, description: string, execute: TelegramCommand['execute'], usage?: string): void {
  commandRegistry.register({ name, category: 'LRN', visibility: 'ADMIN', riskLevel: 0, description, usage, execute });
}

register('/shadow_status', 'Shadow 엔진 요약', async ({ reply }) => reply(formatShadowStatus(shadowCaseLedger)));
register('/shadow_integrity', 'Shadow 무결성 요약', async ({ reply }) => reply(formatShadowIntegrity(shadowCaseLedger)));
register('/shadow_return_flow', 'Shadow 사후 조회 품질', async ({ reply }) => reply(formatShadowReturnFlow(shadowReturnFlow.metrics())));
register('/shadow_promotion', 'Shadow 승격 후보 리포트', async ({ reply }) => reply(formatShadowPromotion(shadowCaseLedger, shadowReturnFlow.metrics().hitRate)));
register('/shadow_outcomes', 'Shadow outcome 최근 요약', async ({ reply }) => reply(formatShadowOutcomes(shadowCaseLedger)));
register('/shadow_blocked', '차단된 Shadow case 요약', async ({ reply }) => {
  const rows = shadowCaseLedger.listCases().filter((c) => c.blockedReason).slice(-10);
  await reply(['⛔ <b>[Shadow Blocked]</b>', ...rows.map((c) => `- ${c.symbol}: ${c.outcomeLabel ?? 'ACTIVE'} · ${c.blockedReason}`)].join('\n'));
});
register('/shadow_today', '오늘 Shadow case 요약', async ({ reply }) => reply(formatShadowStatus(shadowCaseLedger)));
register('/shadow_case', 'Shadow case 상세 요약', async ({ args, reply }) => reply(formatShadowCase(shadowCaseLedger, args[0] ?? '')), '/shadow_case <caseId>');
register('/shadow_symbol', '종목별 Shadow 최근 case', async ({ args, reply }) => reply(formatShadowSymbol(shadowCaseLedger, args[0] ?? '')), '/shadow_symbol <symbol>');
