// @responsibility ADR-0593 risk-on fast-upgrade 순수 판정 SSOT — 폭락 다음날 강반등 3중 AND(오늘 강반등·VKOSPI 진정·breadth 우위)로 provisional R3_EARLY 승급 자격 산출(default OFF).
/**
 * riskOnFastUpgrade.ts — ADR-0593 D1 순수 평가 SSOT.
 *
 * R6 의 `kospiDayReturn < -5` 블랙스완 하락 트리거에 대칭하는 상방 트리거. 폭락 다음날
 * 강반등을 risk-on 으로 인식해 classifyRegime fall-through(R4) 직전 provisional R3_EARLY 로
 * 승급할 자격을 판정한다. 승급 캡은 R3_EARLY 까지(R2/R1 직행 금지) — 소비처(classifyRegime).
 *
 * 3중 AND (whipsaw 가드, ADR-0592 D3 "breadth + VKOSPI 동시" 패턴):
 *   ① 오늘 강반등: kospiDayReturnToday >= T (ENV REGIME_RISK_ON_FAST_UPGRADE_THRESHOLD_PCT, default 3.5)
 *   ② VKOSPI 진정: vkospiDayChange <= 0 (공포 미확산)
 *   ③ breadth 우위: advance/(advance+decline) >= 0.6
 *
 * default OFF: ENV REGIME_RISK_ON_FAST_UPGRADE_ENABLED !== 'true' → 항상 false.
 * 데이터 부재(intraday today 값/breadth 결손)·stale → 보수적 미발동(불변식 #6: 결손≠signal,
 * bullish 로도 bearish 로도 변환 금지). 순수 함수 — provider/store/now 호출 0. freshness 가드는
 * 호출자(buildRegimeVars)가 today/TTL 검사 후 kospiDayReturnToday 를 주입하거나 미설정한다.
 */

/** ADR-0593 fast-upgrade 활성화 여부 — 정확 비교(=== 'true'). default OFF. */
export function isRegimeRiskOnFastUpgradeEnabled(): boolean {
  return process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED === 'true';
}

/** ADR-0593 강반등 임계 T(%) — ENV REGIME_RISK_ON_FAST_UPGRADE_THRESHOLD_PCT, default 3.5. */
export function regimeRiskOnFastUpgradeThresholdPct(): number {
  const raw = Number(process.env.REGIME_RISK_ON_FAST_UPGRADE_THRESHOLD_PCT);
  return Number.isFinite(raw) && raw > 0 ? raw : 3.5;
}

/** ADR-0593 breadth 우위 최소 비율 — ENV REGIME_RISK_ON_FAST_UPGRADE_BREADTH_MIN_RATIO, default 0.6. */
export function regimeRiskOnFastUpgradeBreadthMinRatio(): number {
  const raw = Number(process.env.REGIME_RISK_ON_FAST_UPGRADE_BREADTH_MIN_RATIO);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.6;
}

export interface RiskOnFastUpgradeInput {
  /** 오늘 거래일 + TTL freshness 가드를 통과한 intraday KOSPI 수익률(%). 미통과/부재 시 undefined → 미발동. */
  kospiDayReturnToday?: number;
  /** VKOSPI 단일일 변화율(%). */
  vkospiDayChange: number;
  /** 시장 상승종목 비율(0~1). advance/(advance+decline). 부재 시 undefined → 미발동(보수). */
  marketBreadthAdvanceRatio?: number;
}

/**
 * ADR-0593: provisional R3_EARLY 상방 승급 자격 판정(순수).
 *
 * flag OFF → 항상 false(byte-equivalent). 3중 AND 동시 충족 시에만 true.
 * 데이터 부재(kospiDayReturnToday/breadth ratio undefined)·비유한값 → 보수적 false.
 */
export function shouldFastUpgradeToR3Early(input: RiskOnFastUpgradeInput): boolean {
  if (!isRegimeRiskOnFastUpgradeEnabled()) return false;

  // ① 오늘 강반등 — freshness-guarded today 값만 사용. 부재/비유한 → 미발동(falling-knife 방지).
  const today = input.kospiDayReturnToday;
  if (today === undefined || !Number.isFinite(today)) return false;
  if (today < regimeRiskOnFastUpgradeThresholdPct()) return false;

  // ② VKOSPI 진정 — 공포 미확산(단일일 변화율 <= 0).
  if (!Number.isFinite(input.vkospiDayChange) || input.vkospiDayChange > 0) return false;

  // ③ breadth 우위 — 부재/비유한 → 미발동(불변식 #6: 결손≠bullish).
  const ratio = input.marketBreadthAdvanceRatio;
  if (ratio === undefined || !Number.isFinite(ratio)) return false;
  if (ratio < regimeRiskOnFastUpgradeBreadthMinRatio()) return false;

  return true;
}
