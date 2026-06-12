// @responsibility ADR-0606 러너(추세추종) 승격 판정 순수 SSOT — 큰 수익 종목 승격 자격·넓은 트레일링 폭·잔량 전량 트랜치 스킵 여부 산출(부수효과 0, default OFF).
/**
 * exit/policies/runnerPolicy.ts — ADR-0606 Runner Mode 정책 SSOT (순수).
 *
 * "러너 = 트레일링 활성 종목 = 슬롯 카운트 제외" 단일 개념의 *판정* 레이어.
 * 큰 수익(추세) 종목을 분할익절 잔량 전량 트랜치 없이 넓은 트레일링으로 추세 끝까지
 * 추종시키기 위한 승격 자격·트레일링 폭·트랜치 스킵 여부만 산출한다.
 *
 * 본 모듈은 *결정만* 한다 — shadow mutation·텔레그램·주문·영속은 호출자(engine-dev,
 * exitEngine/rules/trancheTakeProfitLimit.ts)가 ENV 게이트 안에서 수행한다. provider/store/
 * now 호출 0 (regime/riskOnFastUpgrade.ts 분리 선례). default OFF: RUNNER_MODE_ENABLED !== 'true'.
 *
 * 배치 근거: ENV 게이트(process.env) 소비 → 서버 전용. 소비처가 exitEngine/slotAccounting 뿐이라
 * 기존 서버 exit 정책 디렉토리(shadowPaperExitSessionPolicy/r6ShadowHoldPolicy)와 동거.
 *
 * 9대 불변식: #6 결손→미승격(보수, bullish 변환 0) · #7 입력은 KIS L1 currentPrice/returnPct
 * (AI 추정 미사용) · #8 SHADOW 장부 한정(LIVE 본체 무관). flag OFF → 항상 미승격(byte-equivalent).
 */

/** ADR-0606 러너 모드 활성화 여부 — 정확 비교(=== 'true'). default OFF. */
export function isRunnerModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RUNNER_MODE_ENABLED === 'true';
}

/** ADR-0606 러너 슬롯 제외 활성화 여부 — 정확 비교(=== 'true'). default OFF. */
export function isRunnerSlotExemptionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RUNNER_SLOT_EXEMPTION_ENABLED === 'true';
}

/**
 * ADR-0606 러너 승격 절대 수익률 임계(%) — ENV RUNNER_PROMOTE_RETURN_PCT, 가드 [10, 40], default 18.
 * 마지막 LIMIT 트랜치 미도달이라도 이 수익률을 넘으면 추세 강도로 보고 승격 자격을 부여한다.
 */
export function runnerPromoteReturnPct(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.RUNNER_PROMOTE_RETURN_PCT);
  return Number.isFinite(raw) && raw >= 10 && raw <= 40 ? raw : 18;
}

/** ADR-0606 러너 트레일링 가산폭 — ENV RUNNER_TRAIL_PCT_BONUS, 가드 [0, 0.15], default 0.05. */
export function runnerTrailPctBonus(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.RUNNER_TRAIL_PCT_BONUS);
  return Number.isFinite(raw) && raw >= 0 && raw <= 0.15 ? raw : 0.05;
}

/** ADR-0606 러너 트레일링 최소폭(바닥) — ENV RUNNER_TRAIL_PCT_FLOOR, 가드 [0.10, 0.30], default 0.15. */
export function runnerTrailPctFloor(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.RUNNER_TRAIL_PCT_FLOOR);
  return Number.isFinite(raw) && raw >= 0.1 && raw <= 0.3 ? raw : 0.15;
}

/** 러너 trailPct 상한(가드) — 산식 결과를 이 값으로 clamp. 과도한 느슨함 차단. */
const RUNNER_TRAIL_PCT_HARD_CAP = 0.3;

/** 러너 승급 사유 — 진단/텔레그램/학습 라벨용(호출자가 stamp). */
export type RunnerPromotionReason =
  | 'FINAL_TRANCHE_REACHED' // 마지막 LIMIT 트랜치까지 모두 소화(잔량은 전량 트레일링 트랜치)
  | 'RETURN_THRESHOLD';     // 절대 수익률 임계(returnPct) 도달

