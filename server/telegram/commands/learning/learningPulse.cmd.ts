// @responsibility /learning_pulse — 학습 시스템 7개 영역 헬스 한 화면 요약 SSOT 소비
import fs from 'fs';
import {
  loadGhostPortfolio,
  loadExperimentProposals,
  loadReflectionBudget,
} from '../../../persistence/reflectionRepo.js';
import { loadCurrentSchemaRecords } from '../../../persistence/attributionRepo.js';
import { loadConditionWeights } from '../../../persistence/conditionWeightsRepo.js';
import { F2W_AUDIT_FILE } from '../../../persistence/paths.js';
import { getRecentAlertHistory } from '../../../persistence/alertHistoryRepo.js';
import type { F2WRunResult } from '../../../learning/failureToWeight.js';
import type { ExperimentProposal } from '../../../learning/reflectionTypes.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

// ─── 진단 임계 SSOT ─────────────────────────────────────────────────────────
const PULSE_THRESHOLDS = {
  /** open ≥ N AND closed/open < 0.1 → ghost_close_blocker */
  GHOST_OPEN_BLOCKER_MIN: 100,
  GHOST_CLOSE_RATIO_THRESHOLD: 0.1,
  /** 7일 attribution < N → sample_starvation */
  ATTRIBUTION_TARGET_7D: 70,
  /** 7일 SUGGEST 알림 N건 미만 → suggest_silence */
  SUGGEST_SILENCE_THRESHOLD: 1,
  /** 호출률 < N → gemini_underuse */
  GEMINI_USE_RATIO_TARGET: 0.8,
  GEMINI_BUSINESS_DAYS_PER_MONTH: 22,
} as const;

const SUGGEST_MODULES = ['counterfactual', 'ledger', 'kellySurface', 'regime'] as const;
type SuggestModule = (typeof SUGGEST_MODULES)[number];

const ACTIVE_EXPERIMENT_STATES: ReadonlySet<ExperimentProposal['state']> = new Set([
  'PROPOSED',
  'AUTO_STARTED',
  'AWAIT_APPROVAL',
  'RUNNING',
]);

// ─── Snapshot 타입 ──────────────────────────────────────────────────────────
export interface LearningPulseSnapshot {
  capturedAt: string;
  todayKst: string;
  ghost: { open: number; closedRecent7d: number; closeRatio: number };
  attribution7d: { count: number; target: number };
  weights: {
    changedFromDefault: number;
    sunsetCount: number;
    untouched: number;
    lastF2WRanAt?: string;
    lastF2WSkipCount: number;
    lastF2WTotalRecords: number;
  };
  suggest7d: Record<SuggestModule, number>;
  experimentsActive: number;
  gemini: { month: string; callCount: number; tokensUsed: number; useRatio: number };
  flags: string[];
  partialFailure: boolean;
}

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────

function todayKstStr(now: Date): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function safeCall<T>(fn: () => T, fallback: T, errors: string[], label: string): T {
  try {
    return fn();
  } catch (e) {
    errors.push(`${label}:${e instanceof Error ? e.message : String(e)}`);
    return fallback;
  }
}

function readF2WAuditTail(): F2WRunResult | null {
  if (!fs.existsSync(F2W_AUDIT_FILE)) return null;
  const log = JSON.parse(fs.readFileSync(F2W_AUDIT_FILE, 'utf-8')) as F2WRunResult[];
  if (!Array.isArray(log) || log.length === 0) return null;
  return log[log.length - 1];
}

/** Gemini 호출률 (당월 callCount / 22영업일). 0~1 clamp. */
export function computeGeminiUseRatio(callCount: number): number {
  if (!Number.isFinite(callCount) || callCount <= 0) return 0;
  const ratio = callCount / PULSE_THRESHOLDS.GEMINI_BUSINESS_DAYS_PER_MONTH;
  return Math.max(0, Math.min(1, ratio));
}

/**
 * 학습 시스템 7개 영역 헬스 카운트 SSOT 수집. 외부 호출 0건.
 * 영속 read-only 만 — 한 모듈 실패해도 다른 모듈 계속 (graceful degradation).
 */
