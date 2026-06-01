/**
 * @responsibility ENV-gated read-model: snapshot/macroState 파생값만으로 시장 급등 lens 산출 — 새 provider 호출 0건, 주문 생성 금지.
 *
 * ADR-0549: buildMarketRallyLens(input) 는 자동매매와 완전히 분리된 추천/관측 전용 read-model.
 * ENV MARKET_RALLY_LENS_ENABLED OFF(미설정 포함) → DISABLED. providerIssue/입력 null/UNKNOWN →
 * enabled=false, reason=RALLY_UNKNOWN_PROVIDER_ISSUE (불변식#6 — bullish/bearish 변환 절대 금지).
 * 조건 1·4·6 만 PR-1 활성(OR, 최초 매칭). executionImpact='NONE'·recommendationOnly:true 리터럴 고정.
 */

import {
  buildDisabledRallyLens,
  type MarketRallyLens,
  type MarketRallyReason,
  type RallyInvestorFlow,
} from './recommendationTypes.js';

/**
 * buildMarketRallyLens 입력. 모두 이미 materialize 된 snapshot/macroState 파생값.
 * 새 외부 호출을 유발하지 않는다 (불변식 #3 강화 — 동일 snapshot 소비).
 */
export interface MarketRallyLensInput {
  /** KOSPI 당일 수익률 % (UnifiedMacroContext.kospiDayReturn carry). 부재 시 null. */
  kospiDayReturn: number | null;
  /** KOSPI 20일 수익률 % (UnifiedMacroContext.kospi20dReturn). 부재 시 null. */
  kospi20dReturn: number | null;
  /** KOSDAQ 당일 수익률 % — PR-1 미수집(조건5 degrade). 부재 시 null. */
  kosdaqDayReturn?: number | null;
  /** 외국인 5일 누적 순매수 (억원, MacroState.foreignNetBuy5d). 부재 시 null. */
  foreignNetBuy5d: number | null;
  /** 시장 프로그램/기관 순매수 근사 (억원, MacroState.programNetBuyAmount). 부재 시 null. */
  marketInstitutionNetBuyApprox: number | null;
  /**
   * provider 결손/장애 여부. true 면 enabled=false + RALLY_UNKNOWN_PROVIDER_ISSUE.
   * 불변식 #6 — provider 장애는 market signal 이 아니다 (bullish/bearish 변환 금지).
   */
  providerIssue?: boolean;
  /** scan 과 공유하는 snapshotId (불변식 #3). */
  snapshotId?: string;
  /** 평가 시각 (ISO). 미지정 시 호출 시점. */
  asOf?: string;
}

// ─── ENV 게이트 ──────────────────────────────────────────────────────────────

/** MARKET_RALLY_LENS_ENABLED === 'true' 일 때만 활성. 미설정/임의값 → OFF. */
export function isMarketRallyLensEnabled(): boolean {
  return process.env.MARKET_RALLY_LENS_ENABLED === 'true';
}

// ─── PR-1 활성 조건 임계 ──────────────────────────────────────────────────────

