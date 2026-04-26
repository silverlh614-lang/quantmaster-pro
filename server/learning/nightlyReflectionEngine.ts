/**
 * @responsibility 19:00 KST 반성 엔진 — 전량·부분 실현을 모아 Gemini 서사+페르소나 큐레이션
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

import { loadShadowTrades, isActiveFill, type ServerShadowTrade, type PositionFill } from '../persistence/shadowTradeRepo.js';
import { listIncidents } from '../persistence/incidentLogRepo.js';
import { loadCurrentSchemaRecords } from '../persistence/attributionRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import {
  loadManualExitsForDateKst,
  loadManualExitsWithinDays,
  type ManualExitRecord,
} from '../persistence/manualExitsRepo.js';
import { buildManualExitReview } from './reflectionModules/manualExitReview.js';
import { computeManualFrequencyAxis } from './biasHeatmap.js';

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
import { getGeminiRuntimeState } from '../clients/geminiClient.js';
import { isKstWeekend } from '../utils/marketClock.js';
import { recordReflectionImpactsFromReport } from './reflectionImpactRecorder.js';
import { isKrxHoliday } from '../trading/krxHolidays.js';

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
  skipped?: 'ALREADY_EXISTS' | 'SILENCE_MONDAY' | 'TEMPLATE_FALLBACK' | 'NON_TRADING_DAY';
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
  /**
   * PR-16: 오늘(KST) CONFIRMED SELL fill 이 있었으나 ACTIVE 상태를 유지하는 포지션.
   * 예: 부분 익절(PARTIAL_TP), 트레일링 부분 청산. 학습이 이익 시나리오도 보도록.
   * fill.timestamp 기준이며 closedTrades 와 상호 배타 (전량 청산은 closedTrades 로만 카운트).
   */
  partialRealizationsToday: Array<{
    trade: ServerShadowTrade;
    todaysSells: PositionFill[];
  }>;
  /** 오늘 부착된 attribution 레코드 */
  attributionToday: ReturnType<typeof loadCurrentSchemaRecords>;
  /** 오늘의 incident (CRITICAL/HIGH/WARN 포함) */
  incidentsToday: ReturnType<typeof listIncidents>;
  /** 워치리스트 중 아직 진입 없음 — "놓친 신호" 후보 */
  missedSignals: Array<{ stockCode: string; reason: string }>;
  /** Integrity Guard 가 claim 검증에 사용 */
  knownSourceIds: Set<string>;
  /** 오늘 발생한 수동 청산 — 편향·기계 괴리 추적 재료 */
  manualExitsToday: ManualExitRecord[];
}

export function collectInputs(date: string): ReflectionInputs {
  const allTrades = loadShadowTrades();
  const closedTrades = allTrades.filter(
    (t) => (t.status === 'HIT_TARGET' || t.status === 'HIT_STOP') && isoInKstDate(t.exitTime, date),
  );

  // PR-16: ACTIVE 상태에서 오늘 CONFIRMED 된 SELL fill 이 있는 포지션.
  // closedTrades 와 동일 id 는 제외 (전량 청산은 closedTrades 가 SSOT).
  const closedIds = new Set(closedTrades.map((t) => t.id));
  const partialRealizationsToday: ReflectionInputs['partialRealizationsToday'] = [];
  for (const t of allTrades) {
    if (closedIds.has(t.id)) continue;
    const fills = t.fills ?? [];
    const todaysSells = fills.filter((f) => {
      if (f.type !== 'SELL' || !isActiveFill(f) || f.status !== 'CONFIRMED') return false;
      const ts = f.confirmedAt ?? f.timestamp;
      return !!ts && isoInKstDate(ts, date);
    });
    if (todaysSells.length > 0) {
      partialRealizationsToday.push({ trade: t, todaysSells });
    }
  }

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

  const manualExitsToday = loadManualExitsForDateKst(date);

  // Integrity Guard 원천 집합 조립.
  const knownSourceIds = new Set<string>();
  for (const t of closedTrades) knownSourceIds.add(t.id);
  // PR-16: 부분매도 trade id 도 knownSourceIds 에 추가 — 학습이 이를 근거로 claim 가능.
  for (const p of partialRealizationsToday) knownSourceIds.add(p.trade.id);
  for (const r of attribution) knownSourceIds.add(r.tradeId);
  for (const i of incidentsToday) knownSourceIds.add(i.at);
  for (const m of missedSignals) knownSourceIds.add(m.stockCode);
  for (const m of manualExitsToday) knownSourceIds.add(m.tradeId);

  return {
    date,
    closedTrades,
    partialRealizationsToday,
    attributionToday: attribution,
    incidentsToday,
    missedSignals,
    knownSourceIds,
    manualExitsToday,
  };
}