export function collectLearningPulse(now: Date = new Date()): LearningPulseSnapshot {
  const errors: string[] = [];
  const todayKst = todayKstStr(now);

  // ── 1. Ghost Portfolio ─────────────────────────────────────────────────
  const ghosts = safeCall(() => loadGhostPortfolio(), [], errors, 'ghost');
  const open = ghosts.filter((g) => !g.closed).length;
  const sevenDaysAgoMs = now.getTime() - 7 * 24 * 3600 * 1000;
  const closedRecent7d = ghosts.filter((g) => {
    if (!g.closed) return false;
    // GhostPosition 에 exitedAt 필드 부재 — closed=true 시점 근사로 lastUpdatedAt 사용.
    const lastUpdatedMs = g.lastUpdatedAt ? new Date(g.lastUpdatedAt).getTime() : NaN;
    return Number.isFinite(lastUpdatedMs) && lastUpdatedMs >= sevenDaysAgoMs;
  }).length;
  const closeRatio = open > 0 ? closedRecent7d / open : 0;

  // ── 2. Attribution 7일 ─────────────────────────────────────────────────
  const attrRecords = safeCall(() => loadCurrentSchemaRecords(), [], errors, 'attribution');
  const attribution7dCount = attrRecords.filter((r) => {
    const t = new Date(r.closedAt).getTime();
    return Number.isFinite(t) && t >= sevenDaysAgoMs;
  }).length;

  // ── 3. Condition Weights (27조건) ───────────────────────────────────────
  const weights = safeCall(() => loadConditionWeights(), null, errors, 'weights');
  let changedFromDefault = 0;
  let sunsetCount = 0;
  let untouched = 0;
  if (weights) {
    for (const v of Object.values(weights)) {
      if (typeof v !== 'number') continue;
      if (v === 1.0) untouched++;
      else changedFromDefault++;
      if (v <= 0.1) sunsetCount++;
    }
  }

  // ── 4. F2W audit (마지막 실행) ─────────────────────────────────────────
  const f2wTail = safeCall(() => readF2WAuditTail(), null, errors, 'f2w');
  const lastF2WSkipCount = f2wTail
    ? f2wTail.adjustments.filter((a) => a.action === 'NONE').length
    : 0;
  const lastF2WTotalRecords = f2wTail?.totalRecords ?? 0;

  // ── 5. Suggest 7일 (alertHistory message 기반 분류) ────────────────────
  const recentAlerts = safeCall(() => getRecentAlertHistory(500), [], errors, 'suggest');
  const suggest7d: Record<SuggestModule, number> = {
    counterfactual: 0, ledger: 0, kellySurface: 0, regime: 0,
  };
  for (const a of recentAlerts) {
    const t = new Date(a.at).getTime();
    if (!Number.isFinite(t) || t < sevenDaysAgoMs) continue;
    if (!a.success || !a.message.includes('학습 모듈 Suggest')) continue;
    for (const m of SUGGEST_MODULES) {
      if (a.message.includes(`Suggest — ${m}`)) {
        suggest7d[m]++;
        break;
      }
    }
  }

  // ── 6. Experiment Proposal 활성 ─────────────────────────────────────────
  const proposals = safeCall(() => loadExperimentProposals(), [], errors, 'experiments');
  const experimentsActive = proposals.filter((p) => ACTIVE_EXPERIMENT_STATES.has(p.state)).length;

  // ── 7. Gemini 월간 ──────────────────────────────────────────────────────
  const budget = safeCall(
    () => loadReflectionBudget(),
    { month: todayKst.slice(0, 7), tokensUsed: 0, callCount: 0 },
    errors,
    'gemini',
  );
  const useRatio = computeGeminiUseRatio(budget.callCount);

  // ── 진단 플래그 산출 ────────────────────────────────────────────────────
  const flags: string[] = [];
  if (open >= PULSE_THRESHOLDS.GHOST_OPEN_BLOCKER_MIN
      && closeRatio < PULSE_THRESHOLDS.GHOST_CLOSE_RATIO_THRESHOLD) {
    flags.push(`ghost_close_blocker (${open}건 적체)`);
  }
  if (attribution7dCount < PULSE_THRESHOLDS.ATTRIBUTION_TARGET_7D) {
    flags.push(`sample_starvation (attribution ${attribution7dCount}/${PULSE_THRESHOLDS.ATTRIBUTION_TARGET_7D}/7d)`);
  }
  const totalSuggest = SUGGEST_MODULES.reduce((s, m) => s + suggest7d[m], 0);
  if (totalSuggest < PULSE_THRESHOLDS.SUGGEST_SILENCE_THRESHOLD) {
    flags.push('suggest_silence (4 채널 모두 7일 0건)');
  }
  if (useRatio < PULSE_THRESHOLDS.GEMINI_USE_RATIO_TARGET) {
    flags.push(`gemini_underuse (호출률 ${(useRatio * 100).toFixed(0)}% < 80%)`);
  }

  return {
    capturedAt: now.toISOString(),
    todayKst,
    ghost: { open, closedRecent7d, closeRatio },
    attribution7d: { count: attribution7dCount, target: PULSE_THRESHOLDS.ATTRIBUTION_TARGET_7D },
    weights: {
      changedFromDefault,
      sunsetCount,
      untouched,
      lastF2WRanAt: f2wTail?.ranAt,
      lastF2WSkipCount,
      lastF2WTotalRecords,
    },
    suggest7d,
    experimentsActive,
    gemini: { month: budget.month, callCount: budget.callCount, tokensUsed: budget.tokensUsed, useRatio },
    flags,
    partialFailure: errors.length > 0,
  };
}

