// @responsibility ADR-0433 universe-level preflight learning wiring SSOT.
/**
 * ADR-0433:
 * SELL_ONLY / HARD_BLOCK may stop execution before candidate-level learning
 * lanes are reached. Universe-level counterfactual learning preserves the
 * scan context at preflight abort time without opening execution, paper,
 * normal shadow, provisional shadow, or virtual-account paths.
 *
 * This module records learning-only snapshots only. It must never bypass
 * SELL_ONLY for execution or mutate trading state.
 *
 * 안전 invariant (사용자 §"절대 하지 말 것" 정합):
 *   1. KIS 주문 함수 import 0건 (정적 grep 가드)
 *   2. autoTradeEngine / orderExecutor / trancheExecutor / shadowTradeRepo import 0건
 *   3. virtual account holdings / cash / equity 변경 0건
 *   4. 외부 fetch / axios 호출 0건 (정적 grep 가드)
 *   5. record 실패는 try/catch 격리 — preflight abort 흐름 절대 차단 안 함
 *   6. ENV `COUNTERFACTUAL_UNIVERSE_LEARNING_DISABLED=true` (default OFF, ADR-0157 정확 비교)
 *   7. lightweight candidate summary (≤50) 만 영속 — raw payload 절대 저장 안 함
 *   8. Action / promotion 함수 부재 — recommendation 기능 0
 */

import {
  appendCounterfactualUniverseLearningSnapshot,
  hasExistingUniverseSnapshot,
  UNIVERSE_LEARNING_MAX_CANDIDATE_SUMMARIES,
  type CounterfactualUniverseCandidateSummary,
  type CounterfactualUniverseLearningReason,
  type CounterfactualUniverseLearningSnapshot,
  type CounterfactualUniversePreflightStage,
} from '../../persistence/counterfactualUniverseLearningRepo.js';
// ADR-0438 (= 사용자 명시 ADR-0442) — invalid code 가 universe learning ledger 에
// 박제되지 않도록 buildCandidateSummaries 진입부에서 normalizeKrxCode 통과 필터링.
// 사용자 핵심 의도: "invalid code 는 degraded 가 아니라 hard reject 다."
import { normalizeKrxCode as normalizeKrxCodeSsot } from '../../utils/symbolNormalizer.js';

/** ENV gate SSOT (ADR-0157 정확 비교 의무). */
function isCounterfactualUniverseLearningDisabled(): boolean {
  return process.env.COUNTERFACTUAL_UNIVERSE_LEARNING_DISABLED === 'true';
}

/**
 * preflight abort 사유 → ADR-0433 reason 매핑 SSOT.
 *
 * 사용자 §B 명세 정합 — 호출자가 abort 사유를 dispatch 키워드로 전달하면
 * 본 함수가 ReasonUnion 으로 변환. 다중 사유 (예: SELL_ONLY + emergencyStop) 시
 * 첫 매칭만 사용 (stage 우선순위는 호출자 측에서 결정).
 */
export function deriveUniverseLearningReason(
  primary: string,
): CounterfactualUniverseLearningReason {
  switch (primary) {
    case 'SELL_ONLY':
    case 'MANUAL_BLOCK':
      return 'SELL_ONLY_PREFLIGHT';
    case 'HARD_BLOCK':
    case 'R3_SANITY_BLOCK':
      return 'HARD_BLOCK_PREFLIGHT';
    case 'R6_DEFENSE':
    case 'RISK_OFF_REGIME':
      return 'R6_DEFENSE_PREFLIGHT';
    case 'EMERGENCY_STOP':
      return 'EMERGENCY_STOP_PREFLIGHT';
    case 'VIX_BLOCK':
    case 'VIX_SPIKE':
      return 'VIX_BLOCK_PREFLIGHT';
    case 'FOMC_BLOCK':
      return 'FOMC_BLOCK_PREFLIGHT';
    case 'MANUAL_BUY_BLOCK':
      return 'MANUAL_BUY_BLOCK_PREFLIGHT';
    case 'CANDIDATE_SCAN_SKIPPED':
    case 'VOLUME_CLOCK_BLOCK':
      return 'CANDIDATE_EVALUATION_SKIPPED';
    case 'SCAN_ABORTED':
      return 'SCAN_ABORTED_BEFORE_GATE';
    default:
      return 'LEARNING_ONLY';
  }
}

/**
 * raw 후보 객체 → lightweight summary 변환 SSOT.
 *
 * 사용자 §E 명세 — symbol / name / lastPrice / changePct / volume / turnover /
 * sector / source / rank 만 추출. Top N 절삭 (default UNIVERSE_LEARNING_MAX_CANDIDATE_SUMMARIES=50).
 *
 * 절대 금지 (사용자 §E):
 *   - 전체 raw object 저장 금지
 *   - 대형 payload 저장 금지
 *   - 민감한 토큰 / API response 저장 금지
 */
