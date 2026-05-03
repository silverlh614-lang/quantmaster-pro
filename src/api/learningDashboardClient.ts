// @responsibility Learning Sanity Dashboard 클라이언트 SDK — ADR-0177 endpoint 2종 fetch + 타입 동기 사본 (절대 규칙 #3 준수).
/**
 * learningDashboardClient.ts — ADR-0178 Phase 4-B-1
 *
 * ADR-0177 endpoint 2종 (`/api/learning/safety-gate-attribution` +
 * `/shadow-vs-live-delta`) 의 클라이언트 SDK.
 *
 * 절대 규칙 #3 — 서버 타입 직접 import 금지, 동기 사본 유지.
 */

// ── ClientGateAttributionResult (서버 GateAttributionResult 동기 사본) ─────

export type ClientGateName =
  | 'FOMC' | 'VIX' | 'R0_R1_REGIME' | 'LIQUIDITY'
  | 'DATA_SANITY' | 'EXPOSURE_BUDGET' | 'ENEMY_CHECKLIST';

export interface ClientGateAttributionResult {
  gate: ClientGateName;
  avoidedLoss: number;
  missedGain: number;
  netGateImpact: number;
  blockedWinnerCount: number;
  blockedLoserCount: number;
  gatePrecision: number;
  sampleSize: number;
}

// ── ClientDeltaCategoryResult (서버 DeltaCategoryResult 동기 사본) ─────

export type ClientDeltaCategory =
  | 'SHADOW_BUY_LIVE_BLOCKED'
  | 'LIVE_BUY_SHADOW_BETTER_SIZE'
  | 'EXPOSURE_CAP_REDUCED'
  | 'MACRO_GATE_BLOCKED'
  | 'LIQUIDITY_GATE_BLOCKED';

export interface ClientDeltaCategoryResult {
  category: ClientDeltaCategory;
  sampleSize: number;
  shadowReturnSum: number;
  liveReturnSum: number;
  missedAlpha: number;
  missedAlphaAvg: number;
}

// ── 7 GateName / 5 DeltaCategory SSOT ────────────────────────────────────

export const ALL_GATE_NAMES: readonly ClientGateName[] = [
  'FOMC', 'VIX', 'R0_R1_REGIME', 'LIQUIDITY',
  'DATA_SANITY', 'EXPOSURE_BUDGET', 'ENEMY_CHECKLIST',
];

export const ALL_DELTA_CATEGORIES: readonly ClientDeltaCategory[] = [
  'SHADOW_BUY_LIVE_BLOCKED',
  'LIVE_BUY_SHADOW_BETTER_SIZE',
  'EXPOSURE_CAP_REDUCED',
  'MACRO_GATE_BLOCKED',
  'LIQUIDITY_GATE_BLOCKED',
];

// ── fetch 함수 ──────────────────────────────────────────────────────────────

const BASE_URL = '/api/learning';

export interface FetchOptions {
  days?: number;     // 1~365, default 90
  horizon?: 1 | 3 | 5 | 20;  // default 5
}

function buildQueryString(opts?: FetchOptions): string {
  const params: string[] = [];
  if (opts?.days !== undefined) params.push(`days=${encodeURIComponent(opts.days)}`);
  if (opts?.horizon !== undefined) params.push(`horizon=${encodeURIComponent(opts.horizon)}`);
  return params.length > 0 ? `?${params.join('&')}` : '';
}

export async function fetchSafetyGateAttribution(
  opts?: FetchOptions,
): Promise<ClientGateAttributionResult[]> {
  const r = await fetch(`${BASE_URL}/safety-gate-attribution${buildQueryString(opts)}`);
  if (!r.ok) throw new Error(`safety-gate-attribution ${r.status}`);
  return (await r.json()) as ClientGateAttributionResult[];
}

export async function fetchShadowVsLiveDelta(
  opts?: FetchOptions,
): Promise<ClientDeltaCategoryResult[]> {
  const r = await fetch(`${BASE_URL}/shadow-vs-live-delta${buildQueryString(opts)}`);
  if (!r.ok) throw new Error(`shadow-vs-live-delta ${r.status}`);
  return (await r.json()) as ClientDeltaCategoryResult[];
}

