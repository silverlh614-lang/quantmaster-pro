// @responsibility counterfacture_gate Phase B — gate 판정 결과를 (gate, scalar, WIN/LOSS, regime) 튜플로 투영하는 read-only SSOT (executionImpact=NONE).
/**
 * gateScoredOutcomeProjection.ts (counterfacture_gate Phase B)
 *
 * 목적 — Phase C ROC 어댑터(gateThresholdAutoTuning.evaluateThresholdShift)가 먹는
 * `{ score, outcome: 'WIN'|'LOSS' }` 표본을 게이트별로 만든다. 기존 ledger 위의
 * *on-demand 투영 뷰* — 제3의 영속 파일로 복제하지 않는다(단일 진실원천, stale 방지).
 *
 * WIN 정의는 본 모듈의 단일 SSOT(GATE_OUTCOME_WIN_RETURN_PCT/HORIZON). 이 한 값이
 * 산출 임계를 좌우하므로 ENV 로 흔들지 않는다 — 민감도 분석은 호출자(Phase C) 책임.
 *
 * 게이트별 스칼라:
 *   - GATE1 — dryRunScore (×10 스케일, 0~100; gateConfig.GATE1_SCORE_SCALE 정합)
 *   - GATE3 — rrr (×1 스케일)
 *   - GATE2 — 확장점. forward-outcome 영속 소스 미신설 → 현재 빈 배열.
 *
 * 안전: 읽기 전용 투영만, LIVE/threshold/score 변경 0, executionImpact=NONE.
 */

import {
  listGate1DryRunObservationRows,
  type Gate1DryRunObservationRow,
} from '../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js';
import { loadGate3OutcomeSeeds } from '../persistence/gate3OutcomeRepo.js';
import type { Gate3OutcomeSeed } from '../quant/gate3OutcomeSeed.js';

// ── WIN 정의 단일 SSOT ───────────────────────────────────────────────────────
/** WIN 판정 forward-return 임계(%). 산출 임계를 좌우하는 SSOT — 정적 고정. */
export const GATE_OUTCOME_WIN_RETURN_PCT = 3;
/** WIN 판정 성숙 지평 — D5(영업일 5일). 미성숙 표본은 제외된다. */
export const GATE_OUTCOME_WIN_HORIZON = 'D5' as const;

export type GateOutcomeKind = 'WIN' | 'LOSS';
export type GateOutcomeGate = 'GATE1' | 'GATE2' | 'GATE3';

export interface GateScoredOutcome {
  gate: GateOutcomeGate;
  /** ROC 대상 스칼라 — G1 dryRunScore(×10), G3 rrr(×1). */
  scalar: number;
  /** 스칼라 스케일 — ×10(0~100 관측) | ×1(0~10 live). */
  scale: 1 | 10;
  outcome: GateOutcomeKind;
  /** 레짐 stratify 키 — 미보유 시 'UNKNOWN'. */
  regime: string;
  /** WIN/LOSS 라벨 근거가 된 D5 forward return(%) — 감사/디버그용. */
  forwardReturnD5Pct: number;
  symbol: string;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeRegime(regime: string | null | undefined): string {
  const trimmed = (regime ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'UNKNOWN';
}

/**
 * D5 forward-return(%) → WIN/LOSS. 미성숙(d5 미존재) → null(표본 제외).
 * WIN: D5 ≥ GATE_OUTCOME_WIN_RETURN_PCT, 그 외 LOSS(진입 가치 없음).
 */
export function classifyGateOutcome(forwardReturnD5Pct: number | null | undefined): GateOutcomeKind | null {
  if (!finite(forwardReturnD5Pct)) return null;
  return forwardReturnD5Pct >= GATE_OUTCOME_WIN_RETURN_PCT ? 'WIN' : 'LOSS';
}

/** Gate1 — dry-run 관측 행 → scored outcome. scalar=dryRunScore(×10), regime 보유. */
export function projectGate1ScoredOutcomes(rows: readonly Gate1DryRunObservationRow[]): GateScoredOutcome[] {
  const outcomes: GateScoredOutcome[] = [];
  for (const row of rows) {
    const scalar = row.dryRunScore ?? row.finalGate1Score ?? row.actualScore;
    const d5 = row.forwardReturn5D ?? row.forwardReturnD5;
    const outcome = classifyGateOutcome(d5);
    if (!finite(scalar) || outcome === null) continue;
    outcomes.push({
      gate: 'GATE1',
      scalar,
      scale: 10,
      outcome,
      regime: normalizeRegime(row.effectiveRegime ?? row.regime),
      forwardReturnD5Pct: d5 as number,
      symbol: row.symbol,
    });
  }
  return outcomes;
}

/** Gate3 — outcome seed → scored outcome. scalar=rrr(×1). seed 에 regime 부재 → 'UNKNOWN'. */
export function projectGate3ScoredOutcomes(seeds: readonly Gate3OutcomeSeed[]): GateScoredOutcome[] {
  const outcomes: GateScoredOutcome[] = [];
  for (const seed of seeds) {
    const scalar = seed.rrr;
    const d5 = seed.forwardReturns?.d5;
    const outcome = classifyGateOutcome(d5);
    if (!finite(scalar) || outcome === null) continue;
    outcomes.push({
      gate: 'GATE3',
      scalar,
      scale: 1,
      outcome,
      regime: 'UNKNOWN',
      forwardReturnD5Pct: d5 as number,
      symbol: seed.symbol,
    });
  }
  return outcomes;
}

/**
 * Gate2 — 확장점. Gate2 confluence(coverageAdjustedScore)의 forward-outcome 영속
 * 소스가 아직 없으므로 현재는 빈 배열. 소스 신설 시 본 함수만 채우면 Phase C 가 자동 흡수.
 */
export function projectGate2ScoredOutcomes(): GateScoredOutcome[] {
  return [];
}

export interface GateScoredOutcomeBundle {
  gate1: GateScoredOutcome[];
  gate2: GateScoredOutcome[];
  gate3: GateScoredOutcome[];
  all: GateScoredOutcome[];
}

/** 모든 게이트의 mature scored outcome 수집(read-only). 영속 ledger 로드 + 투영. */
export async function collectGateScoredOutcomes(input?: {
  gate1Rows?: readonly Gate1DryRunObservationRow[];
  gate3Seeds?: readonly Gate3OutcomeSeed[];
}): Promise<GateScoredOutcomeBundle> {
  const gate1Rows = input?.gate1Rows ?? (await listGate1DryRunObservationRows());
  const gate3Seeds = input?.gate3Seeds ?? loadGate3OutcomeSeeds();
  const gate1 = projectGate1ScoredOutcomes(gate1Rows);
  const gate2 = projectGate2ScoredOutcomes();
  const gate3 = projectGate3ScoredOutcomes(gate3Seeds);
  return { gate1, gate2, gate3, all: [...gate1, ...gate2, ...gate3] };
}

/** gate × regime 그룹핑 — Phase C ROC 어댑터 입력(`${gate}:${regime}` 키). */
export function groupScoredOutcomesByGateRegime(
  outcomes: readonly GateScoredOutcome[],
): Map<string, GateScoredOutcome[]> {
  const grouped = new Map<string, GateScoredOutcome[]>();
  for (const outcome of outcomes) {
    const key = `${outcome.gate}:${outcome.regime}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(outcome);
    grouped.set(key, bucket);
  }
  return grouped;
}