/**
 * PR-16: 부분매도 + 전량청산을 합쳐 "오늘 실현 이벤트" 요약을 산출한다.
 * nightlyReflection 의 Gemini 프롬프트·Bias Heatmap·Counterfactual 에
 * 공통 입력으로 쓰여 "오늘 이익 있었음에도 손실로만 보이는" 편향을 차단한다.
 */
export interface TodaysRealizationSummary {
  fullClosedCount: number;
  partialOnlyCount: number;
  winFills: number;
  lossFills: number;
  totalRealizedKrw: number;
  weightedReturnPct: number;
  /** 종목 단위 라벨 (사람이 읽는 요약). 예: "현대제철 전량손절 -7.42%, 포스코인터 부분익절 +5.00%" */
  labels: string[];
}

export function summarizeTodaysRealizationsForLearning(inputs: ReflectionInputs): TodaysRealizationSummary {
  const fullClosed = inputs.closedTrades;
  const partial    = inputs.partialRealizationsToday;

  // fill 수 기반 승/패 카운트
  let winFills  = 0;
  let lossFills = 0;
  let totalRealizedKrw = 0;
  let weightedNum = 0;
  let weightedDen = 0;
  const labels: string[] = [];

  for (const t of fullClosed) {
    // 전량 청산 trade 는 오늘(KST) SELL fill 들 중 해당 날짜만 집계.
    const fills = (t.fills ?? []).filter((f) =>
      f.type === 'SELL' && isActiveFill(f) && f.status === 'CONFIRMED'
      && isoInKstDate(f.confirmedAt ?? f.timestamp, inputs.date),
    );
    for (const f of fills) {
      if ((f.pnl ?? 0) > 0) winFills++;
      else if ((f.pnl ?? 0) < 0) lossFills++;
      totalRealizedKrw += f.pnl ?? 0;
      weightedNum += (f.pnlPct ?? 0) * f.qty;
      weightedDen += f.qty;
    }
    if (fills.length > 0) {
      const sumPnl = fills.reduce((s, f) => s + (f.pnl ?? 0), 0);
      const totalQty = fills.reduce((s, f) => s + f.qty, 0);
      const pct = totalQty > 0 ? fills.reduce((s, f) => s + (f.pnlPct ?? 0) * f.qty, 0) / totalQty : 0;
      const kind = t.status === 'HIT_TARGET' ? '전량익절' : '전량손절';
      labels.push(`${t.stockName} ${kind} ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% (${Math.round(sumPnl).toLocaleString()}원)`);
    }
  }

  for (const p of partial) {
    for (const f of p.todaysSells) {
      if ((f.pnl ?? 0) > 0) winFills++;
      else if ((f.pnl ?? 0) < 0) lossFills++;
      totalRealizedKrw += f.pnl ?? 0;
      weightedNum += (f.pnlPct ?? 0) * f.qty;
      weightedDen += f.qty;
    }
    const sumPnl   = p.todaysSells.reduce((s, f) => s + (f.pnl ?? 0), 0);
    const totalQty = p.todaysSells.reduce((s, f) => s + f.qty, 0);
    const pct = totalQty > 0 ? p.todaysSells.reduce((s, f) => s + (f.pnlPct ?? 0) * f.qty, 0) / totalQty : 0;
    labels.push(`${p.trade.stockName} 부분익절 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% (${Math.round(sumPnl).toLocaleString()}원)`);
  }

  return {
    fullClosedCount: fullClosed.length,
    partialOnlyCount: partial.length,
    winFills,
    lossFills,
    totalRealizedKrw,
    weightedReturnPct: weightedDen > 0 ? weightedNum / weightedDen : 0,
    labels,
  };
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
  const geminiRuntime = getGeminiRuntimeState();
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
    keyLessons[keyLessons.length - 1].text =
      `Gemini 응답 실패${geminiRuntime.reason ? ` (${geminiRuntime.reason})` : ''} — 템플릿 fallback 으로 하루 리포트 보존.`;
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

  // PR-A — 주말·KRX 공휴일 환각 차단 가드 (ADR-0043 PR-B 후속에서 SSOT 일원화 예정).
  // 거래 데이터 없는 날에 자기반성을 실행하면 "오늘 모든 신호가 실패" 로 잘못 학습되어
  // 가중치가 왜곡된다. opts.force=true 시 가드 우회 (수동 운영 호환).
  if (!opts.force) {
    const weekend = isKstWeekend(now);
    const holiday = isKrxHoliday(date);
    if (weekend || holiday) {
      const reason = weekend ? '주말' : 'KRX 공휴일';
      console.log(`[NightlyReflection] ${date} ${reason} — 학습 가중치 동결, 반성 스킵`);
      return {
        date,
        mode: 'TEMPLATE_ONLY',
        executed: false,
        skipped: 'NON_TRADING_DAY',
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
      // PR-16: 부분매도 실현도 Gemini narrative 에 포함해 "이익 실종" 편향 차단.
      partialRealizationsToday: inputs.partialRealizationsToday,
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
    // PR-16: 오늘 전량 청산이 없을 때도 부분매도 포지션을 1순위로 Round-Table 대상으로
    // 승격. 활발한 이익 실현을 학습 페르소나가 짚고 넘어가게 한다.
    const primaryTrade = inputs.closedTrades[0] ?? inputs.partialRealizationsToday[0]?.trade;
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
    // PR-16: Bias Heatmap 의 "오늘 청산" 입력을 fill SSOT 기반 요약으로 확장한다.
    // 부분익절이 있는 날에 "악손실 편향" 만 감지돼 왜곡된 heatmap 이 누적되지 않도록.
    const macro = loadMacroState();
    const activePositions = loadShadowTrades().filter((t) => t.status === 'ACTIVE');
    const realizationSummary = summarizeTodaysRealizationsForLearning(inputs);
    const biasScores = computeBiasHeatmap({
      activePositions,
      closedToday: inputs.closedTrades,
      // PR-17: 부분매도 실현을 biasHeatmap 에도 주입해 Loss Aversion·Overconfidence
      // 점수가 fill 단위 승/손을 기반으로 계산되도록 한다.
      partialRealizationsToday: inputs.partialRealizationsToday,
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
    // PR-16: lossRatio 를 전량 청산 비율이 아닌 fill 단위 승/손 비율로 계산해
    // 부분익절이 있는 날에도 실패 실험 제안이 과도하게 나오지 않도록 보정.
    const fillTotal = realizationSummary.winFills + realizationSummary.lossFills;
    const lossRatio = fillTotal > 0 ? realizationSummary.lossFills / fillTotal : 0;
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

    // ── P2 #15 수동 청산 의무 분석 (manualExitReview) ─────────────────────
    // 오늘 + 7일 + 30일 롤링 카운트로 구조화된 리뷰 스냅샷을 리포트에 직접 부착.
    const rolling7d  = loadManualExitsWithinDays(7, now);
    const rolling30d = loadManualExitsWithinDays(30, now);
    const meReview = buildManualExitReview({
      dateKst: date,
      today:   inputs.manualExitsToday,
      rolling7d,
      rolling30d,
    });
    if (meReview.count > 0 || meReview.rolling7dCount > 0) {
      report.manualExitReview = meReview;
      const sourceIds = inputs.manualExitsToday.map((m) => m.tradeId);
      for (const id of sourceIds) inputs.knownSourceIds.add(id);
      // 편향 평균 경고 — 기존 로직 유지.
      if (meReview.flags.length > 0 && meReview.count > 0) {
        report.followUpActions = [
          ...(report.followUpActions ?? []),
          {
            text: `수동 청산 ${meReview.count}건 — ${meReview.flags.join(' / ')}. 내일 /sell 직전 5분 대기 규칙 재검토.`,
            sourceIds: sourceIds.length > 0 ? sourceIds : [`system:manual_exit_review`],
          },
        ];
      }
    }

    // ── P2 #16 Bias Heatmap 수동 빈도 축 ────────────────────────────────
    const manualFreq = computeManualFrequencyAxis(
      inputs.manualExitsToday,
      rolling7d,
      rolling30d,
    );
    if (manualFreq.grade !== 'CALM') {
      const sid = `system:manual_freq_axis`;
      inputs.knownSourceIds.add(sid);
      report.followUpActions = [
        ...(report.followUpActions ?? []),
        {
          text: `[심리 온도계] 수동 빈도 ${manualFreq.grade} — ${manualFreq.evidence}`,
          sourceIds: [sid],
        },
      ];
    }
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

  // ADR-0047 (PR-Y2): Reflection Module Half-Life — 13개 모듈 영향률 영속.
  // 본 PR 은 측정만 — 실제 silent/deprecated 가드 wiring 은 후속 PR.
  // 실패는 학습 사이클을 막지 않도록 try/catch 흡수.
  try {
    recordReflectionImpactsFromReport(report, date, now);
  } catch (e: unknown) {
    console.warn(
      '[NightlyReflection] reflection impact 기록 실패:',
      e instanceof Error ? e.message : e,
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
