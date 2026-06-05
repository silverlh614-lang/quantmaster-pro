// @responsibility R6 방어 진입 레인 SSOT — 폭락(R6 DEFENSE/PANIC)에서 우량주 과매도+RS 방어 후보 평가 (flag-gate, default OFF, Phase1 shadow-only).
/**
 * defensiveEntryLane.ts (ADR-0575 Phase1)
 *
 * 배경: 이 시스템은 모멘텀/돌파 매수기(Gate1=breakout_momentum·turtle_high·RS)라 R6(폭락)
 * 에선 점수가 구조적으로 0 → 매수 0. 사용자 전략: "폭락=기회 — 방어적 매수가 일어나야 한다".
 * 이를 위해 모멘텀 레인과 *별개*의 방어 진입 레인을 신설한다.
 *
 * 진입 기준(전부 충족, 조합 = 과매도 + RS 방어 + 우량):
 *   ① 우량: 재무 견조(부채비율 < QUALITY_DEBT_RATIO_MAX, 흑자/ROE ≥ QUALITY_ROE_MIN) +
 *           (시총 대형 or 미상). 폭락에서 "낙는 칼"을 피하려면 known-good 품질만.
 *   ② 과매도: 60일 고점 대비 OVERSOLD_DROP_FROM_HIGH_PCT 이상 하락 + RSI(14) < OVERSOLD_RSI_MAX.
 *   ③ RS 방어: 20일 상대수익률(vs KOSPI) > RS_DEFENSE_MIN (시장보다 덜 빠진 우량주).
 *
 * 사이징: DEFENSE → ×DEFENSE_KELLY_MULT, PANIC(BLACK_SWAN/KOSPI_CRASH) → ×PANIC_KELLY_MULT(더 축소).
 *
 * Phase1: **shadow 전용** — 평가만 하고 live·실주문 0. 기존 모멘텀 레인 무영향. flag OFF=미평가.
 * 활성: ENV `DEFENSIVE_ENTRY_LANE_ENABLED=true`. Phase2(live 허용)는 shadow 검증 후 별도 flag.
 *
 * 본 모듈은 *순수 함수* — env 검사는 isDefensiveEntryLaneEnabled() 헬퍼로 분리, 호출측이 gate.
 */

/** 60일 고점 대비 하락 임계(과매도) — 0.20 = −20%↓. */
export const OVERSOLD_DROP_FROM_HIGH_PCT = 0.20;
/** 과매도 RSI(14) 상한 — 미만이어야 통과. */
export const OVERSOLD_RSI_MAX = 35;
/** RS 방어 임계 — 20일 상대수익률(vs KOSPI) 이 초과여야(덜 빠짐). */
export const RS_DEFENSE_MIN = 0;
/** 우량 부채비율(%) 상한. */
export const QUALITY_DEBT_RATIO_MAX = 150;
/** 우량 ROE(%) 하한 — 이상이어야(흑자). */
export const QUALITY_ROE_MIN = 0;
/** DEFENSE 사이징 배수. */
export const DEFENSE_KELLY_MULT = 0.30;
/** PANIC(실폭락) 사이징 배수 — 더 축소. */
export const PANIC_KELLY_MULT = 0.15;

export type DefensiveRegimeLevel = 'DEFENSE' | 'PANIC';

export interface DefensiveEntryInput {
  /** 현재가. */
  currentPrice: number;
  /** 60일 최고가(과매도 기준선). */
  high60d: number;
  /** RSI(14). */
  rsi14: number;
  /** 20일 상대수익률(vs KOSPI), % 또는 비율 — > RS_DEFENSE_MIN 이면 방어. */
  relativeReturn20d: number;
  /** 부채비율(%) — null 이면 품질 미확인(보수적 탈락). */
  debtRatio: number | null;
  /** ROE(%) — null 이면 품질 미확인(보수적 탈락). */
  roe: number | null;
  /** 시총 등급(있으면) — 'LARGE' 외이면 품질 탈락, 미상이면 재무로만 판단. */
  marketCapTier?: 'LARGE' | 'MID' | 'SMALL' | null;
  /** R6 등급 — PANIC 이면 더 축소 사이징. */
  regime: DefensiveRegimeLevel;
}

