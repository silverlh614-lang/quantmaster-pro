/**
 * @responsibility nightly reflection 이력·bias heatmap·suggest 알림을 운영자 진단용 status/history 스냅샷으로 합산한다.
 */

import {
  loadReflection,
  loadReflectionBudget,
  loadBiasHeatmap,
  loadExperimentProposals,
  loadTomorrowPriming,
  loadGhostPortfolio,
  type ReflectionBudgetState,
} from '../persistence/reflectionRepo.js';
import { getRecentAlertHistory } from '../persistence/alertHistoryRepo.js';
import type {
  ReflectionMode,
  DailyVerdict,
  BiasType,
  BiasHeatmapDailyEntry,
  ExperimentProposal,
  TomorrowPriming,
} from './reflectionTypes.js';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toKstDateString(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftKstDateString(today: string, deltaDays: number): string {
  const base = new Date(`${today}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

export interface LearningStatusReflectionSummary {
  date: string;
  generatedAt: string;
  mode: ReflectionMode | null;
  dailyVerdict: DailyVerdict;
  narrativeLength: number;
  narrativePreview: string;
  keyLessonsCount: number;
  questionableDecisionsCount: number;
  tomorrowAdjustmentsCount: number;
  fiveWhyCount: number;
  personaReviewStressed: boolean | null;
  integrityRemovedCount: number;
  integrityParseFailed: boolean;
}

export interface LearningStatusSnapshot {
  lastReflection: LearningStatusReflectionSummary | null;
  /** today 부터 거꾸로 reflection 없는 연속 일수 (SILENCE_MONDAY 는 누락으로 안 셈). 최대 7+ */
  consecutiveMissingDays: number;
  reflectionBudget: ReflectionBudgetState;
  biasHeatmapToday: BiasHeatmapDailyEntry | null;
  biasHeatmap7dAvg: { bias: BiasType; avg: number }[];
  experimentProposalsActive: ExperimentProposal[];
  experimentProposalsCompletedRecent: ExperimentProposal[];
  tomorrowPriming: TomorrowPriming | null;
  ghostPortfolioOpenCount: number;
  suggestAlerts7d: {
    counterfactual: number;
    ledger: number;
    kellySurface: number;
    regimeCoverage: number;
    total: number;
  };
  diagnostics: {
    healthy: boolean;
    warnings: string[];
  };
}

export interface LearningHistoryDay {
  date: string;
  hasReflection: boolean;
  silenceMonday: boolean;
  mode: ReflectionMode | null;
  dailyVerdict: DailyVerdict | null;
  narrativeLength: number;
  keyLessonsCount: number;
  fiveWhyCount: number;
  integrityRemovedCount: number;
  biasTopThree: { bias: BiasType; score: number }[];
}

export interface LearningHistorySummary {
  days: LearningHistoryDay[];
  totalReflections: number;
  missingDays: number;
  budget: ReflectionBudgetState;
  escalatingBiases: { bias: BiasType; recentScores: number[] }[];
}

const ACTIVE_EXPERIMENT_STATES: ExperimentProposal['state'][] = [
  'AUTO_STARTED',
  'AWAIT_APPROVAL',
  'RUNNING',
];

function summarizeLastReflection(today: string): { summary: LearningStatusReflectionSummary | null; missing: number } {
  for (let i = 0; i < 30; i++) {
    const date = shiftKstDateString(today, -i);
    const rep = loadReflection(date);
    if (!rep) continue;
    if (rep.mode === 'SILENCE_MONDAY') {
      // silence monday 는 의도적 비활성 — narrative 가 없어도 정상으로 본다.
      // 단 직전 1회 요약 자체로는 표시. consecutiveMissingDays 는 별도로 계산.
      return {
        summary: {
          date: rep.date,
          generatedAt: rep.generatedAt,
          mode: rep.mode ?? null,
          dailyVerdict: rep.dailyVerdict,
          narrativeLength: rep.narrative?.length ?? 0,
          narrativePreview: (rep.narrative ?? '').slice(0, 200),
          keyLessonsCount: rep.keyLessons?.length ?? 0,
          questionableDecisionsCount: rep.questionableDecisions?.length ?? 0,
          tomorrowAdjustmentsCount: rep.tomorrowAdjustments?.length ?? 0,
          fiveWhyCount: rep.fiveWhy?.length ?? 0,
          personaReviewStressed: rep.personaReview ? rep.personaReview.stressTested : null,
          integrityRemovedCount: rep.integrity?.removed?.length ?? 0,
          integrityParseFailed: rep.integrity?.parseFailed === true,
        },
        missing: i,
      };
    }
    return {
      summary: {
        date: rep.date,
        generatedAt: rep.generatedAt,
        mode: rep.mode ?? null,
        dailyVerdict: rep.dailyVerdict,
        narrativeLength: rep.narrative?.length ?? 0,
        narrativePreview: (rep.narrative ?? '').slice(0, 200),
        keyLessonsCount: rep.keyLessons?.length ?? 0,
        questionableDecisionsCount: rep.questionableDecisions?.length ?? 0,
        tomorrowAdjustmentsCount: rep.tomorrowAdjustments?.length ?? 0,
        fiveWhyCount: rep.fiveWhy?.length ?? 0,
        personaReviewStressed: rep.personaReview ? rep.personaReview.stressTested : null,
        integrityRemovedCount: rep.integrity?.removed?.length ?? 0,
        integrityParseFailed: rep.integrity?.parseFailed === true,
      },
      missing: i,
    };
  }
  return { summary: null, missing: 30 };
}

function biasHeatmap7dAverages(today: string): { bias: BiasType; avg: number }[] {
  const all = loadBiasHeatmap();
  const cutoff = shiftKstDateString(today, -6);
  const recent = all.filter(e => e.date >= cutoff && e.date <= today);
  if (recent.length === 0) return [];
  const sums = new Map<BiasType, { total: number; count: number }>();
  for (const day of recent) {
    for (const score of day.scores) {
      const cur = sums.get(score.bias) ?? { total: 0, count: 0 };
      cur.total += score.score;
      cur.count += 1;
      sums.set(score.bias, cur);
    }
  }
  const out: { bias: BiasType; avg: number }[] = [];
  for (const [bias, { total, count }] of sums.entries()) {
    out.push({ bias, avg: count > 0 ? total / count : 0 });
  }
  return out.sort((a, b) => b.avg - a.avg);
}

function detectEscalatingBiases(today: string): { bias: BiasType; recentScores: number[] }[] {
  const all = loadBiasHeatmap();
  const cutoff = shiftKstDateString(today, -2);
  const recent = all.filter(e => e.date >= cutoff && e.date <= today);
  if (recent.length < 3) return [];
  const byBias = new Map<BiasType, number[]>();
  for (const day of recent) {
    for (const score of day.scores) {
      const arr = byBias.get(score.bias) ?? [];
      arr.push(score.score);
      byBias.set(score.bias, arr);
    }
  }
  const out: { bias: BiasType; recentScores: number[] }[] = [];
  for (const [bias, scores] of byBias.entries()) {
    if (scores.length >= 3 && scores.slice(-3).every(s => s >= 0.5)) {
      out.push({ bias, recentScores: scores.slice(-3) });
    }
  }
  return out;
}

function summarizeSuggestAlerts7d(): LearningStatusSnapshot['suggestAlerts7d'] {
  const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const merged = getRecentAlertHistory(2000);
  // suggestNotifier 는 category 에 'learning' literal 을 통과시키지만
  // AlertCategory enum 에는 정의돼 있지 않아 string 비교로 우회한다.
  const learningOnly = merged.filter(e => String(e.category) === 'learning' && new Date(e.at).getTime() >= cutoffMs);
  const out = { counterfactual: 0, ledger: 0, kellySurface: 0, regimeCoverage: 0, total: 0 };
  for (const e of learningOnly) {
    const msg = (e.message ?? '').toLowerCase();
    if (msg.includes('counterfactual')) out.counterfactual++;
    else if (msg.includes('ledger')) out.ledger++;
    else if (msg.includes('kellysurface') || msg.includes('kelly surface')) out.kellySurface++;
    else if (msg.includes('regimecoverage') || msg.includes('regime coverage')) out.regimeCoverage++;
    out.total++;
  }
  return out;
}

function computeDiagnostics(args: {
  lastReflection: LearningStatusReflectionSummary | null;
  consecutiveMissingDays: number;
  reflectionBudget: ReflectionBudgetState;
  escalatingBiases: { bias: BiasType; recentScores: number[] }[];
}): { healthy: boolean; warnings: string[] } {
  const warnings: string[] = [];
  if (args.consecutiveMissingDays >= 2) {
    warnings.push(`최근 ${args.consecutiveMissingDays}일 reflection 없음 — cron 실행 또는 data write 실패 의심`);
  }
  if (args.reflectionBudget.callCount >= 80) {
    warnings.push(`Gemini 예산 호출 ${args.reflectionBudget.callCount}회 — 월 한도 근접`);
  }
  if (args.lastReflection) {
    if (args.lastReflection.mode === 'TEMPLATE_ONLY' && args.lastReflection.narrativeLength === 0) {
      warnings.push('템플릿 폴백 모드 — Gemini 호출 전부 실패 추정');
    }
    if (args.lastReflection.integrityParseFailed) {
      warnings.push('Integrity Guard 파싱 실패 — LLM 응답 깨짐');
    }
  }
  if (args.escalatingBiases.length > 0) {
    const names = args.escalatingBiases.map(e => e.bias).join(', ');
    warnings.push(`${names} 편향 3일 연속 ≥0.5 — escalating`);
  }
  return { healthy: warnings.length === 0, warnings };
}

export function getLearningStatus(now: Date = new Date()): LearningStatusSnapshot {
  const today = toKstDateString(now);
  const { summary: lastReflection, missing } = summarizeLastReflection(today);
  const reflectionBudget = loadReflectionBudget();
  const biasAll = loadBiasHeatmap();
  const biasHeatmapToday = biasAll.find(e => e.date === today) ?? null;
  const biasHeatmap7dAvg = biasHeatmap7dAverages(today);
  const proposals = loadExperimentProposals();
  const experimentProposalsActive = proposals.filter(p => ACTIVE_EXPERIMENT_STATES.includes(p.state));
  const experimentProposalsCompletedRecent = proposals
    .filter(p => p.state === 'COMPLETED')
    .slice(-5)
    .reverse();
  const tomorrowPriming = loadTomorrowPriming();
  const ghostPortfolioOpenCount = loadGhostPortfolio().filter(p => !p.closed).length;
  const suggestAlerts7d = summarizeSuggestAlerts7d();
  const escalatingBiases = detectEscalatingBiases(today);
  const diagnostics = computeDiagnostics({
    lastReflection,
    consecutiveMissingDays: missing,
    reflectionBudget,
    escalatingBiases,
  });

  return {
    lastReflection,
    consecutiveMissingDays: Math.min(missing, 7),
    reflectionBudget,
    biasHeatmapToday,
    biasHeatmap7dAvg,
    experimentProposalsActive,
    experimentProposalsCompletedRecent,
    tomorrowPriming,
    ghostPortfolioOpenCount,
    suggestAlerts7d,
    diagnostics,
  };
}

export function getLearningHistory(days: number, now: Date = new Date()): LearningHistorySummary {
  const span = Math.max(1, Math.min(30, Math.floor(days)));
  const today = toKstDateString(now);
  const biasAll = loadBiasHeatmap();
  const days_: LearningHistoryDay[] = [];
  let totalReflections = 0;
  let missingDays = 0;

  for (let i = span - 1; i >= 0; i--) {
    const date = shiftKstDateString(today, -i);
    const rep = loadReflection(date);
    const biasEntry = biasAll.find(e => e.date === date);
    const biasTopThree = biasEntry
      ? [...biasEntry.scores]
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(s => ({ bias: s.bias, score: s.score }))
      : [];

    if (!rep) {
      days_.push({
        date,
        hasReflection: false,
        silenceMonday: false,
        mode: null,
        dailyVerdict: null,
        narrativeLength: 0,
        keyLessonsCount: 0,
        fiveWhyCount: 0,
        integrityRemovedCount: 0,
        biasTopThree,
      });
      missingDays++;
      continue;
    }

    const isSilenceMonday = rep.mode === 'SILENCE_MONDAY';
    if (!isSilenceMonday) totalReflections++;
    days_.push({
      date,
      hasReflection: true,
      silenceMonday: isSilenceMonday,
      mode: rep.mode ?? null,
      dailyVerdict: rep.dailyVerdict,
      narrativeLength: rep.narrative?.length ?? 0,
      keyLessonsCount: rep.keyLessons?.length ?? 0,
      fiveWhyCount: rep.fiveWhy?.length ?? 0,
      integrityRemovedCount: rep.integrity?.removed?.length ?? 0,
      biasTopThree,
    });
  }

  return {
    days: days_,
    totalReflections,
    missingDays,
    budget: loadReflectionBudget(),
    escalatingBiases: detectEscalatingBiases(today),
  };
}