export interface RunnerPromotionInput {
  /** KIS L1 currentPrice/shadowEntryPrice 기반 현재 수익률(%). 결손/비유한 → 미승격(보수). */
  returnPct: number;
  /**
   * 잔여(미소화) 트랜치 중 "전량 트레일링 트랜치"(=마지막 trigger:null TRAILING) 도달 여부.
   * trancheTakeProfitLimit 가 모든 LIMIT 트랜치 taken 을 확인한 시점에 true 로 넘긴다.
   * profitTranches 미설정/LIMIT 미소진 종목은 false → returnPct 경로로만 승격 평가.
   */
  finalTrancheReached: boolean;
}

export interface RunnerPromotionDecision {
  /** 러너로 승격해야 하는가. flag OFF → 항상 false(byte-equivalent). */
  promote: boolean;
  /** 승격 사유(promote=true 일 때만 의미). */
  reason?: RunnerPromotionReason;
}

/**
 * ADR-0606: 러너 승격 자격 판정(순수).
 *
 * flag OFF → 항상 promote:false(byte-equivalent). ON 일 때 두 조건의 OR:
 *   ① finalTrancheReached === true (마지막 LIMIT 트랜치까지 소화 — 잔량은 전량 트레일링)
 *   ② returnPct >= runnerPromoteReturnPct() (추세 강도 — 트랜치 미소진이라도 큰 수익이면 승격)
 *
 * returnPct 결손/비유한 → ② 미발동(불변식 #6: 결손≠signal). ① 은 가격 비의존이므로
 * returnPct 결손이라도 finalTranche 도달 시 승격 가능(기존 trailingEnabled 전이 의미 보존).
 */
export function evaluateRunnerPromotion(
  input: RunnerPromotionInput,
  env: NodeJS.ProcessEnv = process.env,
): RunnerPromotionDecision {
  if (!isRunnerModeEnabled(env)) return { promote: false };

  // ① 마지막 LIMIT 트랜치 소화 — 기존 trailingEnabled 전이 시점과 동일(가격 비의존).
  if (input.finalTrancheReached) {
    return { promote: true, reason: 'FINAL_TRANCHE_REACHED' };
  }

  // ② 절대 수익률 임계 — KIS L1 returnPct. 결손/비유한 → 미승격(보수).
  if (Number.isFinite(input.returnPct) && input.returnPct >= runnerPromoteReturnPct(env)) {
    return { promote: true, reason: 'RETURN_THRESHOLD' };
  }

  return { promote: false };
}

/**
 * ADR-0606: 러너 트레일링 낙폭 산출(순수).
 *
 * 진입 시점 trailPct 에 가산폭을 더하되 바닥(floor) 아래로 내려가지 않게 max,
 * 상한(HARD_CAP)으로 clamp. 진입 trailPct 결손/비유한 → bonus 미가산, floor 보장.
 *
 *   runnerTrailPct = clamp( max(entryTrailPct + bonus, floor), entryOrFloor, HARD_CAP )
 *
 * 결과는 항상 entry trailPct 이상(넓어지기만 함) — 러너는 추세 끝까지 추종(타이트화 금지).
 */
export function resolveRunnerTrailPct(
  entryTrailPct: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const floor = runnerTrailPctFloor(env);
  const bonus = runnerTrailPctBonus(env);
  const base = Number.isFinite(entryTrailPct) && (entryTrailPct as number) > 0
    ? (entryTrailPct as number)
    : floor;
  const widened = Math.max(base + bonus, floor);
  // 진입 trailPct 보다 좁아지지 않도록 + HARD_CAP 상한.
  return Math.min(Math.max(widened, base), RUNNER_TRAIL_PCT_HARD_CAP);
}

/**
 * ADR-0606: 분할익절 트랜치 중 "러너 승격 시 스킵 대상"인지 판정(순수).
 *
 * 스킵 대상 = 잔량 전량(ratio 가 100%, 즉 마지막 전량 트레일링 트랜치)에 해당하는 트랜치.
 * 초기 소량 LIMIT 트랜치(ratio < 1.0)는 *유지* — 러너도 초기 일부 익절은 실현한다.
 * 부동소수 오차 허용(>= 0.999 를 전량으로 간주).
 *
 * flag OFF → 항상 false(스킵 안 함, byte-equivalent). 호출자(trancheTakeProfitLimit)가
 * 승격 확정 후 본 함수로 잔량 전량 트랜치만 taken 처리 없이 건너뛴다.
 */
export function shouldSkipTrancheForRunner(
  trancheRatio: number,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isRunnerModeEnabled(env)) return false;
  return Number.isFinite(trancheRatio) && trancheRatio >= 0.999;
}
