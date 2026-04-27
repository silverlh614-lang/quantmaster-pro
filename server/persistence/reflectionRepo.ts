// @responsibility reflectionRepo 영속화 저장소 모듈
/**
 * reflectionRepo.ts — Nightly Reflection Engine 저장소.
 *
 * 저장 파일:
 *   - data/reflections/YYYY-MM-DD.json    : 일별 반성 리포트 (1건/일)
 *   - data/tomorrow-priming.json          : 내일 아침 브리핑 주입용
 *   - data/ghost-portfolio.json           : 놓친 기회 30일 추적
 *   - data/reflection-budget.json         : 월별 Gemini 호출 사용량
 *   - data/meta-decisions-YYYYMM.jsonl    : Gate 결정 프로세스 append-only
 *   - data/bias-heatmap.json              : 10개 편향 스코어 일별 이력 (최근 90일)
 *   - data/experiment-proposals.json      : 실험 제안 큐 (최근 100건)
 */

import fs from 'fs';
import {
  ensureDataDir,
  ensureReflectionsDir,
  reflectionFile,
  REFLECTIONS_DIR,
  TOMORROW_PRIMING_FILE,
  GHOST_PORTFOLIO_FILE,
  REFLECTION_BUDGET_FILE,
  metaDecisionFile,
  BIAS_HEATMAP_FILE,
  EXPERIMENT_PROPOSALS_FILE,
} from './paths.js';
import type {
  ReflectionReport,
  TomorrowPriming,
  GhostPosition,
  MetaDecisionEntry,
  BiasHeatmapDailyEntry,
  ExperimentProposal,
} from '../learning/reflectionTypes.js';

// ── Reflection Report ────────────────────────────────────────────────────────

/** 지정 날짜의 반성 리포트. 없으면 null. */
export function loadReflection(yyyymmdd: string): ReflectionReport | null {
  const file = reflectionFile(yyyymmdd);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ReflectionReport;
  } catch {
    return null;
  }
}

export function saveReflection(report: ReflectionReport): void {
  ensureReflectionsDir();
  fs.writeFileSync(reflectionFile(report.date), JSON.stringify(report, null, 2));
}

/** 최근 N일 반성 리포트 (없는 날짜는 건너뜀). 오래된 → 최신 순. */
export function loadRecentReflections(days: number): ReflectionReport[] {
  ensureReflectionsDir();
  if (!fs.existsSync(REFLECTIONS_DIR)) return [];
  const out: ReflectionReport[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const rep = loadReflection(iso);
    if (rep) out.push(rep);
  }
  return out;
}

// ── Tomorrow Priming ─────────────────────────────────────────────────────────

export function loadTomorrowPriming(): TomorrowPriming | null {
  ensureDataDir();
  if (!fs.existsSync(TOMORROW_PRIMING_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOMORROW_PRIMING_FILE, 'utf-8')) as TomorrowPriming;
  } catch {
    return null;
  }
}

export function saveTomorrowPriming(priming: TomorrowPriming): void {
  ensureDataDir();
  fs.writeFileSync(TOMORROW_PRIMING_FILE, JSON.stringify(priming, null, 2));
}

// ── Ghost Portfolio ──────────────────────────────────────────────────────────

const GHOST_MAX = 500;

export function loadGhostPortfolio(): GhostPosition[] {
  ensureDataDir();
  if (!fs.existsSync(GHOST_PORTFOLIO_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(GHOST_PORTFOLIO_FILE, 'utf-8')) as GhostPosition[];
  } catch {
    return [];
  }
}

export function saveGhostPortfolio(positions: GhostPosition[]): void {
  ensureDataDir();
  fs.writeFileSync(
    GHOST_PORTFOLIO_FILE,
    JSON.stringify(positions.slice(-GHOST_MAX), null, 2),
  );
}

export function appendGhostPositions(newOnes: GhostPosition[]): void {
  if (newOnes.length === 0) return;
  const all = loadGhostPortfolio();
  const seen = new Set(all.filter(p => !p.closed).map(p => `${p.stockCode}|${p.signalDate}`));
  for (const p of newOnes) {
    const key = `${p.stockCode}|${p.signalDate}`;
    if (!seen.has(key)) {
      all.push(p);
      seen.add(key);
    }
  }
  saveGhostPortfolio(all);
}

