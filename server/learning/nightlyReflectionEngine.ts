/**
 * nightlyReflectionEngine.ts — R(t) 티어: 매일 밤 자기반성 엔진.
 *
 * 실행 시각: 매일 KST 19:00 (UTC 10:00).
 *
 * 현재 Phase 2 (Core Engine — 기능 1~5):
 *   - ① 메인 JSON 스키마 응답 (mainReflection.generateMainReflection)
 *   - ② Five-Why — 손절 건별 순차 심문 (reflectionModules/fiveWhy)
 *   - ③ Counterfactual Simulator — Miss/Early Exit/Late Stop
 *   - ④ Persona Round-Table — 4 페르소나 독립 평가
 *   - ⑤ Tomorrow Priming Brief — 내일 아침 브리핑 상단 주입
 *
 * Budget Governor / Silence Monday / Integrity Guard 는 Phase 1 에서 통합.
 *
 * 호출:
 *   - cron (server/scheduler/learningJobs.ts) 매일 KST 19:00
 *   - 수동 (/api 또는 CLI) — runNightlyReflection({ now: Date })
 */

import {
  loadReflection,
  saveReflection,
  saveTomorrowPriming,
} from '../persistence/reflectionRepo.js';
import {
  decideReflectionMode,
  markReflectionRun,
  maxGeminiCalls,
  recordReflectionCall,
} from './reflectionBudget.js';
import { applyIntegrityGuard } from './reflectionIntegrity.js';
import type {
  ReflectionReport,
  ReflectionMode,
  TomorrowPriming,
  TraceableClaim,
  FiveWhyResult,
  PersonaReviewSummary,
  CounterfactualBreakdown,
} from './reflectionTypes.js';

import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { listIncidents } from '../persistence/incidentLogRepo.js';
import { loadCurrentSchemaRecords } from '../persistence/attributionRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';

import { generateMainReflection, buildShortNarrative } from './reflectionModules/mainReflection.js';
import { runFiveWhyFor } from './reflectionModules/fiveWhy.js';
import { runPersonaRoundTable } from './reflectionModules/personaRoundTable.js';
import { computeCounterfactual } from './reflectionModules/counterfactual.js';
import { buildConditionConfession, findChronicConfessions } from './reflectionModules/conditionConfession.js';
import { quantifyRegret } from './reflectionModules/regretQuantifier.js';
import { computeBiasHeatmap, findChronicBiases } from './reflectionModules/biasHeatmap.js';
import { proposeExperiments, promoteYellowExperiments } from './reflectionModules/experimentProposal.js';
import { generateSystemNarrative } from './reflectionModules/narrativeGenerator.js';
import { enqueueMissedSignals, compareGhostVsReal } from './ghostPortfolioTracker.js';
import {
  loadRecentReflections,
  appendBiasHeatmap,
  loadBiasHeatmap,
} from '../persistence/reflectionRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

export interface RunReflectionOptions {
  /** 기준 시각 (테스트 주입용). 기본값: Date.now() */
  now?: Date;
  /** 이미 있어도 재생성. 기본 false. */
  force?: boolean;
  /** Gemini 호출 전면 skip (테스트용) */
  disableGemini?: boolean;
}

export interface RunReflectionResult {
  date:     string;
  mode:     ReflectionMode;
  executed: boolean;
  skipped?: 'ALREADY_EXISTS' | 'SILENCE_MONDAY' | 'TEMPLATE_FALLBACK';
  report?:  ReflectionReport;
  /** Gemini 호출에 소비된 대략 토큰 수 (비용 추적용) */
  tokensUsed?: number;
}

// ── KST 날짜 유틸 ─────────────────────────────────────────────────────────────

function kstDate(now: Date): string {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 10);
}

function tomorrowKst(dateKst: string): string {
  const [y, m, d] = dateKst.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/** exitTime/closedAt ISO 값이 주어진 KST 날짜에 해당하는지 판정. */
function isoInKstDate(iso: string | undefined, dateKst: string): boolean {
  if (!iso) return false;
  const kstMs = new Date(iso).getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 10) === dateKst;
}

// ── Phase 2 — 실제 데이터 수집 ────────────────────────────────────────────────