export interface DefensiveEntryVerdict {
  qualifies: boolean;
  criteria: { quality: boolean; oversold: boolean; rsDefense: boolean };
  /** 축소 Kelly 배수(qualifies 시) — DEFENSE 0.30 / PANIC 0.15. */
  reducedKellyMultiplier: number;
  regime: DefensiveRegimeLevel;
  reasons: string[];
}

export function isDefensiveEntryLaneEnabled(): boolean {
  // default OFF — 명시적으로 'true' 일 때만 활성(ADR-0157 정확 비교).
  return process.env.DEFENSIVE_ENTRY_LANE_ENABLED === 'true';
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * 방어 진입 후보 평가(순수). 세 축 전부 충족해야 qualifies.
 * 품질 데이터(재무) 부재는 보수적으로 탈락(폭락에 미상 품질 매수 금지).
 */
export function evaluateDefensiveEntryLane(input: DefensiveEntryInput): DefensiveEntryVerdict {
  const reasons: string[] = [];

  // ① 우량: 재무 견조 + (시총 대형 or 미상). 재무 미상이면 탈락(보수적).
  const capOk = input.marketCapTier == null || input.marketCapTier === 'LARGE';
  const debtOk = finite(input.debtRatio) && input.debtRatio < QUALITY_DEBT_RATIO_MAX;
  const roeOk = finite(input.roe) && input.roe >= QUALITY_ROE_MIN;
  const quality = capOk && debtOk && roeOk;
  if (!capOk) reasons.push(`quality: 시총 비대형(${input.marketCapTier})`);
  if (!debtOk) reasons.push(`quality: 부채비율 ${finite(input.debtRatio) ? input.debtRatio : 'N/A'} ≥ ${QUALITY_DEBT_RATIO_MAX} 또는 미상`);
  if (!roeOk) reasons.push(`quality: ROE ${finite(input.roe) ? input.roe : 'N/A'} < ${QUALITY_ROE_MIN} 또는 미상`);

  // ② 과매도: 60일 고점 대비 −X%↓ + RSI < max.
  const dropOk =
    finite(input.currentPrice) && finite(input.high60d) && input.high60d > 0 &&
    input.currentPrice <= input.high60d * (1 - OVERSOLD_DROP_FROM_HIGH_PCT);
  const rsiOk = finite(input.rsi14) && input.rsi14 < OVERSOLD_RSI_MAX;
  const oversold = dropOk && rsiOk;
  if (!dropOk) reasons.push(`oversold: 60일고점 대비 −${(OVERSOLD_DROP_FROM_HIGH_PCT * 100).toFixed(0)}% 미달`);
  if (!rsiOk) reasons.push(`oversold: RSI ${finite(input.rsi14) ? input.rsi14 : 'N/A'} ≥ ${OVERSOLD_RSI_MAX}`);

  // ③ RS 방어: 시장보다 덜 빠짐.
  const rsDefense = finite(input.relativeReturn20d) && input.relativeReturn20d > RS_DEFENSE_MIN;
  if (!rsDefense) reasons.push(`rsDefense: 20일 상대수익률 ${finite(input.relativeReturn20d) ? input.relativeReturn20d : 'N/A'} ≤ ${RS_DEFENSE_MIN}`);

  const qualifies = quality && oversold && rsDefense;
  const reducedKellyMultiplier = input.regime === 'PANIC' ? PANIC_KELLY_MULT : DEFENSE_KELLY_MULT;

  return {
    qualifies,
    criteria: { quality, oversold, rsDefense },
    reducedKellyMultiplier,
    regime: input.regime,
    reasons: qualifies ? [`방어 진입 적격(${input.regime}, Kelly ×${reducedKellyMultiplier})`] : reasons,
  };
}
