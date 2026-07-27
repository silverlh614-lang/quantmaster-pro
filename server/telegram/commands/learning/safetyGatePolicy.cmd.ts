// @responsibility /safety_gate_policy — 안전게이트 사이징 배수 권고 read-only 조회(관측 전용·적용 소비자 0건·live 변경 0).
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { computeSafetyGatePolicyFeedback } from '../../../learning/safetyGatePolicyFeedback.js';

/**
 * preview 산출 — ENV OFF(기본)에서도 "켰다면 어떤 배수가 될지" 보여준다.
 * 값 산출만 우회하며 적용 경로는 만들지 않는다(사이징 소비자 0건 — 본 명령은 표시 전용).
 */
function buildLines(): string[] {
  const fb = computeSafetyGatePolicyFeedback(new Date(), undefined, { ignoreEnvGate: true });
  const applied = fb.envEnabled;
  const lines = [
    '🛡️ SafetyGate 사이징 배수 권고 (관측 전용)',
    `- ENV SAFETY_GATE_POLICY_FEEDBACK_ENABLED: ${applied ? 'ON' : 'OFF'} · 실제 사이징 적용: NO (소비자 0건·executionImpact=NONE)`,
    `- 권고 배수: ${fb.multiplier.toFixed(3)}× ${applied ? '' : '(preview — 켰다면 산출될 값)'}`.trimEnd(),
    `- actionable: ${fb.active ? 'YES' : 'NO'} · 표본: ${fb.sampleSize}`,
    '- 사유:',
    ...fb.reasons.map((r) => `  · ${r}`),
    '',
    '※ 배수<1 = 게이트가 손실 방어 중(보수적 축소 권고) / >1 = 과보호로 승자 놓침(완화 권고).',
    '※ 실 사이징 반영은 운영자 검증 후 별도 PR — 본 명령은 표시만 한다.',
  ];
  return lines;
}

const safetyGatePolicy: TelegramCommand = {
  name: '/safety_gate_policy',
  aliases: ['/safety_gate_feedback'],
  category: 'LRN',
  visibility: 'HIDDEN',
  riskLevel: 0,
  description: '안전게이트 사후효과 → 사이징 배수 권고 (관측 전용, 실제 적용 0)',
  usage: '/safety_gate_policy',
  async execute({ reply, correlationId }) {
    console.info(`[SAFETY_GATE_POLICY_QUERY] correlationId=${correlationId ?? 'N/A'} command=/safety_gate_policy`);
    try {
      const message = buildLines().join('\n');
      await reply(message);
      console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId ?? 'N/A'} command=/safety_gate_policy bytes=${message.length}`);
    } catch (error) {
      await reply(`SAFETY_GATE_POLICY_FAILED: ${error instanceof Error ? error.message : String(error)}\nexecutionImpact=NONE`);
    }
  },
};

commandRegistry.register(safetyGatePolicy);

export default safetyGatePolicy;