// ── ClientMissedLearningQueueStats (서버 응답 schema 동기 사본, ADR-0179) ─────

export interface ClientMissedLearningQueueStats {
  pending: number;
  replayed: number;
  failed: number;
  dropped: number;
  total: number;
  lastEnqueuedAt?: string;
}

export async function fetchMissedLearningQueueStats(): Promise<ClientMissedLearningQueueStats> {
  const r = await fetch(`${BASE_URL}/missed-learning-queue-stats`);
  if (!r.ok) throw new Error(`missed-learning-queue-stats ${r.status}`);
  return (await r.json()) as ClientMissedLearningQueueStats;
}

// ── ClientRejectionShadowSummary (서버 RejectionShadowSummary 동기 사본, ADR-0180) ─────

export interface ClientRejectionShadowSummary {
  totalCount: number;
  closedCount: number;
  activeCount: number;
  avgClosedReturnPct: number;
  medianClosedReturnPct: number;
  /** 종결된 entry 중 +5% 이상 비율 (0~1) — 거짓 부정율 */
  falseNegativeRate: number;
  quartiles?: { q1: number; q2: number; q3: number };
  /** 표본 충분 여부 — false 시 falseNegativeRate 신뢰 ↓ */
  reliable?: boolean;
}

export async function fetchRejectionShadowStats(): Promise<ClientRejectionShadowSummary> {
  const r = await fetch(`${BASE_URL}/rejection-shadow-stats`);
  if (!r.ok) throw new Error(`rejection-shadow-stats ${r.status}`);
  return (await r.json()) as ClientRejectionShadowSummary;
}

// ── ClientReflectionImpactSummary (서버 응답 schema 동기 사본, ADR-0181 / ADR-0084 endpoint 재사용) ─────

export type ClientReflectionModuleStatus = 'normal' | 'grace' | 'silent' | 'deprecated';

export interface ClientReflectionModuleReport {
  module: string;
  status: ClientReflectionModuleStatus;
  impactRate: number;
  runs: number;
  meaningfulRuns: number;
  firstSeenAt: string | null;
  ageDays: number | null;
}

export interface ClientReflectionImpactSummary {
  windowDays: number;
  modules: ClientReflectionModuleReport[];
  summary: {
    total: number;
    normal: number;
    grace: number;
    silent: number;
    deprecated: number;
  };
}

export interface ReflectionImpactFetchOptions {
  /** 분석 윈도우 (일). 1~365, default 180 */
  days?: number;
}

export async function fetchReflectionImpact(
  opts?: ReflectionImpactFetchOptions,
): Promise<ClientReflectionImpactSummary> {
  const params: string[] = [];
  if (opts?.days !== undefined) params.push(`days=${encodeURIComponent(opts.days)}`);
  const qs = params.length > 0 ? `?${params.join('&')}` : '';
  const r = await fetch(`${BASE_URL}/reflection-impact${qs}`);
  if (!r.ok) throw new Error(`reflection-impact ${r.status}`);
  return (await r.json()) as ClientReflectionImpactSummary;
}

// ── ClientCounterfactualUnresolvedStats (서버 CounterfactualUnresolvedSummary 동기 사본, ADR-0182) ─────

export interface ClientCounterfactualUnresolvedStats {
  totalCount: number;
  resolved30dCount: number;
  resolved60dCount: number;
  resolved90dCount: number;
  pending30dCount: number;
  pending60dCount: number;
  pending90dCount: number;
  /** signalDate 30 영업일 미경과 (정상 대기) */
  awaitingHorizonCount: number;
  oldestSignalDate?: string;
}

export async function fetchCounterfactualUnresolvedStats(): Promise<ClientCounterfactualUnresolvedStats> {
  const r = await fetch(`${BASE_URL}/counterfactual-unresolved-stats`);
  if (!r.ok) throw new Error(`counterfactual-unresolved-stats ${r.status}`);
  return (await r.json()) as ClientCounterfactualUnresolvedStats;
}