// ─── 텔레그램 메시지 포맷터 ────────────────────────────────────────────────

export function formatLearningPulseMessage(snap: LearningPulseSnapshot): string {
  const ghostWarn = snap.ghost.open >= PULSE_THRESHOLDS.GHOST_OPEN_BLOCKER_MIN
    && snap.ghost.closeRatio < PULSE_THRESHOLDS.GHOST_CLOSE_RATIO_THRESHOLD
    ? '\n  ⚠️ 적체 의심 (closed/open < 10%)' : '';
  const attrEmoji = snap.attribution7d.count < snap.attribution7d.target ? '🔴 표본 부족' : '🟢 정상';
  const totalSuggest = SUGGEST_MODULES.reduce((s, m) => s + snap.suggest7d[m], 0);
  const suggestWarn = totalSuggest < PULSE_THRESHOLDS.SUGGEST_SILENCE_THRESHOLD
    ? '\n  ⚠️ 전체 0건 → 임계치 검토 필요' : '';
  const geminiUsePct = (snap.gemini.useRatio * 100).toFixed(0);
  const f2wLine = snap.weights.lastF2WRanAt
    ? `${snap.weights.lastF2WRanAt.slice(0, 16).replace('T', ' ')} (총 ${snap.weights.lastF2WTotalRecords}건)`
    : 'N/A (실행 이력 없음)';

  const lines = [
    `🩺 Learning Pulse (${snap.todayKst})`,
    '━━━━━━━━━━━━━━━━',
    '',
    '👻 Ghost Portfolio',
    `  OPEN: ${snap.ghost.open}건 / 7일 close: ${snap.ghost.closedRecent7d}건${ghostWarn}`,
    '',
    '📊 Attribution (7일)',
    `  누적: ${snap.attribution7d.count}건 (target ≥ ${snap.attribution7d.target})`,
    `  상태: ${attrEmoji}`,
    '',
    '⚖️ Condition Weights (27조건)',
    `  변경: ${snap.weights.changedFromDefault}개 / sunset: ${snap.weights.sunsetCount}개 / 미학습: ${snap.weights.untouched}개`,
    `  마지막 F2W: ${f2wLine}`,
    `  Skip(표본부족): ${snap.weights.lastF2WSkipCount}개`,
    '',
    '🔔 Suggest 발사 (7일)',
    `  counterfactual: ${snap.suggest7d.counterfactual}`,
    `  ledger: ${snap.suggest7d.ledger}`,
    `  kellySurface: ${snap.suggest7d.kellySurface}`,
    `  regime: ${snap.suggest7d.regime}${suggestWarn}`,
    '',
    `🧪 Experiment Proposal: ${snap.experimentsActive}개 활성`,
    '',
    '🤖 Gemini (이번 달)',
    `  호출: ${snap.gemini.callCount}회 / ~${PULSE_THRESHOLDS.GEMINI_BUSINESS_DAYS_PER_MONTH}영업일 → 호출률 ${geminiUsePct}%`,
    `  tokens: ${snap.gemini.tokensUsed.toLocaleString()}`,
    '',
    '━━━━━━━━━━━━━━━━',
    '진단 플래그:',
    snap.flags.length > 0 ? snap.flags.map((f) => `- ${f}`).join('\n') : '✅ 모든 채널 정상',
  ];
  if (snap.partialFailure) lines.push('', 'ℹ️ 데이터 일부 미확인 — 일부 SSOT 읽기 실패 (graceful)');
  return lines.join('\n');
}

// ─── 명령 등록 ──────────────────────────────────────────────────────────────

const learningPulse: TelegramCommand = {
  name: '/learning_pulse',
  aliases: ['/lp'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '학습 시스템 7개 영역 헬스 한 화면 (Ghost/Attribution/Weights/F2W/Suggest/Experiment/Gemini)',
  async execute({ reply }) {
    try {
      const snap = collectLearningPulse();
      await reply(formatLearningPulseMessage(snap));
    } catch (e) {
      console.error('[TelegramBot] /learning_pulse 실패:', e);
      await reply('❌ 학습 시스템 헬스 조회 실패 — 데이터 일부 미확인.');
    }
  },
};

commandRegistry.register(learningPulse);

export default learningPulse;
export { PULSE_THRESHOLDS, SUGGEST_MODULES };
