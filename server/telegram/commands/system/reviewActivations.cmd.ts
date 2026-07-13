// @responsibility /review_activations — ADR-0636 LIVE_ADJACENT_REVIEW(T2) lever 운영자 검토 board 조회 (활성·승인 상태·승인법 안내). read-only·토글 0.
import {
  LEVER_REGISTRY,
} from '../../../trading/selfValidationAutoActivationAdr0633.js';
import {
  getApproval,
  isApproved,
} from '../../../persistence/autoActivationApprovalRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

/**
 * LIVE_ADJACENT_REVIEW 4종을 always-render skeleton 으로 나열.
 * 각 lever: leverId · envName · 현재 process.env 활성여부 · 승인상태(isApproved/approvedBy/At) · rationale.
 * read-only — process.env·영속 무접촉.
 */
function formatReviewBoard(): string {
  const lines: string[] = [
    '<b>[운영자 검토 활성화 — ADR-0636]</b>',
    'LIVE_ADJACENT_REVIEW(T2) lever — 자동 활성 금지·운영자 1-체크포인트.',
    'executionImpact=NONE (조회 전용)',
    '',
  ];

  const t2Levers = LEVER_REGISTRY.filter((l) => l.eligibility === 'LIVE_ADJACENT_REVIEW');
  if (t2Levers.length === 0) {
    lines.push('LIVE_ADJACENT_REVIEW lever 미등재 (DATA_UNAVAILABLE skeleton).');
  }
  for (const lever of t2Levers) {
    const envActive = process.env[lever.envName] === 'true';
    const approved = isApproved(lever.leverId);
    const entry = getApproval(lever.leverId);
    lines.push(`lever: ${lever.leverId}`);
    lines.push(`- envName: ${lever.envName}`);
    lines.push(`- envActive: ${envActive}`);
    lines.push(`- approved: ${approved}`);
    lines.push(`- approvedBy: ${entry ? entry.approvedBy : 'N/A'}`);
    lines.push(`- approvedAt: ${entry ? entry.approvedAt : 'N/A'}`);
    lines.push(`- rationale: ${lever.rationale}`);
    lines.push('');
  }

  lines.push('승인법: /approve_activation <leverId> confirm');
  lines.push('철회법: /revoke_activation <leverId> confirm');
  return lines.join('\n');
}

const reviewActivations: TelegramCommand = {
  name: '/review_activations',
  category: 'LRN',
  visibility: 'HIDDEN',
  riskLevel: 0,
  description: 'ADR-0636 운영자 검토 활성화 board (LIVE_ADJACENT_REVIEW lever 활성·승인 상태, 조회 전용)',
  async execute({ reply, correlationId }) {
    console.info(`[REVIEW_ACTIVATIONS_QUERY] correlationId=${correlationId ?? 'N/A'} command=/review_activations`);
    const message = formatReviewBoard();
    await reply(message);
    console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId ?? 'N/A'} command=/review_activations bytes=${message.length}`);
  },
};

commandRegistry.register(reviewActivations);
