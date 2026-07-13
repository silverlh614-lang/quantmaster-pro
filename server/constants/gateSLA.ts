// @responsibility 게이트 통과율 SLA 매트릭스 SSOT + 계산 헬퍼 (ADR-0323)
/**
 * gateSLA.ts (ADR-0323) — 게이트별 통과율 SLA 정의 + 계산 SSOT.
 *
 * 사용자 5/6 명시 — 각 게이트의 통과율 목표 범위를 SLA로 정의하고 위반 시 경보.
 *
 * 본 PR scope (Phase 1):
 *   - SLA 매트릭스 SSOT 상수 (실제 scanTrace stages 키 기준)
 *   - calculateGatePassRate / evaluateGateSLA 순수 함수
 *   - ENV `GATE_SLA_DISABLED=true` 우회 (ADR-0157 정확 비교 의무)
 *   - cron 발화 + 텔레그램 알림 wiring 은 후속 PR 분리 (회귀 위험 격리)
 *
 * scanTrace stages 실제 키 (server/trading/signalScanner/perSymbol/buyListLoop.ts +
 * entryGates/*.ts grep 결과):
 *   - price (PASS/FAIL)
 *   - drift (PASS/FAIL/REMOVE/UPDATE/DATA_HOLD/CORPORATE_ACTION/CORPORATE_ACTION_REMOVE)
 *   - rrr (PASS/FAIL(...))
 *   - portfolioRisk (BLOCK 사유, 통과 시 미작성)
 *   - sectorGuard (BLOCK 사유, 통과 시 미작성)
 *   - timeframeConfluence (FAIL(N/M), 통과 시 미작성)
 *   - gate (PASS/FAIL/DATA_HOLD/CORPORATE_ACTION 등 entryRevalidation 결과)
 *   - buy (SHADOW/LIVE — 진입 outcome 마커, FAIL 아님)
 *
 * 사용자 spec 의 가공 키 (cooldownGate/blacklistGate/kelly/supplyHealth) 는 scanTrace
 * stages 에 직접 영속되지 않음. 본 매트릭스는 *실제 측정 가능한 키* 만 등재 — 미측정
 * 키는 후속 PR 에서 stageLog 추가 후 등재 (회귀 위험 격리).
 *
 * pass 정의: stage value === 'PASS' (FAIL/BLOCK/DATA_HOLD/REMOVE 등은 모두 미통과).
 */

import type { ScanTrace } from '../trading/scanTracer.js';

/**
 * SLA 정의 — { min, max } pass rate 정상 범위.
 *
 *   - min 미만 → OVER_CONSERVATIVE (게이트 과보수, 임계 완화 후보)
 *   - max 초과 → OVER_PERMISSIVE (게이트 과개방, 안전망 미작동 의심)
 *   - 표본 < MIN_SAMPLE → INSUFFICIENT_SAMPLE (판정 보류)
 *
 * 임계는 운영 데이터 누적 후 ADR-0325 (게이트 임계 자기 진화) 가 자동 조정 가능.
 */
export const GATE_PASS_RATE_SLA: Record<string, { min: number; max: number }> = {
  /** 가격 fetch 실패 — 95% 이상 통과 정상 (KIS/Yahoo 안정 시) */
  price:               { min: 0.95, max: 1.00 },
  /** entryPrice drift — 70% 이상 PASS 정상 (DATA_HOLD/CORPORATE_ACTION 자연 비율 30% 이내) */
  drift:               { min: 0.70, max: 1.00 },
  /** RRR — 60~95% (강세장 발화 더 많음 정상) */
  rrr:                 { min: 0.60, max: 0.95 },
  /** 포트폴리오 리스크 — 80% 이상 통과 정상 (PASS 시 미작성이라 *기록된* 비율) */
  portfolioRisk:       { min: 0.80, max: 1.00 },
  /** 섹터 사전 가드 — 70% 이상 통과 정상 */
  sectorGuard:         { min: 0.70, max: 1.00 },
  /** 멀티타임프레임 합치도 — 50~90% (보수적 게이트) */
  timeframeConfluence: { min: 0.50, max: 0.90 },
  /** entryRevalidation — 가장 보수적 (40% 이하면 비정상 차단 누적) */
  gate:                { min: 0.40, max: 0.80 },
};

