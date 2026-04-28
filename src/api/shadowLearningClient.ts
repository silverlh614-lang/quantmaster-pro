// @responsibility Shadow Learning Dashboard 클라이언트 SDK — Rejection + Twin + Attribution fetch.
/**
 * shadowLearningClient.ts — ADR-0088 Shadow Learning UI Dashboard
 *
 * 서버 endpoint 3종 (`/api/learning/rejection-shadow` + `/twin-portfolio` +
 * `/condition-attribution-shadow`) 의 클라이언트 SDK + 타입 동기 사본.
 *
 * 절대 규칙 #3 (서버↔클라 직접 import 금지) 준수 — 서버 타입을 클라에서 그대로 import
 * 하지 않고 동기 사본 유지.
 */

// ── 타입 동기 사본 ──────────────────────────────────────────────────────────────

export interface ClientRejectionShadowEntry {
  id: string;
  stockCode: string;
  stockName: string;
  signalDate: string;
  signalPriceKrw: number;
  gateScore: number;
  scoreDelta: number;
  rejectionReason: string;
  trackUntil: string;
  currentReturnPct?: number;
  lastUpdatedAt?: string;
  closed?: boolean;
  conditionScores?: Record<number, number>;
}

export interface ClientRejectionSummary {
  totalCount: number;
  closedCount: number;
  activeCount: number;
  avgClosedReturnPct: number;
  medianClosedReturnPct: number;
  falseNegativeRate: number;
  quartiles: { q1: number; q2: number; q3: number };
  reliable: boolean;
}

export interface RejectionShadowResponse {
  summary: ClientRejectionSummary;
  entries: ClientRejectionShadowEntry[];
  totalCount: number;
}

export type ClientTwinKey = 'AGGRESSIVE' | 'DISCIPLINED' | 'EQUAL_WEIGHT';

export interface ClientTwinEntry {
  id: string;
  twin: ClientTwinKey;
  stockCode: string;
  stockName: string;
  signalDate: string;
  signalGateScore: number;
  entryPrice: number;
  positionWeight: number;
  trackUntil: string;
  currentReturnPct?: number;
  lastUpdatedAt?: string;
  status: 'OPEN' | 'CLOSED';
  exitPrice?: number;
  exitDate?: string;
}

export interface ClientTwinStats {
  twin: ClientTwinKey;
  activeCount: number;
  closedCount: number;
  avgReturnPct: number;
  cumReturnPct: number;
  weeklySharpeProxy: number;
}

export interface ClientTwinComparison {
  perTwin: Record<ClientTwinKey, ClientTwinStats>;
  realCumReturnPct: number;
  weekWinning: Record<ClientTwinKey, boolean>;
}

export interface TwinPortfolioResponse {
  comparison: ClientTwinComparison;
  entries: ClientTwinEntry[];
  realCumReturnPct: number;
  totalCount: number;
}

export type ClientShadowConditionClassification =
  | 'normal'
  | 'over_strict_candidate'
  | 'good_defense_candidate'
  | 'insufficient';

export interface ClientShadowConditionStat {
  conditionId: number;
  conditionName: string;
  overStrictCount: number;
  goodDefenseCount: number;
  overStrictAvgReturn: number;
  goodDefenseAvgReturn: number;
  ratio: number;
  classification: ClientShadowConditionClassification;
}

export interface ShadowAttributionResponse {
  totalConditions: number;
  status: 'OK' | 'DISABLED' | 'NO_DATA';
  closedSampleSize: number;
  conditions: ClientShadowConditionStat[];
  summary: {
    overStrictCandidates: number;
    goodDefenseCandidates: number;
    insufficient: number;
    normal: number;
  };
}

// ── fetch 함수 ─────────────────────────────────────────────────────────────────

const BASE_URL = '/api/learning';

export async function fetchRejectionShadow(limit = 50): Promise<RejectionShadowResponse> {
  const r = await fetch(`${BASE_URL}/rejection-shadow?limit=${encodeURIComponent(limit)}`);
  if (!r.ok) throw new Error(`rejection-shadow ${r.status}`);
  return (await r.json()) as RejectionShadowResponse;
}

export async function fetchTwinPortfolio(): Promise<TwinPortfolioResponse> {
  const r = await fetch(`${BASE_URL}/twin-portfolio`);
  if (!r.ok) throw new Error(`twin-portfolio ${r.status}`);
  return (await r.json()) as TwinPortfolioResponse;
}

export async function fetchShadowAttribution(): Promise<ShadowAttributionResponse> {
  const r = await fetch(`${BASE_URL}/condition-attribution-shadow`);
  if (!r.ok) throw new Error(`condition-attribution-shadow ${r.status}`);
  return (await r.json()) as ShadowAttributionResponse;
}

export const ALL_TWIN_KEYS: ClientTwinKey[] = ['AGGRESSIVE', 'DISCIPLINED', 'EQUAL_WEIGHT'];
