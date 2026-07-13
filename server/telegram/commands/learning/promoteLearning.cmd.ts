// @responsibility /promote_learning ADR-0624 D4 — SHADOW→LIVE 학습 승격 게이트(shadow 즉시·LIVE ENV master 게이트·미적용 byte-identical).
import { commandRegistry } from '../../commandRegistry.js';
import type { CommandContext, TelegramCommand } from '../_types.js';
import {
  getLearningWeightPromotionPreview,
  registerLearningWeightPromotion,
  unregisterLearningWeightPromotion,
} from '../../../learning/learningWeightPromotionApply.js';
import {
  registerCounterfactureGateApply,
  unregisterCounterfactureGateApply,
  isCounterfactureGateApplyEnabled,
} from '../../../learning/gateLearnedThresholdApply.js';
import { getTradingMode } from '../../../state.js';

type PromoteAction = 'status' | 'apply' | 'revert';

function splitIds(value: string | undefined): string[] {
  return (value ?? '').split(',').map(v => v.trim()).filter(Boolean);
}

export function resolvePromotePermission(ctx: Pick<CommandContext, 'userId'>, action: PromoteAction): boolean {
  if (action === 'status') return true;
  // 봇은 webhookHandler 전역 chat 게이트(TELEGRAM_CHAT_ID)로 단일 인가 chat 만 응답한다 — EMR 제어
  // 명령(/unblock_buy·/stop 등)과 동일하게 그 전역 게이트에 위임한다. admin 화이트리스트
  // (TELEGRAM_ADMIN_USER_IDS) 가 명시 설정된 경우에만 추가로 강제(미설정 시 운영자 허용).
  const adminIds = splitIds(process.env.TELEGRAM_ADMIN_USER_IDS);
  if (!adminIds.length) return true;
  return !!ctx.userId && adminIds.includes(ctx.userId);
}

function formatStatus(): string {
  const w = getLearningWeightPromotionPreview('GLOBAL');
  const live = w.tradingMode === 'LIVE';
  const weightsEffective = w.applied && w.hasCandidate && (!live || w.flagEnabled);
  const gateFlag = isCounterfactureGateApplyEnabled();
  const topChanges = w.changes
    .filter(c => Number.isFinite(c.candidate) && Math.abs(c.clamped - c.from) > 1e-9)
    .slice(0, 12)
    .map(c => `  ${c.key}: ${c.from} → ${c.clamped}${c.candidate !== c.clamped ? ` (cand ${c.candidate}, clamped)` : ''}`);
  return [
    '[Learning Promotion · SHADOW→LIVE 단일 게이트]',
    `tradingMode: ${w.tradingMode} · applied: ${w.applied ? 'YES' : 'NO'}`,
    `조건가중치 반영 중: ${weightsEffective ? 'YES (학습 가중치 사용)' : 'NO (byte-identical)'}`,
    `  └ shadow=apply 만으로 즉시 반영 / LIVE=추가로 LEARNING_WEIGHT_PROMOTION_ENABLED 필요(현재 ${w.flagEnabled ? 'ON' : 'OFF'})`,
    `Gate1 임계: ${gateFlag ? 'ON' : 'OFF'} (COUNTERFACTURE_GATE_APPLY_ENABLED — apply 후에도 이 flag 필요)`,
    `candidate weights(GLOBAL): ${w.hasCandidate ? `${w.changes.length}건` : 'none'}`,
    topChanges.length ? '변경 미리보기(clamped):' : '변경 없음',
    ...topChanges,
    'apply = /promote_learning apply · revert = /promote_learning revert',
  ].join('\n');
}

const promoteLearning: TelegramCommand = {
  name: '/promote_learning',
  aliases: ['/learning_promote'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: 'SHADOW→LIVE 학습 승격 게이트 (조건가중치 + Gate1 임계 provider 등록/해제)',
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
          const live = getTradingMode() === 'LIVE';
          return reply([
            '[Learning Promotion] APPLIED',
            `tradingMode: ${getTradingMode()}`,
            live
              ? '※ LIVE 모드: 조건가중치 반영엔 LEARNING_WEIGHT_PROMOTION_ENABLED=true 필요(현재 OFF면 byte-identical · #7 backstop).'
              : '※ SHADOW/PAPER 모드: 조건가중치 즉시 반영(clamp 적용·실돈 영향 0).',
            'Gate1 임계 provider 도 등록 — 단 COUNTERFACTURE_GATE_APPLY_ENABLED=true 여야 반영.',
            'revert = /promote_learning revert (즉시 해제) · 상태 = /promote_learning status',
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