/** 통계 신뢰도 임계 — 표본 N개 이상이어야 SLA 판정 활성. */
export const GATE_SLA_MIN_SAMPLE = 10;

type GateSLAStatus =
  | 'OK'
  | 'OVER_CONSERVATIVE'
  | 'OVER_PERMISSIVE'
  | 'NO_SLA'
  | 'INSUFFICIENT_SAMPLE';

export interface GatePassRateResult {
  stageKey: string;
  passed: number;
  total: number;
  passRate: number;
}

export interface GateSLAResult extends GatePassRateResult {
  status: GateSLAStatus;
  slaMin: number | null;
  slaMax: number | null;
}

/** ENV `GATE_SLA_DISABLED=true` → 모든 SLA 평가 비활성 (ADR-0157 정확 비교). */
export function isGateSLADisabled(): boolean {
  return process.env.GATE_SLA_DISABLED === 'true';
}

/**
 * 단일 stage 키의 pass rate 계산. PASS 외(FAIL/BLOCK/DATA_HOLD 등) 는 모두 미통과.
 * stage 키가 trace 에 부재한 경우 카운트 제외 (게이트 미평가 — 다른 단계서 조기 차단).
 *
 * @returns passed / total / passRate (total=0 시 1.0 default — SLA 평가는 별도 INSUFFICIENT_SAMPLE)
 */
export function calculateGatePassRate(stageKey: string, traces: ScanTrace[]): GatePassRateResult {
  let passed = 0;
  let total = 0;
  for (const t of traces) {
    if (!t || !t.stages) continue;
    const value = t.stages[stageKey];
    if (value === undefined || value === null) continue;
    total += 1;
    if (value === 'PASS') passed += 1;
  }
  return {
    stageKey,
    passed,
    total,
    passRate: total > 0 ? passed / total : 1,
  };
}

/**
 * 단일 stage 키 SLA 평가.
 *
 * 분기 우선순위:
 *   1. ENV DISABLED → 모든 stage NO_SLA (사용자 명시 우회)
 *   2. SLA 매트릭스 미등재 → NO_SLA
 *   3. 표본 < MIN_SAMPLE → INSUFFICIENT_SAMPLE
 *   4. passRate < min → OVER_CONSERVATIVE
 *   5. passRate > max → OVER_PERMISSIVE
 *   6. 그 외 → OK
 */
export function evaluateGateSLA(stageKey: string, traces: ScanTrace[]): GateSLAResult {
  const calc = calculateGatePassRate(stageKey, traces);
  if (isGateSLADisabled()) {
    return { ...calc, status: 'NO_SLA', slaMin: null, slaMax: null };
  }
  const sla = GATE_PASS_RATE_SLA[stageKey];
  if (!sla) {
    return { ...calc, status: 'NO_SLA', slaMin: null, slaMax: null };
  }
  if (calc.total < GATE_SLA_MIN_SAMPLE) {
    return { ...calc, status: 'INSUFFICIENT_SAMPLE', slaMin: sla.min, slaMax: sla.max };
  }
  if (calc.passRate < sla.min) {
    return { ...calc, status: 'OVER_CONSERVATIVE', slaMin: sla.min, slaMax: sla.max };
  }
  if (calc.passRate > sla.max) {
    return { ...calc, status: 'OVER_PERMISSIVE', slaMin: sla.min, slaMax: sla.max };
  }
  return { ...calc, status: 'OK', slaMin: sla.min, slaMax: sla.max };
}

/**
 * 매트릭스의 모든 등재 stage 키에 대해 일괄 SLA 평가.
 * 호출자(후속 PR cron) 가 status='OVER_*' 만 필터링해 텔레그램 알림 합성.
 */
export function evaluateAllGateSLA(traces: ScanTrace[]): GateSLAResult[] {
  return Object.keys(GATE_PASS_RATE_SLA).map(key => evaluateGateSLA(key, traces));
}