const KOSPI_RALLY_DAY_THRESHOLD = 1.5;   // 조건1: 당일 +1.5%↑
const KOSPI_20D_UPTREND_THRESHOLD = 0;   // 조건6: 20일 추세 상승 (> 0)
const FOREIGN_5D_STRONG_THRESHOLD = 0;   // 조건4: 외국인 5일 순매수 강세 (> 0 억원)

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 외국인/기관 흐름 라벨. 입력 null → UNKNOWN (불변식 #6 비변환). */
function deriveInvestorFlow(input: MarketRallyLensInput): RallyInvestorFlow {
  const foreign = isFiniteNumber(input.foreignNetBuy5d) ? input.foreignNetBuy5d : null;
  const institution = isFiniteNumber(input.marketInstitutionNetBuyApprox)
    ? input.marketInstitutionNetBuyApprox
    : null;

  let label: RallyInvestorFlow['label'];
  if (foreign === null && institution === null) {
    label = 'UNKNOWN';
  } else if ((foreign ?? 0) > 0 || (institution ?? 0) > 0) {
    label = 'BULLISH';
  } else {
    label = 'NEUTRAL';
  }

  return { foreignNetBuy5d: foreign, marketInstitutionNetBuyApprox: institution, label };
}

/**
 * PR-1 활성 조건 1·4·6 을 OR 로 평가하고 최초 매칭 reason 을 반환한다.
 * 어느 조건도 평가에 필요한 입력이 전혀 없으면 RALLY_INPUT_NOT_AVAILABLE.
 * 입력은 있으나 미충족이면 NO_RALLY.
 */
function evaluateRallyReason(input: MarketRallyLensInput): MarketRallyReason {
  const hasDay = isFiniteNumber(input.kospiDayReturn);
  const has20d = isFiniteNumber(input.kospi20dReturn);
  const hasForeign = isFiniteNumber(input.foreignNetBuy5d);

  // 조건 1·4·6 의 입력이 모두 부재 → 평가 불가 (조건 2/3/5/7 도 PR-1 입력 부재로 미평가).
  if (!hasDay && !has20d && !hasForeign) {
    return 'RALLY_INPUT_NOT_AVAILABLE';
  }

  // 조건1: KOSPI 당일 +1.5%↑
  if (hasDay && (input.kospiDayReturn as number) >= KOSPI_RALLY_DAY_THRESHOLD) {
    return 'KOSPI_RALLY_1_5';
  }

  // 조건4: 외국인 5일 순매수 강세
  if (hasForeign && (input.foreignNetBuy5d as number) > FOREIGN_5D_STRONG_THRESHOLD) {
    return 'FOREIGN_5D_ACCUMULATION';
  }

  // 조건6: KOSPI 20일 추세 상승 + 당일 반등 (당일 > 0)
  if (
    has20d &&
    hasDay &&
    (input.kospi20dReturn as number) > KOSPI_20D_UPTREND_THRESHOLD &&
    (input.kospiDayReturn as number) > 0
  ) {
    return 'KOSPI_20D_UPTREND_DAY_REBOUND';
  }

  return 'NO_RALLY';
}

/**
 * Market Rally Lens read-model 산출. 새 provider 호출 0건 — snapshot/macroState 파생 입력만 소비.
 *
 * - ENV OFF(미설정 포함) → DISABLED (FEATURE_DISABLED).
 * - providerIssue=true → enabled=false, RALLY_UNKNOWN_PROVIDER_ISSUE (불변식 #6, UNKNOWN 비변환).
 * - 조건 1·4·6 OR 평가(최초 매칭). 조건 2/3/5/7 은 입력 부재로 미평가(RALLY_INPUT_NOT_AVAILABLE degrade).
 * - 산출물은 항상 executionImpact='NONE' · recommendationOnly:true (자동매매 무영향).
 */
export function buildMarketRallyLens(input: MarketRallyLensInput): MarketRallyLens {
  const asOf = input.asOf ?? new Date().toISOString();

  if (!isMarketRallyLensEnabled()) {
    return { ...buildDisabledRallyLens(asOf), snapshotId: input.snapshotId };
  }

  // 불변식 #6: provider 장애는 market signal 이 아니다. bullish/bearish 변환 금지.
  if (input.providerIssue === true) {
    return {
      enabled: false,
      reason: 'RALLY_UNKNOWN_PROVIDER_ISSUE',
      kospiReturnPct: null,
      kosdaqReturnPct: null,
      marketBreadth: null,
      investorFlow: { foreignNetBuy5d: null, marketInstitutionNetBuyApprox: null, label: 'UNKNOWN' },
      executionImpact: 'NONE',
      recommendationOnly: true,
      snapshotId: input.snapshotId,
      asOf,
    };
  }

  const reason = evaluateRallyReason(input);
  const enabled =
    reason === 'KOSPI_RALLY_1_5' ||
    reason === 'FOREIGN_5D_ACCUMULATION' ||
    reason === 'KOSPI_20D_UPTREND_DAY_REBOUND';

  return {
    enabled,
    reason,
    kospiReturnPct: isFiniteNumber(input.kospiDayReturn) ? input.kospiDayReturn : null,
    kosdaqReturnPct: isFiniteNumber(input.kosdaqDayReturn) ? input.kosdaqDayReturn : null,
    marketBreadth: null, // 조건7 — PR-1 미수집.
    investorFlow: deriveInvestorFlow(input),
    executionImpact: 'NONE',
    recommendationOnly: true,
    snapshotId: input.snapshotId,
    asOf,
  };
}