export interface ReflectionInputs {
  date: string;
  /** 오늘 종료된 shadow trades (전체 객체 — 5-Why·Persona·Counterfactual 입력) */
  closedTrades: ReturnType<typeof loadShadowTrades>;
  /** 오늘 부착된 attribution 레코드 */
  attributionToday: ReturnType<typeof loadCurrentSchemaRecords>;
  /** 오늘의 incident (CRITICAL/HIGH/WARN 포함) */
  incidentsToday: ReturnType<typeof listIncidents>;
  /** 워치리스트 중 아직 진입 없음 — "놓친 신호" 후보 */
  missedSignals: Array<{ stockCode: string; reason: string }>;
  /** Integrity Guard 가 claim 검증에 사용 */
  knownSourceIds: Set<string>;
}

export function collectInputs(date: string): ReflectionInputs {
  const allTrades = loadShadowTrades();
  const closedTrades = allTrades.filter(
    (t) => (t.status === 'HIT_TARGET' || t.status === 'HIT_STOP') && isoInKstDate(t.exitTime, date),
  );

  const attribution = loadCurrentSchemaRecords().filter((r) => isoInKstDate(r.closedAt, date));
  const incidentsToday = listIncidents(200).filter((i) => isoInKstDate(i.at, date));

  // "놓친 신호" — 오늘 워치리스트에는 있으나 오늘 진입/결산 흔적이 없는 종목.
  const watchlist = loadWatchlist();
  const enteredOrClosedCodes = new Set(
    allTrades
      .filter((t) => isoInKstDate(t.signalTime, date) || isoInKstDate(t.exitTime, date))
      .map((t) => t.stockCode),
  );
  const missedSignals = watchlist
    .filter((w) => !enteredOrClosedCodes.has(w.code))
    .slice(0, 20) // 상한 — 과도한 nois 방지
    .map((w) => ({ stockCode: w.code, reason: 'WATCHLIST_NOT_ENTERED' }));

  // Integrity Guard 원천 집합 조립.
  const knownSourceIds = new Set<string>();
  for (const t of closedTrades) knownSourceIds.add(t.id);
  for (const r of attribution) knownSourceIds.add(r.tradeId);
  for (const i of incidentsToday) knownSourceIds.add(i.at);
  for (const m of missedSignals) knownSourceIds.add(m.stockCode);

  return { date, closedTrades, attributionToday: attribution, incidentsToday, missedSignals, knownSourceIds };
}

// ── 시스템 pseudo source (Integrity Guard 통과) ─────────────────────────────
const SYSTEM_SOURCE = {
  silenceMonday: 'system:silence_monday',
  templateOnly:  'system:template_only',
  noData:        'system:no_data',
  fallback:      'system:gemini_fallback',
} as const;

function buildTemplateReport(
  date: string,
  mode: ReflectionMode,
  inputs: ReflectionInputs,
  reason: 'SILENCE_MONDAY' | 'TEMPLATE_ONLY' | 'GEMINI_FALLBACK' = 'TEMPLATE_ONLY',
): ReflectionReport {
  const dailyVerdict =
    inputs.closedTrades.length === 0 && inputs.incidentsToday.length === 0 ? 'SILENT' : 'MIXED';

  const keyLessons: TraceableClaim[] = [];
  if (reason === 'SILENCE_MONDAY') {
    keyLessons.push({
      text: '월요일 침묵 — 주말 축적된 반성 소화를 위해 엔진 비활성 (#16 Silence Monday).',
      sourceIds: [SYSTEM_SOURCE.silenceMonday],
    });
    inputs.knownSourceIds.add(SYSTEM_SOURCE.silenceMonday);
  } else if (reason === 'TEMPLATE_ONLY') {
    keyLessons.push({
      text: 'Gemini 예산 한도 도달 — 로컬 템플릿 반성으로 전환 (#15 Budget Governor).',
      sourceIds: [SYSTEM_SOURCE.templateOnly],
    });
    inputs.knownSourceIds.add(SYSTEM_SOURCE.templateOnly);
  } else {
    keyLessons.push({
      text: 'Gemini 응답 실패 — 템플릿 fallback 으로 하루 리포트 보존.',
      sourceIds: [SYSTEM_SOURCE.fallback],
    });
    inputs.knownSourceIds.add(SYSTEM_SOURCE.fallback);
  }

  return {
    date,
    generatedAt: new Date().toISOString(),
    dailyVerdict,
    keyLessons,
    questionableDecisions: [],
    tomorrowAdjustments: [],
    followUpActions: [],
    mode,
  };
}

