/**
 * @responsibility 오늘 실현(전량+부분) 서사를 Gemini 에 주입해 dailyVerdict JSON 을 받는다
 *
 * PR-16: 부분매도 실현도 narrative 에 포함 — 이익 누락 편향 방지.
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
import {
  getWeightedPnlPct,
  isActiveFill,
  type ServerShadowTrade,
  type PositionFill,
} from '../../persistence/shadowTradeRepo.js';
import type { IncidentEntry } from '../../persistence/incidentLogRepo.js';
import type { ServerAttributionRecord } from '../../persistence/attributionRepo.js';

export interface MainReflectionInputs {
  date: string;                 // YYYY-MM-DD KST
  closedTrades: ServerShadowTrade[];
  /**
   * PR-16: ACTIVE 포지션이 오늘 부분매도(SELL fill) 로 이익·손실을 실현한 경우.
   * 전량 청산 아님 — trade.status 는 ACTIVE 유지. 학습 narrative 에 필수 포함.
   */
  partialRealizationsToday?: Array<{
    trade: ServerShadowTrade;
    todaysSells: PositionFill[];
  }>;
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
- dailyVerdict 결정 기준 (fill-level 집계 기반):
   · 실현 이벤트 0건 → SILENT
   · 가중 P&L ≥ 0 & 승 fill ≥ 손 fill & 사고 없음 → GOOD_DAY
   · 가중 P&L < 0 & 손 fill > 승 fill → BAD_DAY
   · 그 외 (부분 익절 + 전량 손절 혼재 등) → MIXED
- 부분매도(부분 익절) 는 trade.status 가 ACTIVE 여도 "오늘의 실현" 에 포함된다.
  "손실만 있었다" 고 단정 짓지 말고 각 실현 항목 부호와 가중 P&L 부호를 그대로 따라 서술하라.
`.trim();

/** 오늘(KST) fill 단위 집계 — closed + partial 을 전부 모은 후 Gemini 가 편향 없이 읽도록 서사화. */
function formatNarrativeInput(inputs: MainReflectionInputs): string {
  const partial = inputs.partialRealizationsToday ?? [];

  // 전량 청산 trade 의 오늘자 sell fill 합계 (보통 1건, 트랜치 여러 개일 수 있음).
  const closedWins: string[] = [];
  const closedLosses: string[] = [];
  let fillWins = 0;
  let fillLosses = 0;
  let weightedNum = 0;
  let weightedDen = 0;
  let totalKrw = 0;

  for (const t of inputs.closedTrades) {
    const fills = (t.fills ?? []).filter((f) =>
      f.type === 'SELL' && isActiveFill(f) && (f.status === 'CONFIRMED' || f.status === undefined),
    );
    const pct = getWeightedPnlPct(t);
    const sumPnl = fills.reduce((s, f) => s + (f.pnl ?? 0), 0);
    totalKrw += sumPnl;
    for (const f of fills) {
      if ((f.pnl ?? 0) > 0) fillWins++;
      else if ((f.pnl ?? 0) < 0) fillLosses++;
      weightedNum += (f.pnlPct ?? 0) * f.qty;
      weightedDen += f.qty;
    }
    const line = `- [${t.status === 'HIT_TARGET' ? '전량익절' : '전량손절'}:${t.id}] ${t.stockName}(${t.stockCode}) ${pct.toFixed(2)}% ${Math.round(sumPnl).toLocaleString()}원 rule=${t.exitRuleTag ?? 'N/A'}`;
    if (t.status === 'HIT_TARGET') closedWins.push(line);
    else closedLosses.push(line);
  }

  // 부분매도 (ACTIVE) — 오늘 CONFIRMED SELL fill 만.
  const partialLines: string[] = [];
  for (const p of partial) {
    const totalQty = p.todaysSells.reduce((s, f) => s + f.qty, 0);
    const pct = totalQty > 0
      ? p.todaysSells.reduce((s, f) => s + (f.pnlPct ?? 0) * f.qty, 0) / totalQty
      : 0;
    const sumPnl = p.todaysSells.reduce((s, f) => s + (f.pnl ?? 0), 0);
    totalKrw += sumPnl;
    for (const f of p.todaysSells) {
      if ((f.pnl ?? 0) > 0) fillWins++;
      else if ((f.pnl ?? 0) < 0) fillLosses++;
      weightedNum += (f.pnlPct ?? 0) * f.qty;
      weightedDen += f.qty;
    }
    const label = pct >= 0 ? '부분익절' : '부분손절';
    partialLines.push(`- [${label}:${p.trade.id}] ${p.trade.stockName}(${p.trade.stockCode}) ${pct.toFixed(2)}% ${Math.round(sumPnl).toLocaleString()}원 (${p.todaysSells.length}회 tranche)`);
  }

  const weightedPct = weightedDen > 0 ? weightedNum / weightedDen : 0;

  const incidentLines = inputs.incidentsToday.map((i) =>
    `- [사건:${i.at}] ${i.severity} ${i.source} — ${i.reason}`,
  );
  const missedLines = inputs.missedSignals.map((m) =>
    `- [놓침:${m.stockCode}] ${m.reason}`,
  );

  return [
    `## 오늘의 서사 (${inputs.date} KST)`,
    '',
    `실현 이벤트: 총 ${fillWins + fillLosses}건 (익 ${fillWins} / 손 ${fillLosses})`,
    `  · 전량 청산 ${inputs.closedTrades.length}건 (익절 ${closedWins.length} / 손절 ${closedLosses.length})`,
    `  · 부분매도 ${partial.length}건`,
    `가중 평균 P&L: ${weightedPct >= 0 ? '+' : ''}${weightedPct.toFixed(2)}%  |  실현 원화 합계: ${Math.round(totalKrw).toLocaleString()}원`,
    `당일 사건: ${inputs.incidentsToday.length}건`,
    `놓친 신호: ${inputs.missedSignals.length}건`,
    '',
    '### 상세 (부호를 그대로 따라 서술할 것)',
    ...closedWins,
    ...closedLosses,
    ...partialLines,
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
