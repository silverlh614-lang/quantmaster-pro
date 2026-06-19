// @responsibility /approve_activation — ADR-0636 운영자 1-클릭 LIVE_ADJACENT_REVIEW lever 승인 활성화 (operator 게이팅·confirm 2단계·영속 record·CH4 통지).
import {
  applyOperatorApproval,
  LEVER_REGISTRY,
} from '../../../trading/selfValidationAutoActivationAdr0633.js';
import { recordApproval } from '../../../persistence/autoActivationApprovalRepo.js';
import { resolveActivationPermission } from './activationPermission.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { CommandContext, TelegramCommand } from '../_types.js';

/**
 * operator 게이팅 — resolveActivationPermission (ADR-0636 addendum):
 * allowlist 우선, 미설정 시 소유자 chat(TELEGRAM_CHAT_ID) fallback. 신규 ENV 0.
 */
function isOperator(ctx: Pick<CommandContext, 'userId' | 'chatId'>): boolean {
  return resolveActivationPermission(ctx);
}

/** lever 검토 evidence + confirm 안내 (mutate 0). */
function formatConfirmPrompt(leverId: string): string {
  const lever = LEVER_REGISTRY.find((l) => l.leverId === leverId);
  if (!lever) {
    return [
      '<b>[승인 활성화 — 미등재]</b>',
      `leverId=${leverId} registry 미등재 — 승인 불가.`,
      'mutation=false',
      'executionImpact=NONE',
    ].join('\n');
  }
  return [
    '<b>[승인 활성화 — 확인 필요]</b>',
    `leverId: ${lever.leverId}`,
    `envName: ${lever.envName}`,
    `eligibility: ${lever.eligibility}`,
    `rationale: ${lever.rationale}`,
    '',
    '경고: 승인 시 LIVE-인접 동작이 변경됩니다 (운영자 1-체크포인트).',
    'mutation=false (확인 단계)',
    'executionImpact=NONE',
    '',
    `확인: /approve_activation ${lever.leverId} confirm`,
  ].join('\n');
}

const approveActivation: TelegramCommand = {
  name: '/approve_activation',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: 'ADR-0636 LIVE_ADJACENT_REVIEW lever 운영자 승인 활성화 (operator·confirm 2단계)',
  usage: '/approve_activation <leverId> confirm',
  async execute(ctx) {
    const { args, reply } = ctx;
    if (!isOperator(ctx)) {
      await reply('UNAUTHORIZED_ACTIVATION_ACTION action=approve executionImpact=NONE');
      return;
    }
    const leverId = args[0];
    if (!leverId) {
      await reply('USAGE: /approve_activation <leverId> confirm');
      return;
    }
    const confirmed = (args[1] ?? '').toLowerCase() === 'confirm';
    if (!confirmed) {
      // 영향경고 + evidence + 확인요청만 — 상태변경 0.
      await reply(formatConfirmPrompt(leverId));
      return;
    }

    // confirm — 엔진 검증(LIVE_ADJACENT_REVIEW 만). 거부 시 process.env·영속 무접촉.
    const approvedBy = ctx.userId ?? 'operator';
    const result = applyOperatorApproval(leverId, approvedBy);
    if (result.verdict !== 'APPROVED') {
      await reply([
        '<b>[승인 활성화 — 거부]</b>',
        `leverId: ${result.leverId}`,
        `verdict: ${result.verdict}`,
        `reason: ${result.reason}`,
        'mutation=false',
        'executionImpact=NONE',
      ].join('\n'));
      return;
    }

    // 영속 기록 — 엔진 검증 통과 후에만.
    recordApproval(leverId, approvedBy);

    // CH4(JOURNAL) 통지 — sendTelegramAlert 미분류 → 기본 JOURNAL/CH4 라우팅. CH2 금지(ADR-0607).
    await sendTelegramAlert(
      [
        '[운영자 승인 활성화 — ADR-0636]',
        `leverId: ${result.leverId}`,
        `envName: ${result.envName ?? 'N/A'}`,
        `verdict: APPROVED`,
        `approvedBy: ${approvedBy}`,
        `reason: ${result.reason}`,
        'executionImpact=NONE',
      ].join('\n'),
      {
        priority: 'NORMAL',
        category: 'operator_activation_approval',
        dedupeKey: `operator_activation:APPROVED:${leverId}`,
        executionImpact: 'NONE',
      },
    );

    await reply([
      '<b>[승인 활성화 — 완료]</b>',
      `leverId: ${result.leverId}`,
      `envName: ${result.envName ?? 'N/A'}`,
      `verdict: APPROVED`,
      `approvedBy: ${approvedBy}`,
      `reason: ${result.reason}`,
      'executionImpact=NONE',
    ].join('\n'));
  },
};

commandRegistry.register(approveActivation);

export default approveActivation;
