/**
 * @responsibility Today's One Decision API 클라이언트 — decisionInputsRouter 호출 (ADR-0046 PR-Z4)
 */

/** 서버 DecisionInputs 동기 사본 (절대 규칙 #3 — 서버↔클라 직접 import 금지). */
export interface DecisionInputsPendingApproval {
  stockCode: string;
  stockName: string;
  ageMs: number;
}

export interface DecisionInputsMacroSignals {
  vkospi?: number;
  vkospiDayChange?: number;
  vix?: number;
  vixHistory?: number[];
  bearDefenseMode?: boolean;
  fssAlertLevel?: string;
  regime?: string;
}

export interface DecisionInputs {
  emergencyStop: boolean;
  pendingApprovals: DecisionInputsPendingApproval[];
  macroSignals: DecisionInputsMacroSignals;
  capturedAt: string;
}

/** GET /api/decision/inputs */
export async function fetchDecisionInputs(): Promise<DecisionInputs> {
  const res = await fetch('/api/decision/inputs');
  if (!res.ok) {
    throw new Error(`fetch /api/decision/inputs failed: ${res.status}`);
  }
  return (await res.json()) as DecisionInputs;
}
