/**
 * @responsibility ADR-0436 Gate Eligibility Split — LIVE_ELIGIBLE vs SHADOW_OBSERVABLE 분리 SSOT.
 *
 * 사용자 핵심 원칙 (절대 변경 금지):
 *   - "실매수 후보가 0개인 것과, 학습/관측 후보가 0개인 것은 다르다"
 *   - DATA_UNAVAILABLE 은 failed 가 아니다 + DATA_UNAVAILABLE 은 PASS 도 아니다
 *   - DATA_UNAVAILABLE 상태에서는 STRONG_BUY 금지 + LIVE_ELIGIBLE_PASS=false
 *   - SHADOW_OBSERVABLE_PASS 는 절대 실매수로 이어지면 안 된다 (paper/live 자동 승격 금지)
 *   - LIVE_ELIGIBLE_PASS 만 실제 BUY/STRONG_BUY eligibility
 *
 * 본 모듈은 *분류 layer 만* — KIS 주문 함수 5종 import 0건 (정적 grep 가드).
 * 호출자는 결과를 진단·영속·R3 sanity skip wiring 에만 사용. 자동 paper/live
 * 승격은 절대 금지 (Action union 자체 부재).
 *
 * ADR-0157 정확 비교 의무: ENV `GATE_ELIGIBILITY_SPLIT_DISABLED === 'true'` 만
 * 비활성. `'1'` / `'TRUE'` / `'yes'` 모두 거부 (호출자 측 inline 검사 0건).
 */

/**
 * 12-value GateEligibilityReason union (사용자 명시 절대 변경 금지).
 *
 * - DATA_UNAVAILABLE 분기: SUPPLY / INVESTOR_FLOW / EARNINGS — ADR-0416/0421/0435 정합
 * - PROVIDER_DEGRADED 분기: SECTOR_DATA_STALE / SECTOR_DATA_DEGRADED / PRICE_DATA_DEGRADED
 *   ADR-0125/0396/0411/0414/0423 정합
 * - 하드 차단 분기: MACRO_BLOCK / RISK_BLOCK / TRUE_GATE_FAIL / INSUFFICIENT_SCORE / DATA_STARVED
 *   — shadowObservable 도 false (학습 표본 오염 차단)
 */
export type GateEligibilityReason =
  | 'SUPPLY_DATA_UNAVAILABLE'
  | 'INVESTOR_FLOW_PROVIDER_UNAVAILABLE'
  | 'EARNINGS_DATA_UNAVAILABLE'
  | 'SECTOR_DATA_STALE'
  | 'SECTOR_DATA_DEGRADED'
  | 'PRICE_DATA_DEGRADED'
  | 'MACRO_BLOCK'
  | 'RISK_BLOCK'
  | 'TRUE_GATE_FAIL'
  | 'INSUFFICIENT_SCORE'
  | 'DATA_STARVED'
  | 'UNKNOWN';

export type GateEligibilitySource = 'DATA_UNAVAILABLE' | 'PROVIDER_DEGRADED' | 'SOFT_DEGRADE';

export interface GateEligibility {
  liveEligible: boolean;
  shadowObservable: boolean;
  liveBlockReasons: GateEligibilityReason[];
  shadowObservationReasons: GateEligibilityReason[];
  dataUnavailableReasons: GateEligibilityReason[];
  degradedProviderReasons: GateEligibilityReason[];
  hasFatalDefect: boolean;
  notes?: string;
}

export interface GateEligibilityInput {
  // 가격/code 기본 valid 검증
  currentPrice?: number;
  stockCode?: string;
  // DATA_UNAVAILABLE 분기 (ADR-0416/0421/0435 정합)
  supplyDataUnavailable?: boolean;
  investorFlowProviderUnavailable?: boolean;
  earningsDataUnavailable?: boolean;
  // PROVIDER_DEGRADED 분기 (ADR-0125/0396/0411/0414/0423 정합)
  sectorEnergyDataQuality?:
    | 'OK'
    | 'PARTIAL'
    | 'STALE'
    | 'PARTIAL_VOLUME'
    | 'DEGRADED'
    | 'FAILED';
  priceDataDegraded?: boolean;
  // 하드 차단 분기 (shadowObservable 도 false)
  macroBlocked?: boolean;
  riskBlocked?: boolean;
  trueGateFail?: boolean;
  insufficientScore?: boolean;
  dataStarved?: boolean;
  // 치명 결함 (가격 0 / code invalid / hard risk block)
  hasFatalDefect?: boolean;
  // 신호 등급 (SHADOW_OBSERVABLE 후보성 평가 입력)
  signalGrade?: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'NEUTRAL';
  // 기술/촉매/모멘텀 후보성 (가격 valid + 후보 자격 보유 시 SHADOW_OBSERVABLE 가능)
  hasTechnicalSetup?: boolean;
  hasMomentumSignal?: boolean;
  hasCatalystSignal?: boolean;
}

