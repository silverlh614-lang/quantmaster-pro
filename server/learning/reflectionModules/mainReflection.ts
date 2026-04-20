/**
 * mainReflection.ts — 메인 Gemini 반성 리포트 생성.
 *
 * 1회 Gemini 호출로 "오늘의 서사" → 고정 JSON 스키마 파싱 → Integrity Guard 적용.
 * JSON 실패 시 Template fallback (Integrity audit.parseFailed=true).
 */

import { callReflectionGemini } from './reflectionGemini.js';
import { parseReflectionJson } from '../reflectionIntegrity.js';
import type {
  DailyVerdict,
  ReflectionMode,
  TraceableClaim,
  ReflectionReport,
} from '../reflectionTypes.js';
import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import type { IncidentEntry } from '../../persistence/incidentLogRepo.js';
import type { ServerAttributionRecord } from '../../persistence/attributionRepo.js';

export interface MainReflectionInputs {
  date: string;                 // YYYY-MM-DD KST
  closedTrades: ServerShadowTrade[];
  attributionToday: ServerAttributionRecord[];
  incidentsToday: IncidentEntry[];
  missedSignals: Array<{ stockCode: string; reason: string }>;
}

const SCHEMA_HINT = `
응답은 반드시 다음 JSON 스키마로만 답하라. 다른 텍스트 금지.
{
  "dailyVerdict": "GOOD_DAY" | "MIXED" | "BAD_DAY" | "SILENT",
  "keyLessons":  [ { "text": "1~2문장", "sourceIds": ["<tradeId 또는 incident.at>"] } ],
  "questionableDecisions": [ { "text": "...", "sourceIds": [...] } ],
  "tomorrowAdjustments":   [ { "text": "...", "sourceIds": [...] } ],
  "followUpActions":       [ { "text": "...", "sourceIds": [...] } ]
}

제약:
- 각 항목은 0~5개 이내.
- sourceIds[] 는 반드시 입력으로 제공된 ID 목록에서 고른다. 미존재 ID 를 지어내면 자동 삭제된다.
- dailyVerdict 결정 기준: 손절>익절 → BAD_DAY / 거래 없음 → SILENT / 혼재 → MIXED / 순이익 양수 + 사고 없음 → GOOD_DAY.
`.trim();

function formatNarrativeInput(inputs: MainReflectionInputs): string {
  const wins = inputs.closedTrades.filter((t) => t.status === 'HIT_TARGET');
  const losses = inputs.closedTrades.filter((t) => t.status === 'HIT_STOP');

  const winLines = wins.map((t) =>
    `- [익절:${t.id}] ${t.stockName}(${t.stockCode}) ${(t.returnPct ?? 0).toFixed(2)}%`,
  );
  const lossLines = losses.map((t) =>
    `- [손절:${t.id}] ${t.stockName}(${t.stockCode}) ${(t.returnPct ?? 0).toFixed(2)}% rule=${t.exitRuleTag ?? 'N/A'}`,
  );
  const incidentLines = inputs.incidentsToday.map((i) =>
    `- [사건:${i.at}] ${i.severity} ${i.source} — ${i.reason}`,
  );
  const missedLines = inputs.missedSignals.map((m) =>
    `- [놓침:${m.stockCode}] ${m.reason}`,
  );

  return [
    `## 오늘의 서사 (${inputs.date} KST)`,
    '',
    `종료된 거래: ${inputs.closedTrades.length}건 (익절 ${wins.length} / 손절 ${losses.length})`,
    `당일 사건: ${inputs.incidentsToday.length}건`,
    `놓친 신호: ${inputs.missedSignals.length}건`,
    '',
    '### 상세',
    ...winLines,
    ...lossLines,
    ...incidentLines,
    ...missedLines,
  ].join('\n');
}

/** 메인 반성 리포트 1회 Gemini 호출. 실패 시 null → 템플릿 fallback 유도. */
export async function generateMainReflection(
  inputs: MainReflectionInputs,
): Promise<Partial<ReflectionReport> | null> {
  const narrative = formatNarrativeInput(inputs);
  const prompt = [
    '너는 한국 주식 알고 트레이더의 매일 밤 회고를 돕는다.',
    `오늘은 ${inputs.date} (KST). 아래 사실 데이터만 근거로 한국어로 답하라.`,
    '',
    narrative,
    '',
    SCHEMA_HINT,
  ].join('\n');

  // temperature=0.2 는 callReflectionGemini 내부에서 aiProvider 경유 시 강제.
  const raw = await callReflectionGemini(prompt, 'nightlyReflection.main');
  return parseReflectionJson(raw);
}

/** 200~300자 서사 (System Narrative Generator #13 의 경량 초안 — Phase 4 에서 고도화) */
export function buildShortNarrative(
  date: string,
  verdict: DailyVerdict,
  mode: ReflectionMode,
  lessons: TraceableClaim[],
  adjustments: TraceableClaim[],
): string {
  const emoji = verdict === 'GOOD_DAY' ? '✅' : verdict === 'BAD_DAY' ? '❌' : verdict === 'MIXED' ? '⚖️' : '🌙';
  const lead = `${emoji} ${date} ${verdict}${mode !== 'FULL' ? ` (${mode})` : ''}.`;
  const lesson = lessons[0]?.text ? `오늘의 교훈: ${lessons[0].text}` : '';
  const tomorrow = adjustments[0]?.text ? `내일 조정: ${adjustments[0].text}` : '';
  const body = [lead, lesson, tomorrow].filter(Boolean).join(' ');
  // 300자 상한 트리밍
  return body.length <= 300 ? body : body.slice(0, 297) + '...';
}
