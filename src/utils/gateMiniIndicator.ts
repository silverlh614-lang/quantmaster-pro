/**
 * @responsibility 4-Gate 통과 여부 미니 인디케이터 평가 SSOT — PR-A buildGateCardSummary 재활용 (ADR-0055)
 */
import type { StockRecommendation } from '../services/stockService';
import {
  GATE1_IDS,
  GATE2_IDS,
  GATE3_IDS,
  CONDITION_PASS_THRESHOLD,
} from '../constants/gateConfig';
import { CONDITION_ID_TO_CHECKLIST_KEY } from '../types/core';
import type { ConditionId } from '../types/core';

export type GateDotState = 'PASS' | 'PARTIAL' | 'FAIL' | 'NA';

export interface GateLineSummary {
  id: 0 | 1 | 2 | 3;
  label: string;
  state: GateDotState;
  passedCount: number;
  totalCount: number;
}

export interface GateMiniSummary {
  /** 정확히 4개 (id 0/1/2/3 순서) */
  gates: GateLineSummary[];
  /** PASS 인 gate 수 (0~4) */
  passCount: number;
}

// ─── 임계값 SSOT (ADR-0055 §3.2) ────────────────────────────────────────

const PASS_RATIO = 0.5;
const PARTIAL_RATIO = 0.3;

/**
 * passedCount/totalCount → 4-tier 분류 (ADR-0055 §3.2).
 * totalCount = 0 → NA. NaN/Infinity → NA. 음수 입력 → NA.
 */
export function classifyGateState(passedCount: number, totalCount: number): GateDotState {
  if (!Number.isFinite(passedCount) || !Number.isFinite(totalCount)) return 'NA';
  if (passedCount < 0 || totalCount <= 0) return 'NA';
  const ratio = passedCount / totalCount;
  if (ratio >= PASS_RATIO) return 'PASS';
  if (ratio >= PARTIAL_RATIO) return 'PARTIAL';
  return 'FAIL';
}

function conditionPassesScore(stock: StockRecommendation, id: ConditionId): boolean {
  const key = CONDITION_ID_TO_CHECKLIST_KEY[id];
  if (!key) return false;
  const value = stock.checklist[key as keyof typeof stock.checklist];
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return value >= CONDITION_PASS_THRESHOLD;
}

function buildGateLine(
  id: 0 | 1 | 2 | 3,
  label: string,
  passedCount: number,
  totalCount: number,
): GateLineSummary {
  return {
    id,
    label,
    state: classifyGateState(passedCount, totalCount),
    passedCount,
    totalCount,
  };
}

/**
 * Gate 0 (1차 스크리너) 평가 — `gateEvaluation.gate1Passed` alias 또는 `isPassed` 사용.
 * 둘 다 undefined → NA (totalCount=0).
 */
function evaluateGate0(stock: StockRecommendation): GateLineSummary {
  const evalGate = stock.gateEvaluation;
  if (!evalGate) {
    return buildGateLine(0, 'Gate 0', 0, 0);
  }
  const passed = evalGate.gate1Passed ?? evalGate.isPassed;
  if (typeof passed !== 'boolean') {
    return buildGateLine(0, 'Gate 0', 0, 0);
  }
  return buildGateLine(0, 'Gate 0', passed ? 1 : 0, 1);
}

function evaluateGateFromIds(
  stock: StockRecommendation,
  id: 1 | 2 | 3,
  label: string,
  ids: ReadonlyArray<number>,
): GateLineSummary {
  // checklist 없으면 NA
  if (!stock.checklist || typeof stock.checklist !== 'object') {
    return buildGateLine(id, label, 0, 0);
  }
  const passedCount = ids.filter((cid) => conditionPassesScore(stock, cid as ConditionId)).length;
  return buildGateLine(id, label, passedCount, ids.length);
}

/**
 * `StockRecommendation` 1건 → 4-Gate 미니 인디케이터 요약. 외부 호출 0건, 순수 함수.
 * gates 순서는 항상 [Gate 0, Gate 1, Gate 2, Gate 3].
 */
export function evaluateGateMini(stock: StockRecommendation): GateMiniSummary {
  const gates: GateLineSummary[] = [
    evaluateGate0(stock),
    evaluateGateFromIds(stock, 1, 'Gate 1', GATE1_IDS),
    evaluateGateFromIds(stock, 2, 'Gate 2', GATE2_IDS),
    evaluateGateFromIds(stock, 3, 'Gate 3', GATE3_IDS),
  ];
  const passCount = gates.filter((g) => g.state === 'PASS').length;
  return { gates, passCount };
}