// ── 메인 진입점 ──────────────────────────────────────────────────────────────

export async function runNightlyReflection(
  opts: RunReflectionOptions = {},
): Promise<RunReflectionResult> {
  const now = opts.now ?? new Date();
  const date = kstDate(now);

  if (!opts.force) {
    const existing = loadReflection(date);
    if (existing) {
      return {
        date,
        mode: existing.mode ?? 'FULL',
        executed: false,
        skipped: 'ALREADY_EXISTS',
        report: existing,
      };
    }
  }

  const mode = decideReflectionMode(date);
  const inputs = collectInputs(date);
  const callsBudget = maxGeminiCalls(mode);
  const geminiDisabled = opts.disableGemini === true;
  let tokensUsed = 0;
  let callsSpent = 0;
  const trackCall = (tokens: number) => {
    tokensUsed += Math.max(0, tokens);
    callsSpent++;
  };

  let report: ReflectionReport;

  if (mode === 'SILENCE_MONDAY') {
    report = buildTemplateReport(date, mode, inputs, 'SILENCE_MONDAY');
  } else if (mode === 'TEMPLATE_ONLY' || geminiDisabled || callsBudget === 0) {
    report = buildTemplateReport(date, mode, inputs, 'TEMPLATE_ONLY');
  } else {
    // ── Gemini 메인 반성 (1 call) ─────────────────────────────────────────
    const mainInput = {
      date,
      closedTrades: inputs.closedTrades,
      attributionToday: inputs.attributionToday,
      incidentsToday: inputs.incidentsToday,
      missedSignals: inputs.missedSignals,
    };
    const main = await generateMainReflection(mainInput).catch(() => null);
    trackCall(1500); // 메인 프롬프트 대략치

    if (!main) {
      report = buildTemplateReport(date, mode, inputs, 'GEMINI_FALLBACK');
      report.integrity = { claimsIn: 0, claimsOut: 0, removed: [], parseFailed: true };
    } else {
      report = {
        date,
        generatedAt: new Date().toISOString(),
        dailyVerdict: (main.dailyVerdict ?? 'MIXED') as ReflectionReport['dailyVerdict'],
        keyLessons: main.keyLessons ?? [],
        questionableDecisions: main.questionableDecisions ?? [],
        tomorrowAdjustments: main.tomorrowAdjustments ?? [],
        followUpActions: main.followUpActions ?? [],
        mode,
      };
    }

    // ── Persona Round-Table (우선순위 1 — 스펙 순서: 메인 다음 페르소나) ──
    const primaryTrade = inputs.closedTrades[0];
    if (primaryTrade) {
      const remain = callsBudget - callsSpent;
      if (remain >= 1) {
        const personaSummary = await runPersonaRoundTable(primaryTrade, {
          maxGeminiCalls: remain,
          onCall: trackCall,
        });
        if (personaSummary) report.personaReview = personaSummary;
      }
    }

    // ── 5-Why (손절 거래만, 남은 예산 범위 내) ─────────────────────────────
    const stopLossTrades = inputs.closedTrades.filter((t) => t.status === 'HIT_STOP');
    const fiveWhyResults: FiveWhyResult[] = [];
    for (const t of stopLossTrades) {
      const remain = callsBudget - callsSpent;
      if (remain < 1) break;
      const res = await runFiveWhyFor(t, { maxGeminiCalls: remain, onCall: trackCall });
      if (res) fiveWhyResults.push(res);
    }
    if (fiveWhyResults.length > 0) report.fiveWhy = fiveWhyResults;

    // ── Counterfactual Simulator (Gemini 호출 없음) ─────────────────────────
    const counterfactual: CounterfactualBreakdown = await computeCounterfactual({
      closedToday: inputs.closedTrades,
      missedSignalCodes: inputs.missedSignals.map((m) => m.stockCode),
      // eodPriceFor 는 Phase 5 인트라데이 통합 시 실제 조회 주입
    });
    report.counterfactual = counterfactual;

    // ── Phase 3 #6 Condition Confession — Gemini 호출 없음 ─────────────────
    const confession = buildConditionConfession(inputs.attributionToday);
    if (confession.length > 0) report.conditionConfession = confession;

    // 3일 연속 만성 참회 조건 → followUpActions 에 PROBATION 제안 자동 기록.
    const prior2 = loadRecentReflections(3).filter((r) => r.date < date).slice(-2);
    const recent3 = [...prior2, { conditionConfession: confession }];
    const chronic = findChronicConfessions(recent3);
    if (chronic.length > 0) {
      const sourceIds = confession.map((c) => `cond:${c.conditionId}`);
      for (const id of chronic) inputs.knownSourceIds.add(`cond:${id}`);
      report.followUpActions = [
        ...(report.followUpActions ?? []),
        {
          text: `만성 참회 조건 ${chronic.join(', ')} — conditionAuditor PROBATION 제안 검토.`,
          sourceIds: sourceIds.length > 0 ? sourceIds : chronic.map((id) => `cond:${id}`),
        },
      ];
    }

    // ── Phase 3 #8 Regret Quantifier — Gemini 호출 없음 ────────────────────
    const stopTrades = inputs.closedTrades.filter((t) => t.status === 'HIT_STOP');
    if (stopTrades.length > 0) {
      report.regret = await quantifyRegret({ stopLossTrades: stopTrades });
    }

    // ── Phase 4 #11 Bias Heatmap — Gemini 호출 없음 ────────────────────────
    const macro = loadMacroState();
    const activePositions = loadShadowTrades().filter((t) => t.status === 'ACTIVE');
    const biasScores = computeBiasHeatmap({
      activePositions,
      closedToday: inputs.closedTrades,
      attributionToday: inputs.attributionToday,
      missedSignalCount: inputs.missedSignals.length,
      currentRegime: macro?.regime,
      watchlistCount: inputs.missedSignals.length, // proxy — watchlist 접근 없이 근사
      availableSlots: Math.max(0, 10 - activePositions.length), // 기본 10 슬롯 가정
    });
    appendBiasHeatmap({ date, scores: biasScores });

    // 3일 연속 ≥ 0.70 편향 → followUpActions 기록
    const recentBias3 = loadBiasHeatmap().filter((e) => e.date <= date).slice(-3);
    const chronicBias = findChronicBiases(recentBias3);
    if (chronicBias.length > 0) {
      for (const bias of chronicBias) inputs.knownSourceIds.add(`bias:${bias}`);
      report.followUpActions = [
        ...(report.followUpActions ?? []),
        {
          text: `3일 연속 편향 발동: ${chronicBias.join(', ')} — 행동 체크리스트 재검토.`,
          sourceIds: chronicBias.map((b) => `bias:${b}`),
        },
      ];
    }

    // ── Phase 4 #12 Experiment Proposal ──────────────────────────────────────
    const totalClosed = inputs.closedTrades.length;
    const lossRatio = totalClosed > 0
      ? inputs.closedTrades.filter((t) => t.status === 'HIT_STOP').length / totalClosed
      : 0;
    const proposals = proposeExperiments({
      chronicConditions: chronic,
      confession,
      lossRatio,
    });
    if (proposals.length > 0) {
      for (const p of proposals) inputs.knownSourceIds.add(`exp:${p.id}`);
      report.followUpActions = [
        ...(report.followUpActions ?? []),
        ...proposals.map((p) => ({
          text: `[실험] ${p.track === 'YELLOW_AUTO' ? '🟡' : '🔴'} ${p.hypothesis}`,
          sourceIds: [`exp:${p.id}`],
        })),
      ];
    }
    // 전일 제안 중 autoStartAt 경과 YELLOW → AUTO_STARTED 승격
    promoteYellowExperiments(now);
  }

  // Integrity Guard — 시스템 pseudo source 항상 포함. 파싱 실패 플래그 보존.
  for (const v of Object.values(SYSTEM_SOURCE)) inputs.knownSourceIds.add(v);
  const priorParseFailed = report.integrity?.parseFailed === true;
  applyIntegrityGuard(report, inputs.knownSourceIds, { parseFailed: priorParseFailed });

  // Phase 4 #13 — Gemini 기반 200~300자 서사. 예산 남을 때만.
  if (mode !== 'SILENCE_MONDAY' && mode !== 'TEMPLATE_ONLY' && !geminiDisabled) {
    const remain = callsBudget - callsSpent;
    if (remain >= 1) {
      const macro = loadMacroState();
      const ghostCmp = compareGhostVsReal(0); // 실제 수익률 주입 없음 → 중립 verdict
      const richNarrative = await generateSystemNarrative(report, {
        regime: macro?.regime,
        ghostVerdict: ghostCmp.ghostCount > 0 ? `${ghostCmp.verdict} (ghost ${ghostCmp.ghostAvgReturnPct}%)` : undefined,
      }, { maxGeminiCalls: remain, onCall: trackCall });
      if (richNarrative) report.narrative = richNarrative;
    }
  }
  // fallback — Gemini 실패 / 비활성 시 템플릿
  if (!report.narrative) {
    report.narrative = buildShortNarrative(
      date,
      report.dailyVerdict,
      mode,
      report.keyLessons,
      report.tomorrowAdjustments,
    );
  }

  saveReflection(report);
  markReflectionRun(date);
  if (callsSpent > 0) recordReflectionCall(date, tokensUsed);
  saveTomorrowPriming(buildPriming(date, report));

  // Phase 3 #9 — 오늘 놓친 신호를 Ghost Portfolio 에 등록 (30일 추적 큐).
  // signalPriceKrw 를 알 수 없으면 0 으로 등록 → refreshGhostPortfolio 에서 skip.
  if (inputs.missedSignals.length > 0) {
    try {
      enqueueMissedSignals(inputs.missedSignals.map((m) => ({
        stockCode:      m.stockCode,
        stockName:      m.stockCode, // 이름 모를 경우 code 로 대체 — refresh 때 갱신 가능
        signalDate:     date,
        signalPriceKrw: 0,
        rejectionReason: m.reason,
      })));
    } catch (e: unknown) {
      console.warn('[NightlyReflection] Ghost Portfolio 등록 실패:', e instanceof Error ? e.message : e);
    }
  }

  // Telegram T2 — 200~300자 서사 1건. 모드 상관없이 매일 발송.
  await dispatchReflectionTelegram(report).catch((e: unknown) => {
    console.error('[NightlyReflection] Telegram 발송 실패:', e instanceof Error ? e.message : e);
  });

  return { date, mode, executed: true, report, tokensUsed };
}

