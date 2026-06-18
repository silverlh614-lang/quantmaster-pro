// @responsibility /promote_learning ADR-0624 D4 — SHADOW→LIVE 학습 승격 단일 확인 게이트(operator-gated, 미적용 byte-identical).
import { commandRegistry } from '../../commandRegistry.js';
import type { CommandContext, TelegramCommand } from '../_types.js';
import {
  getLearningWeightPromotionPreview,
  registerLearningWeightPromotion,
  unregisterLearningWeightPromotion,
  isLearningWeightPromotionApplied,
} from '../../../learning/learningWeightPromotionApply.js';
import {
  registerCounterfactureGateApply,
  unregisterCounterfactureGateApply,
  isCounterfactureGateApplyEnabled,
} from '../../../learning/gateLearnedThresholdApply.js';

type PromoteAction = 'status' | 'apply' | 'revert';

function splitIds(value: string | undefined): string[] {
  return (value ?? '').split(',').map(v => v.trim()).filter(Boolean);
}

export function resolvePromotePermission(ctx: Pick<CommandContext, 'userId'>, action: PromoteAction): boolean {
  if (action === 'status') return true;
  const userId = ctx.userId;
  const adminIds = splitIds(process.env.TELEGRAM_ADMIN_USER_IDS);
  if (adminIds.length) return !!userId && adminIds.includes(userId);
  if (!userId) return true;
  return userId === 'admin' || userId === 'system';
}

function formatStatus(): string {
  const w = getLearningWeightPromotionPreview('GLOBAL');
  const gateFlag = isCounterfactureGateApplyEnabled();
  const applied = isLearningWeightPromotionApplied();
  const topChanges = w.changes
    .filter(c => Number.isFinite(c.candidate) && Math.abs(c.clamped - c.from) > 1e-9)
    .slice(0, 12)
    .map(c => `  ${c.key}: ${c.from} → ${c.clamped}${c.candidate !== c.clamped ? ` (cand ${c.candidate}, clamped)` : ''}`);
  return [
    '[Learning Promotion · SHADOW→LIVE 단일 게이트]',
    `applied: ${applied ? 'YES (provider 등록됨)' : 'NO (byte-identical)'}`,
    `condition-weights flag(LEARNING_WEIGHT_PROMOTION_ENABLED): ${w.flagEnabled ? 'ON' : 'OFF'}`,
    `gate1-threshold flag(COUNTERFACTURE_GATE_APPLY_ENABLED): ${gateFlag ? 'ON' : 'OFF'}`,
    `candidate weights(GLOBAL): ${w.hasCandidate ? `${w.changes.length}건` : 'none'}`,
    topChanges.length ? '변경 미리보기(clamped):' : '변경 없음(또는 flag OFF로 비활성)',
    ...topChanges,
    'apply = /promote_learning apply (live 가중치 + Gate1 임계 provider 등록) · revert = /promote_learning revert',
    'executionImpact: 미적용 NONE byte-identical / 적용 시 flag ON 분만 live 반영(clamp 적용·revert 가능)',
  ].join('\n');
}

const promoteLearning: TelegramCommand = {
  name: '/promote_learning',
  aliases: ['/learning_promote'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: 'SHADOW→LIVE 학습 승격 단일 확인 게이트 (조건가중치 + Gate1 임계 provider 등록/해제)',
  usage: '/promote_learning [status|apply|revert]',
  async execute(ctx) {
    const { args, reply } = ctx;
    const op = (args[0] ?? 'status').toLowerCase() as PromoteAction;
    try {
      if (op === 'apply' || op === 'revert') {
        if (!resolvePromotePermission(ctx, op)) {
          return reply(`UNAUTHORIZED_PROMOTE_ACTION action=${op} executionImpact=NONE`);
        }
        if (op === 'apply') {
          registerLearningWeightPromotion();
          registerCounterfactureGateApply();
          return reply([
            '[Learning Promotion] APPLIED',
            'condition-weights provider + Gate1 임계 provider 등록됨 (operator 1회 확인).',
            '※ 각 provider 는 자체 ENV flag ON + clamp 충족분만 live 반영 — flag OFF면 등록돼도 byte-identical.',
            'revert = /promote_learning revert (즉시 해제)',
            'executionImpact: flag ON 분 live 반영(clamp 적용·revert 가능).',
          ].join('\n'));
        }
        unregisterLearningWeightPromotion();
        unregisterCounterfactureGateApply();
        return reply('[Learning Promotion] REVERTED — provider 해제, loadConditionWeights/Gate1 임계 byte-identical 복귀.');
      }
      return reply(formatStatus());
    } catch (error) {
      return reply(`PROMOTE_LEARNING_FAILED: ${error instanceof Error ? error.message : String(error)}\nexecutionImpact=NONE`);
    }
  },
};

commandRegistry.register(promoteLearning);

export default promoteLearning;
