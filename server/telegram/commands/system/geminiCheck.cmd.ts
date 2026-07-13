// @responsibility /gemini_check — Gemini 연결 live probe(최소 1콜) + 서킷/예산/크레딧 상태 진단(read-only).
import {
  callGeminiText,
  getGeminiRuntimeState,
  getGeminiCircuitStats,
  getBudgetState,
  type GeminiRuntimeState,
} from '../../../clients/geminiClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

export interface GeminiCheckInput {
  probeOk: boolean;
  latencyMs: number;
  runtime: GeminiRuntimeState;
  circuit: { state: string; failures: number; openedAt: number | null };
  budget: { spentUsd: number; budgetUsd: number; pctUsed: number; blocked: boolean };
}

/**
 * 연결 점검 결과 → 표시 라인(순수 함수). 핵심: **Google 크레딧 소진(429 RESOURCE_EXHAUSTED)** 과
 * **내부 월예산 HARD_BLOCK** 을 구분해 표기한다(로그상 실패 원인은 전자였음).
 */
export function formatGeminiCheckLines(input: GeminiCheckInput): string[] {
  const { probeOk, latencyMs, runtime, circuit, budget } = input;
  const reason = runtime.reason ?? '';
  const creditsDepleted = /RESOURCE_EXHAUSTED|credit|quota|\b429\b/i.test(reason);
  let verdict: string;
  if (probeOk) {
    verdict = `✅ 연결 정상 — live probe 성공 (${latencyMs}ms)`;
  } else if (reason === 'MISSING_API_KEY') {
    verdict = '❌ 연결 불가 — GEMINI_API_KEY(또는 API_KEY) 미설정';
  } else if (reason === 'BUDGET_BLOCKED') {
    verdict = `❌ 내부 월예산 HARD_BLOCK — $${budget.spentUsd.toFixed(2)}/$${budget.budgetUsd.toFixed(2)} 호출 차단`;
  } else if (reason === 'CIRCUIT_OPEN') {
    verdict = '❌ 서킷 OPEN — 연속 실패로 일시 차단(쿨다운 후 자동 복귀)';
  } else if (creditsDepleted) {
    verdict = '❌ Google 크레딧 소진(429 RESOURCE_EXHAUSTED) — AI Studio 결제 충전 필요. ※ 내부 월예산과 별개';
  } else {
    verdict = `❌ 연결 실패 — ${reason || 'UNKNOWN'}`;
  }
  return [
    '🤖 <b>Gemini 연결 점검</b> (live probe)',
    verdict,
    `최근 런타임: ${runtime.status}${runtime.reason ? ` (${runtime.reason})` : ''}`,
    `최근시각: ${runtime.updatedAt ?? '-'}`,
    `서킷: ${circuit.state} (실패 ${circuit.failures}회)`,
    `내부 월예산: $${budget.spentUsd.toFixed(2)}/$${budget.budgetUsd.toFixed(2)} (${budget.pctUsed.toFixed(1)}%)${budget.blocked ? ' ⚠️차단' : ''}`,
    'note: 429 RESOURCE_EXHAUSTED = Google 결제 크레딧 문제(내부 월예산과 무관). 수동 패시브 상태는 /ai_status',
  ];
}

const geminiCheck: TelegramCommand = {
  name: '/gemini_check',
  aliases: ['/gemini_ping', '/gemini'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Gemini 연결 live probe(최소 1콜) + 서킷/예산/크레딧 상태 (read-only 진단)',
  async execute({ reply, correlationId }) {
    console.info(`[GEMINI_CHECK_QUERY] correlationId=${correlationId ?? 'N/A'} command=/gemini_check`);
    const t0 = Date.now();
    // 최소 probe — 차단/서킷/키부재 시 callGeminiText 가 실제 호출 없이 null+사유 반환(불필요 비용 0).
    const probe = await callGeminiText('연결 점검입니다. "OK" 한 단어만 답하세요.', {
      caller: 'gemini_check',
      maxOutputTokens: 16,
      temperature: 0,
      prependPersona: false,
    });
    const message = formatGeminiCheckLines({
      probeOk: probe !== null,
      latencyMs: Date.now() - t0,
      runtime: getGeminiRuntimeState(),
      circuit: getGeminiCircuitStats(),
      budget: getBudgetState(),
    }).join('\n');
    await reply(message);
    console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId ?? 'N/A'} command=/gemini_check probeOk=${probe !== null} bytes=${message.length}`);
  },
};

commandRegistry.register(geminiCheck);