// ── Reflection Budget ────────────────────────────────────────────────────────

export interface ReflectionBudgetState {
  /** YYYY-MM */
  month: string;
  /** 반성 엔진이 당월 소비한 Gemini 호출 추정 토큰 합계 */
  tokensUsed: number;
  /** 당월 호출 횟수 (감쇠 모드 결정에 사용) */
  callCount:  number;
  /** 가장 최근 반성 실행일 (YYYY-MM-DD) — 격일 판단에 사용 */
  lastReflectionDate?: string;
}

export function loadReflectionBudget(): ReflectionBudgetState {
  ensureDataDir();
  const thisMonth = new Date().toISOString().slice(0, 7);
  if (!fs.existsSync(REFLECTION_BUDGET_FILE)) {
    return { month: thisMonth, tokensUsed: 0, callCount: 0 };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(REFLECTION_BUDGET_FILE, 'utf-8')) as ReflectionBudgetState;
    if (raw.month !== thisMonth) {
      // 월 경계 — 자동 롤오버
      return { month: thisMonth, tokensUsed: 0, callCount: 0 };
    }
    return raw;
  } catch {
    return { month: thisMonth, tokensUsed: 0, callCount: 0 };
  }
}

export function saveReflectionBudget(state: ReflectionBudgetState): void {
  ensureDataDir();
  fs.writeFileSync(REFLECTION_BUDGET_FILE, JSON.stringify(state, null, 2));
}

// ── Meta-Decision Journal (JSONL append-only) ────────────────────────────────

export function appendMetaDecision(entry: MetaDecisionEntry): void {
  ensureDataDir();
  const yyyymm = entry.decidedAt.slice(0, 7).replace('-', '');
  const file = metaDecisionFile(yyyymm);
  try {
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('[MetaDecisionJournal] append 실패:', e instanceof Error ? e.message : e);
  }
}

export function readMetaDecisionsForMonth(yyyymm: string): MetaDecisionEntry[] {
  ensureDataDir();
  const file = metaDecisionFile(yyyymm);
  if (!fs.existsSync(file)) return [];
  try {
    return fs.readFileSync(file, 'utf-8')
      .split('\n')
      .filter(l => l.trim().length > 0)
      .map(l => JSON.parse(l) as MetaDecisionEntry);
  } catch {
    return [];
  }
}

// ── Bias Heatmap ─────────────────────────────────────────────────────────────

const BIAS_HISTORY_MAX = 90;

export function loadBiasHeatmap(): BiasHeatmapDailyEntry[] {
  ensureDataDir();
  if (!fs.existsSync(BIAS_HEATMAP_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(BIAS_HEATMAP_FILE, 'utf-8')) as BiasHeatmapDailyEntry[];
  } catch {
    return [];
  }
}

export function appendBiasHeatmap(entry: BiasHeatmapDailyEntry): void {
  const all = loadBiasHeatmap().filter(e => e.date !== entry.date);
  all.push(entry);
  all.sort((a, b) => a.date.localeCompare(b.date));
  ensureDataDir();
  fs.writeFileSync(
    BIAS_HEATMAP_FILE,
    JSON.stringify(all.slice(-BIAS_HISTORY_MAX), null, 2),
  );
}

// ── Experiment Proposals ─────────────────────────────────────────────────────

const EXPERIMENT_MAX = 100;

export function loadExperimentProposals(): ExperimentProposal[] {
  ensureDataDir();
  if (!fs.existsSync(EXPERIMENT_PROPOSALS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(EXPERIMENT_PROPOSALS_FILE, 'utf-8')) as ExperimentProposal[];
  } catch {
    return [];
  }
}

export function saveExperimentProposals(list: ExperimentProposal[]): void {
  ensureDataDir();
  fs.writeFileSync(
    EXPERIMENT_PROPOSALS_FILE,
    JSON.stringify(list.slice(-EXPERIMENT_MAX), null, 2),
  );
}

export function upsertExperimentProposal(proposal: ExperimentProposal): void {
  const all = loadExperimentProposals();
  const idx = all.findIndex(p => p.id === proposal.id);
  if (idx >= 0) all[idx] = proposal;
  else all.push(proposal);
  saveExperimentProposals(all);
}
