// @responsibility ADR-0174 §2.1 SafetyGateAttribution — 7 게이트 사후 효과 분석 SSOT (Phase 2a 호출자 0건 dead code)
/**
 * safetyGateAttribution.ts (ADR-0174 §2.1) — Phase 2a 영속 분석 SSOT.
 *
 * 매매 금지일 (FOMC/VIX/R0_R1/Liquidity/Manual/KRX_HOLIDAY_REPLAY/RISK_OFF) 게이트의
 * **사후 효과** (avoidedLoss / missedGain / netGateImpact / gatePrecision) 측정 — Phase 1
 * `ShadowLearningOnlySignal` 영속 위에 *read-only 분석* SSOT.
 *
 * Phase 2a dead code:
 *   - 호출자 0건 (Phase 4 Dashboard / Phase 2b cron read 호출 예정)
 *   - signalScanner / entryEngine / exitEngine 본체 무수정
 *   - LIVE 매매 본체 0줄 변경
 *
 * 안전 invariant 5종 (ADR-0174 §3, ARCHITECTURE.md):
 *   1. LIVE 매매 본체 0줄 변경
 *   2. KIS 주문 함수 (placeKisMarketOrder/placeKisSellOrder/cancelKisOrder/
 *      placeKisStopLossOrder/placeKisTakeProfitOrder) import 0건 — 정적 grep 가드
 *   3. 외부 의존성 0 (fs/외부 API/zustand store 미사용 — 순수 함수)
 *   4. ENV `SAFETY_GATE_ATTRIBUTION_ENABLED` default OFF (`=== 'true'` 정확 비교)
 *   5. 호출자 0건 Phase 2a dead code (정적 grep 가드)
 *
 * 게이트 매핑 SSOT (ADR-0174 §2.1, ShadowLearningOnlyScanReason union → GateName):
 *   - FOMC_BLOCK → FOMC
 *   - VIX_SPIKE → VIX
 *   - RISK_OFF_REGIME / R0_CRISIS / R1_DEFENSIVE → R0_R1_REGIME (3:1 통합)
 *   - LIQUIDITY_BLOCK → LIQUIDITY
 *   - MANUAL_BLOCK / KRX_HOLIDAY_REPLAY → 분류 제외 (운영자 수동 / 휴장일 replay)
 *
 * DATA_SANITY is activated by R3_SANITY_BLOCK.
 *   - 본 PR 은 7 GateName 모두 entry 반환 (sampleSize=0 dead 일관성)
 *
 * 해석 (사용자 §3 정합):
 *   - netGateImpact > 0 — 게이트가 손실 방지에 기여
 *   - netGateImpact < 0 — 과보호 가능성 (게이트 완화 검토)
 *   - blockedWinnerCount 급증 → 게이트 완화 후보
 *   - blockedLoserCount 급증 → 게이트 유지 또는 강화
 */

import type {
  ShadowLearningOnlySignal,
  ShadowLearningOnlyScanReason,
} from '../trading/shadowLearningOnlyScan.js';

// ─── 타입 SSOT ────────────────────────────────────────────────────────────────

/**
 * 7 게이트 — Phase 1 ShadowLearningOnlyScanReason 매핑 + Phase 3 wiring 후 활성 2 dead.
 *
 * 5 활성:
 *   - FOMC / VIX / R0_R1_REGIME / LIQUIDITY (Phase 1 reason 매핑)
 * 2 dead (Phase 3 wiring 후 활성화):
 *   - DATA_SANITY (safePctChangeStrict ADR-0117 trigger)
 *   - EXPOSURE_BUDGET (regimeExposurePolicy ADR-0166 trigger)
 *   - ENEMY_CHECKLIST (enemyChecklist ADR trigger)
 */
export type GateName =
  | 'FOMC'
  | 'VIX'
  | 'R0_R1_REGIME'
  | 'LIQUIDITY'
  | 'DATA_SANITY'
  | 'EXPOSURE_BUDGET'
  | 'ENEMY_CHECKLIST';

export interface GateAttributionResult {
  gate: GateName;
  /** 양수 (절댓값) — 차단된 종목 중 future return < 0 의 |sum|. */
  avoidedLoss: number;
  /** 양수 — 차단된 종목 중 future return > 0 의 sum. */
  missedGain: number;
  /** 양수=손실 방지 / 음수=과보호 (= avoidedLoss - missedGain). */
  netGateImpact: number;
  blockedWinnerCount: number;
  blockedLoserCount: number;
  /** blockedLoser / (blockedWinner + blockedLoser). 표본 0건 시 NaN. */
  gatePrecision: number;
  sampleSize: number;
}

