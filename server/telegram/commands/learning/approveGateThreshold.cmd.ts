// @responsibility /approve_gate_threshold — counterfacture_gate Phase L operator 승인 명령(Phase C 권고→Phase D store 기록·apply flag 별개·live 변경 0).
import { commandRegistry } from '../../commandRegistry.js';
import type { CommandContext, TelegramCommand } from '../_types.js';
import { approveGateThresholdFromRecommendation } from '../../../learning/gateThresholdApproval.js';
import { listGateLearnedThresholds } from '../../../persistence/gateLearnedThresholdRepo.js';
import { isCounterfactureGateApplyEnabled } from '../../../learning/gateLearnedThresholdApply.js';

function splitIds(value: string | undefined): string[] {
  return (value ?? '').split(',').map((v) => v.trim()).filter(Boolean);
}

/**
 * /promote_learning 과 동일 인가 정책 — TELEGRAM_ADMIN_USER_IDS 설정 시 화이트리스트 강제,
 * 미설정 시 webhookHandler 전역 chat 게이트(TELEGRAM_CHAT_ID)에 위임(단일 소유자 봇).
 */
export function resolveApproveGatePermission(ctx: Pick<CommandContext, 'userId'>): boolean {
  const adminIds = splitIds(process.env.TELEGRAM_ADMIN_USER_IDS);
  if (!adminIds.length) return true;
  return !!ctx.userId && adminIds.includes(ctx.userId);
}

/** KST 타임스탬프(호출자 stamp — 순수 모듈은 Date 미사용 정책 정합). */
function kstStamp(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ') + ' KST';
}

function formatStatus(): string {
  const entries = listGateLearnedThresholds();
  const flag = isCounterfactureGateApplyEnabled();
  const lines = [
    '[Gate Threshold 승인 store · counterfacture_gate Phase D]',
    `COUNTERFACTURE_GATE_APPLY_ENABLED: ${flag ? 'ON' : 'OFF'} (승인분이 있어도 이 flag + /promote_learning apply 없으면 byte-identical 70)`,
    entries.length ? `승인분 ${entries.length}건 (최신순):` : '승인분 없음 — /gate_threshold_reco 로 권고 확인 후 승인.',
  ];
  for (const e of entries.slice(-12).reverse()) {
    lines.push(`  ${e.gate}/${e.regime}: ${e.approvedThreshold} (×${e.scale}, ${e.basis.decision}, n=${e.basis.sampleSize}, by ${e.approvedBy} @ ${e.approvedAtKst})`);
  }
  lines.push('승인: /approve_gate_threshold GATE1 <REGIME> · 상태: /approve_gate_threshold status');
  return lines.join('\n');
}

const approveGateThreshold: TelegramCommand = {
  name: '/approve_gate_threshold',
  aliases: ['/gate_threshold_approve'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: 'counterfacture_gate Phase C 권고를 Phase D 승인 store 에 기록 (operator 명시 승인·apply flag 별개·live 0)',
  usage: '/approve_gate_threshold [status | GATE1 <REGIME>]',
  async execute(ctx) {
    const { args, reply } = ctx;
    const sub = (args[0] ?? 'status').toLowerCase();
    try {
      if (sub === 'status' || !args.length) {
        return reply(formatStatus());
      }
      if (!resolveApproveGatePermission(ctx)) {
        return reply('UNAUTHORIZED_APPROVE_GATE_THRESHOLD executionImpact=NONE');
      }
      const gate = args[0].toUpperCase();
      if (gate !== 'GATE1') {
        return reply('지원 게이트: GATE1 (유일한 apply 경로). 사용법: /approve_gate_threshold GATE1 <REGIME>');
      }
      const regime = (args[1] ?? '').toUpperCase();
      if (!regime) {
        return reply('REGIME 필요. 사용법: /approve_gate_threshold GATE1 <REGIME> (예: R2_BULL) · 권고는 /gate_threshold_reco');
      }
      const result = await approveGateThresholdFromRecommendation({
        gate: 'GATE1',
        regime,
        approvedBy: ctx.userId ?? 'operator',
        approvedAtKst: kstStamp(),
      });
      if (!result.approved) {
        return reply([
          `[Gate Threshold 승인 거부] ${result.gate}/${result.regime}`,
          result.reason,
          '권고 확인: /gate_threshold_reco (actionable tighten/loosen·≥30표본만 승인 가능)',
        ].join('\n'));
      }
      const e = result.entry as NonNullable<typeof result.entry>;
      return reply([
        `[Gate Threshold 승인 기록] ${e.gate}/${e.regime}`,
        `approvedThreshold=${e.approvedThreshold} (×${e.scale}) · ${e.basis.decision} · n=${e.basis.sampleSize} (W${e.basis.winSample}/L${e.basis.lossSample})`,
        '※ 기록만으로는 live 무변경(executionImpact=NONE). 반영엔 COUNTERFACTURE_GATE_APPLY_ENABLED=true + /promote_learning apply 필요.',
        '※ 적용 시에도 [regime floor, 70] clamp — anchor 70 위로 못 올라감.',
        'revert: /promote_learning revert · 상태: /approve_gate_threshold status',
      ].join('\n'));
    } catch (error) {
      return reply(`APPROVE_GATE_THRESHOLD_FAILED: ${error instanceof Error ? error.message : String(error)}\nexecutionImpact=NONE`);
    }
  },
};

commandRegistry.register(approveGateThreshold);

export default approveGateThreshold;