/**
 * ADR-0157 정합: ENV 정확 비교 (`=== 'true'`). 호출자 측 inline ENV 검사 0건.
 */
export function isGateEligibilitySplitDisabled(): boolean {
  return process.env.GATE_ELIGIBILITY_SPLIT_DISABLED === 'true';
}

/**
 * 6-자리 KRX 종목 code 검증 SSOT — 정규식 분기 호출자 모두 본 헬퍼 위임.
 */
function isValidKrxStockCode(code: string | undefined): boolean {
  if (!code) return false;
  return /^[0-9]{6}$/.test(code);
}

/**
 * 가격 valid 검증 SSOT — NaN/Infinity/0/음수 모두 거부.
 */
function isValidPrice(price: number | undefined): boolean {
  return typeof price === 'number' && Number.isFinite(price) && price > 0;
}

/**
 * Legacy 동작 — ENV `GATE_ELIGIBILITY_SPLIT_DISABLED === 'true'` 시.
 * shadowObservable 항상 false, liveEligible 만 평가 (사용자 §"잘못된 해결 방법" 가드 보존).
 */
function legacyEligibility(input: GateEligibilityInput): GateEligibility {
  const validPrice = isValidPrice(input.currentPrice);
  const validCode = isValidKrxStockCode(input.stockCode);
  const fatal = input.hasFatalDefect === true || !validPrice || !validCode;

  const liveBlockReasons: GateEligibilityReason[] = [];
  if (input.supplyDataUnavailable) liveBlockReasons.push('SUPPLY_DATA_UNAVAILABLE');
  if (input.investorFlowProviderUnavailable) liveBlockReasons.push('INVESTOR_FLOW_PROVIDER_UNAVAILABLE');
  if (input.earningsDataUnavailable) liveBlockReasons.push('EARNINGS_DATA_UNAVAILABLE');
  if (
    input.sectorEnergyDataQuality === 'STALE' ||
    input.sectorEnergyDataQuality === 'PARTIAL_VOLUME'
  ) {
    liveBlockReasons.push('SECTOR_DATA_STALE');
  }
  if (
    input.sectorEnergyDataQuality === 'DEGRADED' ||
    input.sectorEnergyDataQuality === 'FAILED'
  ) {
    liveBlockReasons.push('SECTOR_DATA_DEGRADED');
  }
  if (input.priceDataDegraded) liveBlockReasons.push('PRICE_DATA_DEGRADED');
  if (input.macroBlocked) liveBlockReasons.push('MACRO_BLOCK');
  if (input.riskBlocked) liveBlockReasons.push('RISK_BLOCK');
  if (input.trueGateFail) liveBlockReasons.push('TRUE_GATE_FAIL');
  if (input.insufficientScore) liveBlockReasons.push('INSUFFICIENT_SCORE');
  if (input.dataStarved) liveBlockReasons.push('DATA_STARVED');

  const liveEligible = !fatal && liveBlockReasons.length === 0;

  return {
    liveEligible,
    shadowObservable: false, // legacy 동작 — shadowObservable 항상 false
    liveBlockReasons,
    shadowObservationReasons: [],
    dataUnavailableReasons: [],
    degradedProviderReasons: [],
    hasFatalDefect: fatal,
    notes: 'legacy (GATE_ELIGIBILITY_SPLIT_DISABLED=true)',
  };
}

/**
 * Gate Eligibility 분류 SSOT (ADR-0436).
 *
 * 결정 트리 (사용자 명시 절대 변경 금지):
 *   1. ENV gate → legacy 동작 (shadowObservable 항상 false)
 *   2. 가격/code valid 검증 → fatal 시 양쪽 모두 false
 *   3. 차단 사유 누적 (모든 분기 OR)
 *   4. liveEligible: 차단 사유 0 + 치명 결함 0
 *   5. shadowObservable: !liveEligible + !fatal + hasCandidacy +
 *                        shadowObservationReasons.length > 0 + !hardBlockOnly
 *
 * 사용자 핵심 원칙:
 *   - hardBlockOnly = MACRO_BLOCK / TRUE_GATE_FAIL / RISK_BLOCK / INSUFFICIENT_SCORE /
 *                     DATA_STARVED 만 있을 때 → shadowObservable=false (학습 표본 오염 차단)
 *   - DATA_UNAVAILABLE / PROVIDER_DEGRADED 사유가 ≥1 + 후보성 보유 → shadowObservable=true
 */