export interface SafetyGateAttributionOptions {
  /** lookback 기간 (일). default 90. */
  lookbackDays?: number;
  /** future return 평가 horizon (1/3/5/20일). default 5. */
  futureReturnHorizon?: 1 | 3 | 5 | 20;
  /** Closed-loop policy callers may opt into their own ENV gate. */
  ignoreEnvGate?: boolean;
}

// ─── 상수 SSOT ────────────────────────────────────────────────────────────────

export const DEFAULT_LOOKBACK_DAYS = 90;
export const DEFAULT_FUTURE_RETURN_HORIZON: 1 | 3 | 5 | 20 = 5;

/**
 * 7 GateName 모두 결과 반환 — sampleSize=0 dead entry 도 호출자 일관성 위해 항상 포함.
 * Phase 4 Dashboard 가 11 지표 UI 에서 누락 인지 가능.
 */
export const ALL_GATE_NAMES: readonly GateName[] = [
  'FOMC',
  'VIX',
  'R0_R1_REGIME',
  'LIQUIDITY',
  'DATA_SANITY',
  'EXPOSURE_BUDGET',
  'ENEMY_CHECKLIST',
] as const;

// ─── ENV 헬퍼 ─────────────────────────────────────────────────────────────────

/**
 * ENV `SAFETY_GATE_ATTRIBUTION_ENABLED=true` 정확 비교.
 *   - `'1'` / `'TRUE'` / 임의 truthy 모두 거부
 *   - default OFF — Phase 4 Dashboard 또는 Phase 2b cron read 후 활성화
 */
export function isSafetyGateAttributionEnabled(): boolean {
  return process.env.SAFETY_GATE_ATTRIBUTION_ENABLED === 'true';
}

// ─── 게이트 매핑 SSOT ─────────────────────────────────────────────────────────

/**
 * Phase 1 ShadowLearningOnlyScanReason → GateName 매핑.
 *
 * 매핑 부재 시 null — 호출자가 분류 제외 (continue).
 * MANUAL_BLOCK / KRX_HOLIDAY_REPLAY 는 학습 게이트가 아니라 분류 제외.
 */
