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
