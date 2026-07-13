// @responsibility /revoke_activation — ADR-0636 운영자 LIVE_ADJACENT_REVIEW lever 승인 철회 (operator 게이팅·confirm 2단계·영속 삭제·CH4 통지·env delete).
import {
  revokeOperatorApproval,
  LEVER_REGISTRY,
} from '../../../trading/selfValidationAutoActivationAdr0633.js';
import { revokeApproval } from '../../../persistence/autoActivationApprovalRepo.js';
import { resolveActivationPermission } from './activationPermission.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { CommandContext, TelegramCommand } from '../_types.js';

/** operator 게이팅 — approve 와 동형 (resolveActivationPermission, 소유자 chat fallback 포함). */
function isOperator(ctx: Pick<CommandContext, 'userId' | 'chatId'>): boolean {
  return resolveActivationPermission(ctx);
}

function formatConfirmPrompt(leverId: string): string {
  const lever = LEVER_REGISTRY.find((l) => l.leverId === leverId);
  if (!lever) {
    return [
      '<b>[승인 철회 — 미등재]</b>',
      `leverId=${leverId} registry 미등재 — 철회 불가.`,
      'mutation=false',
      'executionImpact=NONE',
    ].join('\n');
  }
  return [
    '<b>[승인 철회 — 확인 필요]</b>',
    `leverId: ${lever.leverId}`,
    `envName: ${lever.envName}`,
    '',
    '철회 시 envName 이 미설정 default 로 복귀합니다 (LIVE-인접 동작 비활성).',
    'mutation=false (확인 단계)',
    'executionImpact=NONE',
    '',
    `확인: /revoke_activation ${lever.leverId} confirm`,
  ].join('\n');
}

const revokeActivation: TelegramCommand = {
  name: '/revoke_activation',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: 'ADR-0636 LIVE_ADJACENT_REVIEW lever 운영자 승인 철회 (operator·confirm 2단계)',
  usage: '/revoke_activation <leverId> confirm',
  async execute(ctx) {
    const { args, reply } = ctx;
    if (!isOperator(ctx)) {
      await reply('UNAUTHORIZED_ACTIVATION_ACTION action=revoke executionImpact=NONE');
      return;
    }
    const leverId = args[0];
    if (!leverId) {
      await reply('USAGE: /revoke_activation <leverId> confirm');
      return;
    }
    const confirmed = (args[1] ?? '').toLowerCase() === 'confirm';
    if (!confirmed) {
      await reply(formatConfirmPrompt(leverId));
      return;
    }

    const result = revokeOperatorApproval(leverId);
    if (result.verdict !== 'REVOKED') {
      await reply([
        '<b>[승인 철회 — 거부]</b>',
        `leverId: ${result.leverId}`,
        `verdict: ${result.verdict}`,
        `reason: ${result.reason}`,
        'mutation=false',
        'executionImpact=NONE',
      ].join('\n'));
      return;
    }

    // 영속 삭제 — 엔진 검증 통과 후에만.
    revokeApproval(leverId);

    // CH4(JOURNAL) 통지 — CH2 금지(ADR-0607).
    await sendTelegramAlert(
      [
        '[운영자 승인 철회 — ADR-0636]',
        `leverId: ${result.leverId}`,
        `envName: ${result.envName ?? 'N/A'}`,
        `verdict: REVOKED`,
        `reason: ${result.reason}`,
        'executionImpact=NONE',
      ].join('\n'),
      {
        priority: 'NORMAL',
        category: 'operator_activation_approval',
        dedupeKey: `operator_activation:REVOKED:${leverId}`,
        executionImpact: 'NONE',
      },
    );

    await reply([
      '<b>[승인 철회 — 완료]</b>',
      `leverId: ${result.leverId}`,
      `envName: ${result.envName ?? 'N/A'}`,
      `verdict: REVOKED`,
      `reason: ${result.reason}`,
      'executionImpact=NONE',
    ].join('\n'));
  },
};

commandRegistry.register(revokeActivation);