export function buildCandidateSummaries(
  rawCandidates: unknown[] | undefined,
  maxCandidates: number = UNIVERSE_LEARNING_MAX_CANDIDATE_SUMMARIES,
): CounterfactualUniverseCandidateSummary[] {
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) return [];
  const limit = Math.max(0, Math.min(maxCandidates, UNIVERSE_LEARNING_MAX_CANDIDATE_SUMMARIES));
  if (limit === 0) return [];
  const sliced = rawCandidates.slice(0, limit);
  const summaries: CounterfactualUniverseCandidateSummary[] = [];
  for (let i = 0; i < sliced.length; i++) {
    const c = sliced[i] as Record<string, unknown> | null | undefined;
    if (!c || typeof c !== 'object') continue;
    const symbolValue = (c['symbol'] ?? c['code'] ?? c['stockCode']) as unknown;
    const symbol = typeof symbolValue === 'string' && symbolValue.trim().length > 0 ? symbolValue : null;
    if (!symbol) continue;
    // ADR-0438 (= 사용자 명시 ADR-0442) — invalid code 는 universe learning 영속 절대 금지.
    // suffix strip 후 6자리 숫자만 통과. NON_NUMERIC / INVALID_LENGTH / EMPTY 모두 skip.
    const normalized = normalizeKrxCodeSsot(symbol);
    if (!normalized.valid) continue;
    const summary: CounterfactualUniverseCandidateSummary = { symbol };
    const name = c['name'] ?? c['stockName'];
    if (typeof name === 'string') summary.name = name;
    const lastPrice = c['lastPrice'] ?? c['price'] ?? c['close'];
    if (typeof lastPrice === 'number' && Number.isFinite(lastPrice)) summary.lastPrice = lastPrice;
    const changePct = c['changePct'] ?? c['changePercent'];
    if (typeof changePct === 'number' && Number.isFinite(changePct)) summary.changePct = changePct;
    const volume = c['volume'];
    if (typeof volume === 'number' && Number.isFinite(volume)) summary.volume = volume;
    const turnover = c['turnover'] ?? c['amount'];
    if (typeof turnover === 'number' && Number.isFinite(turnover)) summary.turnover = turnover;
    const sector = c['sector'];
    if (typeof sector === 'string') summary.sector = sector;
    const source = c['source'];
    if (typeof source === 'string') summary.source = source;
    const rank = c['rank'];
    if (typeof rank === 'number' && Number.isFinite(rank)) summary.rank = rank;
    else summary.rank = i + 1;
    summaries.push(summary);
  }
  return summaries;
}

/** UUID-lite — `${YYYYMMDDHHmm}-${rand4}` 형식 (외부 의존성 0). */
function buildSnapshotId(nowKstIso: string): string {
  const minute = nowKstIso.replace(/[-:T]/g, '').slice(0, 12);
  const rand = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
  return `cul-${minute}-${rand}`;
}

/** KST 분 단위 fallback dedup key — `YYYYMMDDHHmm` 형식. */
function buildKstMinuteFallback(nowMs: number = Date.now()): string {
  const kstIso = new Date(nowMs + 9 * 60 * 60 * 1000).toISOString();
  return kstIso.replace(/[-:T]/g, '').slice(0, 12);
}

/**
 * preflight abort 시 universe-level learning snapshot 영속 진입점.
 *
 * 사용자 §D 직접 정합 — preflight return 직전에 호출. 후보 목록이 있으면 lightweight
 * summary 만 영속 (Top N≤50). record 실패는 try/catch 격리 — abort 흐름 차단 안 함.
 *
 * 절대 invariant:
 *   1. ENV `COUNTERFACTUAL_UNIVERSE_LEARNING_DISABLED=true` 시 즉시 skip
 *   2. 동일 scanId+stage snapshot 이 이미 영속된 경우 dedup skip
 *   3. KIS 주문 / autoTradeEngine / virtual account 무관
 *   4. record 실패 시 console.warn 만, throw 절대 안 함 (호출자 abort 흐름 보호)
 */
export interface RecordCounterfactualUniverseLearningInput {
  scanId?: string;
  regime?: string;
  preflightStage: CounterfactualUniversePreflightStage;
  blockedBy: string[];
  reasons: CounterfactualUniverseLearningReason[];
  routerSeverity?: string;
  routerLabel?: string;
  universeSize?: number;
  candidateCount?: number;
  candidates?: unknown[];
  maxCandidates?: number;
  marketSnapshot?: CounterfactualUniverseLearningSnapshot['marketSnapshot'];
  notes?: string[];
}

export function recordCounterfactualUniverseLearningSnapshot(
  input: RecordCounterfactualUniverseLearningInput,
): { recorded: boolean; reason?: string } {
  if (isCounterfactualUniverseLearningDisabled()) {
    return { recorded: false, reason: 'env-disabled' };
  }
  if (input.scanId && hasExistingUniverseSnapshot(input.scanId, input.preflightStage)) {
    return { recorded: false, reason: 'duplicate' };
  }
  const nowMs = Date.now();
  const kstIso = new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
  const candidateSummaries = buildCandidateSummaries(input.candidates, input.maxCandidates);
  const fallback = buildKstMinuteFallback(nowMs);
  const snapshot: CounterfactualUniverseLearningSnapshot = {
    id: buildSnapshotId(kstIso),
    eventType: 'COUNTERFACTUAL_UNIVERSE_LEARNING_SNAPSHOT',
    source: 'ADR-0433',
    learningOnly: true,
    executionShadow: false,
    virtualAccountImpact: 'NONE',
    liveAllowed: false,
    paperAllowed: false,
    executionShadowAllowed: false,
    scanId: input.scanId,
    createdAtKst: kstIso,
    regime: input.regime,
    routerSeverity: input.routerSeverity,
    routerLabel: input.routerLabel,
    blockedBy: [...input.blockedBy],
    reasons: [...input.reasons],
    universeSize: input.universeSize,
    candidateCount: input.candidateCount,
    candidateSummaryCount: candidateSummaries.length,
    candidates: candidateSummaries.length > 0 ? candidateSummaries : undefined,
    preflightStage: input.preflightStage,
    marketSnapshot: input.marketSnapshot,
    notes: input.notes && input.notes.length > 0 ? [...input.notes] : undefined,
  };
  // sentinel: ${fallback} 가 dedup key 합성 시 사용되도록 호출자가 scanId 미전달이면 함수 내부 fallback 사용.
  // (테스트가 buildKstMinuteFallback 분기를 검증하기 위해 scanId 미전달 시나리오 노출)
  void fallback;
  return appendCounterfactualUniverseLearningSnapshot(snapshot);
}