function mapReasonToGate(reason: ShadowLearningOnlyScanReason): GateName | null {
  switch (reason) {
    case 'FOMC_BLOCK':
      return 'FOMC';
    case 'VIX_SPIKE':
      return 'VIX';
    case 'RISK_OFF_REGIME':
    case 'R0_CRISIS':
    case 'R1_DEFENSIVE':
      return 'R0_R1_REGIME';
    case 'LIQUIDITY_BLOCK':
      return 'LIQUIDITY';
    case 'R3_SANITY_BLOCK':
      return 'DATA_SANITY';
    case 'MANUAL_BLOCK':
    case 'KRX_HOLIDAY_REPLAY':
      return null;
    default:
      // exhaustive check — 새 reason 추가 시 컴파일러 fail
      return null;
  }
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/**
 * signal 의 horizon 별 future return 추출.
 * undefined / NaN / Infinity 시 null 반환 (호출자 분류 제외).
 */
function getFutureReturn(
  signal: ShadowLearningOnlySignal,
  horizon: 1 | 3 | 5 | 20,
): number | null {
  let value: number | undefined;
  switch (horizon) {
    case 1:
      value = signal.futureReturn1d;
      break;
    case 3:
      value = signal.futureReturn3d;
      break;
    case 5:
      value = signal.futureReturn5d;
      break;
    case 20:
      value = signal.futureReturn20d;
      break;
    default:
      return null;
  }
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

/**
 * KST YYYY-MM-DD 일자를 ms 로 변환 (lookbackDays 비교용).
 * 잘못된 형식 → null (호출자 분류 제외).
 *
 * 외부 의존성 0 invariant — 자체 inline 변환.
 */
function parseSignalDateKstMs(signalDate: string): number | null {
  if (typeof signalDate !== 'string' || signalDate.length < 10) return null;
  // YYYY-MM-DD 또는 ISO — Date(`${date}T00:00:00Z`) UTC 자정 기준 ms
  const ymd = signalDate.slice(0, 10);
  // YYYY-MM-DD 형식 검증 (정규식 inline — 외부 의존성 0)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const ms = new Date(`${ymd}T00:00:00Z`).getTime();
  if (!Number.isFinite(ms)) return null;
  return ms;
}

// ─── 진입점 ───────────────────────────────────────────────────────────────────

/**
 * 7 게이트 사후 효과 측정 — 사용자 §3 명세 정합.
 *
 * 동작:
 *   1. ENV OFF → 빈 배열 즉시 반환
 *   2. lookbackDays 필터 → (now - lookbackDays) 이후 signal 만 포함
 *   3. signal.blockedReason → GateName 매핑 (mapReasonToGate)
 *   4. horizon 별 future return 추출 (NaN/undefined 제외)
 *   5. 게이트별 누적: avoidedLoss (fr<0 |sum|) / missedGain (fr>0 sum) /
 *      blockedWinner (fr>0 카운트) / blockedLoser (fr<0 카운트)
 *   6. 7 GateName 모두 entry 반환 (sampleSize=0 dead 포함, 호출자 일관성)
 *
 * 입력 — `loadShadowLearningOnlySignals()` 영속 read 결과 (호출자 책임).
 * 본 함수는 *순수* — fs/외부 API 호출 0건.
 *
 * @returns ENV OFF → [] / ENV ON → 7 GateName entry (sampleSize=0 dead 포함)
 */
export function computeSafetyGateAttribution(
  signals: ShadowLearningOnlySignal[],
  options?: SafetyGateAttributionOptions,
): GateAttributionResult[] {
  if (!options?.ignoreEnvGate && !isSafetyGateAttributionEnabled()) return [];

  const lookbackDays = options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const horizon = options?.futureReturnHorizon ?? DEFAULT_FUTURE_RETURN_HORIZON;

  // 7 GateName 누적기 초기화 (sampleSize=0 dead 일관성)
  const buckets = new Map<
    GateName,
    {
      avoidedLoss: number;
      missedGain: number;
      blockedWinnerCount: number;
      blockedLoserCount: number;
      sampleSize: number;
    }
  >();
  for (const gate of ALL_GATE_NAMES) {
    buckets.set(gate, {
      avoidedLoss: 0,
      missedGain: 0,
      blockedWinnerCount: 0,
      blockedLoserCount: 0,
      sampleSize: 0,
    });
  }

  // lookback cutoff — now - lookbackDays
  const nowMs = Date.now();
  const cutoffMs = nowMs - lookbackDays * 24 * 60 * 60 * 1000;

  for (const signal of signals) {
    // 1. lookback 필터
    const sigMs = parseSignalDateKstMs(signal.signalDate);
    if (sigMs === null) continue;
    if (sigMs < cutoffMs) continue;

    // 2. 게이트 매핑
    const gate = mapReasonToGate(signal.blockedReason);
    if (gate === null) continue;

    // 3. future return 추출 (NaN/undefined 제외)
    const fr = getFutureReturn(signal, horizon);
    if (fr === null) continue;

    // 4. 누적 — bucket 항상 존재 (ALL_GATE_NAMES 사전 초기화)
    const bucket = buckets.get(gate);
    if (!bucket) continue; // 안전 fallback (도달 불가)

    bucket.sampleSize += 1;
    if (fr < 0) {
      bucket.avoidedLoss += Math.abs(fr);
      bucket.blockedLoserCount += 1;
    } else if (fr > 0) {
      bucket.missedGain += fr;
      bucket.blockedWinnerCount += 1;
    }
    // fr === 0 → BE, 카운트 안 함 (사용자 §3 정합)
  }

  // 결과 합성 — 7 GateName 모두 entry (호출자 일관성)
  return ALL_GATE_NAMES.map((gate) => {
    const bucket = buckets.get(gate);
    if (!bucket) {
      // 도달 불가, 안전 fallback
      return {
        gate,
        avoidedLoss: 0,
        missedGain: 0,
        netGateImpact: 0,
        blockedWinnerCount: 0,
        blockedLoserCount: 0,
        gatePrecision: NaN,
        sampleSize: 0,
      };
    }
    const totalForPrecision = bucket.blockedWinnerCount + bucket.blockedLoserCount;
    const gatePrecision =
      totalForPrecision === 0
        ? NaN
        : bucket.blockedLoserCount / totalForPrecision;
    return {
      gate,
      avoidedLoss: bucket.avoidedLoss,
      missedGain: bucket.missedGain,
      netGateImpact: bucket.avoidedLoss - bucket.missedGain,
      blockedWinnerCount: bucket.blockedWinnerCount,
      blockedLoserCount: bucket.blockedLoserCount,
      gatePrecision,
      sampleSize: bucket.sampleSize,
    };
  });
}