export function classifyGateEligibility(input: GateEligibilityInput): GateEligibility {
  // 1. ENV gate (legacy 동작 폴백)
  if (isGateEligibilitySplitDisabled()) {
    return legacyEligibility(input);
  }

  // 2. 가격/code 기본 valid 검증
  const validPrice = isValidPrice(input.currentPrice);
  const validCode = isValidKrxStockCode(input.stockCode);
  const fatal = input.hasFatalDefect === true || !validPrice || !validCode;

  // 3. 차단 사유 누적 (모든 분기 OR — 다중 사유 동시 가능)
  const liveBlockReasons: GateEligibilityReason[] = [];
  const dataUnavailableReasons: GateEligibilityReason[] = [];
  const degradedProviderReasons: GateEligibilityReason[] = [];

  if (input.supplyDataUnavailable) {
    liveBlockReasons.push('SUPPLY_DATA_UNAVAILABLE');
    dataUnavailableReasons.push('SUPPLY_DATA_UNAVAILABLE');
  }
  if (input.investorFlowProviderUnavailable) {
    liveBlockReasons.push('INVESTOR_FLOW_PROVIDER_UNAVAILABLE');
    dataUnavailableReasons.push('INVESTOR_FLOW_PROVIDER_UNAVAILABLE');
  }
  if (input.earningsDataUnavailable) {
    liveBlockReasons.push('EARNINGS_DATA_UNAVAILABLE');
    dataUnavailableReasons.push('EARNINGS_DATA_UNAVAILABLE');
  }
  if (
    input.sectorEnergyDataQuality === 'STALE' ||
    input.sectorEnergyDataQuality === 'PARTIAL_VOLUME'
  ) {
    liveBlockReasons.push('SECTOR_DATA_STALE');
    degradedProviderReasons.push('SECTOR_DATA_STALE');
  }
  if (
    input.sectorEnergyDataQuality === 'DEGRADED' ||
    input.sectorEnergyDataQuality === 'FAILED'
  ) {
    liveBlockReasons.push('SECTOR_DATA_DEGRADED');
    degradedProviderReasons.push('SECTOR_DATA_DEGRADED');
  }
  if (input.priceDataDegraded) {
    liveBlockReasons.push('PRICE_DATA_DEGRADED');
    degradedProviderReasons.push('PRICE_DATA_DEGRADED');
  }
  if (input.macroBlocked) liveBlockReasons.push('MACRO_BLOCK');
  if (input.riskBlocked) liveBlockReasons.push('RISK_BLOCK');
  if (input.trueGateFail) liveBlockReasons.push('TRUE_GATE_FAIL');
  if (input.insufficientScore) liveBlockReasons.push('INSUFFICIENT_SCORE');
  if (input.dataStarved) liveBlockReasons.push('DATA_STARVED');

  // 4. liveEligible: 차단 사유 0 + 치명 결함 0
  const liveEligible = !fatal && liveBlockReasons.length === 0;

  // 5. shadowObservable 결정 — 사용자 명시 조건부 true
  const shadowObservationReasons: GateEligibilityReason[] = [
    ...dataUnavailableReasons,
    ...degradedProviderReasons,
  ];
  const hasCandidacy = !!(
    input.hasTechnicalSetup ||
    input.hasMomentumSignal ||
    input.hasCatalystSignal ||
    input.signalGrade === 'BUY' ||
    input.signalGrade === 'STRONG_BUY'
  );
  // hardBlockOnly: MACRO_BLOCK / TRUE_GATE_FAIL / RISK_BLOCK / INSUFFICIENT_SCORE /
  //   DATA_STARVED 만 있을 때 → shadowObservable=false
  //   (사용자 명시 — 학습 표본 오염 차단, 진짜 약체/매크로 차단은 관측 가치 없음)
  // 빈 배열일 때도 every 가 true 반환되므로 length>0 가드 필요 (그 경우 liveEligible 분기에서 처리됨).
  const hardBlockOnly =
    liveBlockReasons.length > 0 &&
    liveBlockReasons.every(
      (r) =>
        r === 'MACRO_BLOCK' ||
        r === 'TRUE_GATE_FAIL' ||
        r === 'RISK_BLOCK' ||
        r === 'INSUFFICIENT_SCORE' ||
        r === 'DATA_STARVED',
    );

  const shadowObservable =
    !liveEligible &&
    !fatal &&
    hasCandidacy &&
    shadowObservationReasons.length > 0 &&
    !hardBlockOnly;

  return {
    liveEligible,
    shadowObservable,
    liveBlockReasons,
    shadowObservationReasons,
    dataUnavailableReasons,
    degradedProviderReasons,
    hasFatalDefect: fatal,
  };
}

/**
 * 모든 GateEligibilityReason 값 list (정적 grep 가드 + 회귀 테스트 정합).
 */
export const ALL_GATE_ELIGIBILITY_REASONS: readonly GateEligibilityReason[] = [
  'SUPPLY_DATA_UNAVAILABLE',
  'INVESTOR_FLOW_PROVIDER_UNAVAILABLE',
  'EARNINGS_DATA_UNAVAILABLE',
  'SECTOR_DATA_STALE',
  'SECTOR_DATA_DEGRADED',
  'PRICE_DATA_DEGRADED',
  'MACRO_BLOCK',
  'RISK_BLOCK',
  'TRUE_GATE_FAIL',
  'INSUFFICIENT_SCORE',
  'DATA_STARVED',
  'UNKNOWN',
] as const;