async function dispatchReflectionTelegram(report: ReflectionReport): Promise<void> {
  const header = `🌙 <b>[자기반성] ${report.date}</b>`;
  const body = report.narrative ?? `${report.dailyVerdict}${report.mode ? ` (${report.mode})` : ''}`;
  const lesson = report.keyLessons[0]?.text
    ? `\n💡 ${report.keyLessons[0].text}`
    : '';
  const adjust = report.tomorrowAdjustments[0]?.text
    ? `\n🔧 내일 조정: ${report.tomorrowAdjustments[0].text}`
    : '';
  const msg = `${header}\n${body}${lesson}${adjust}`;
  await sendTelegramAlert(msg, { tier: 'T2_REPORT', category: 'nightly_reflection' });
}

// ── Tomorrow Priming 조립 ────────────────────────────────────────────────────

function buildPriming(dateKst: string, report: ReflectionReport): TomorrowPriming {
  const forDate = tomorrowKst(dateKst);
  const oneLine =
    report.keyLessons[0]?.text
      ?? (report.mode === 'SILENCE_MONDAY'
            ? '오늘은 반성 엔진이 쉬는 날 — 지난 주 누적 교훈 재읽기.'
            : '오늘 유의미한 거래 없음 — 기본 원칙 준수.');
  return {
    forDate,
    producedAt: new Date().toISOString(),
    oneLineLearning: oneLine,
    adjustments: report.tomorrowAdjustments ?? [],
    followUps:   report.followUpActions ?? [],
  };
}

// 테스트용 export — 내부 유틸 접근.
export const __test = { kstDate, tomorrowKst, isoInKstDate, buildTemplateReport, buildPriming };
