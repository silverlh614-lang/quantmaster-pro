/**
 * marketRegimeClassifier.ts — 시장 레짐 자동 분류기
 *
 * 4개 핵심 변수(VKOSPI, 외국인 순매수 4주 추이, 코스피 200일선 위치, 달러 인덱스 방향)를
 * 조합하여 현재 시장 레짐을 4단계로 자동 분류하고, 모든 Gate 임계값을 재조정한다.
 *
 * 레짐 분류:
 *   RISK_ON_BULL       — Gate 2 완화(9→8), 공격적 포지션 허용
 *   RISK_ON_EARLY      — 표준 기준 유지, 주도주 초기 신호 포착
 *   RISK_OFF_CORRECTION — Gate 1 강화, 포지션 사이즈 50% 제한
 *   RISK_OFF_CRISIS    — Gate 1 3개 이상 미충족 시 신규 매수 전면 중단, 현금 70%+
 *
 * 판정 우선순위:
 *   RISK_OFF_CRISIS → RISK_OFF_CORRECTION → RISK_ON_BULL → RISK_ON_EARLY
 */

import type {
  MarketRegimeClassifierInput,
  MarketRegimeClassifierResult,
  MarketRegimeClassification,
} from '../../types/macro';

// ─── 레짐별 Gate 설정 상수 ──────────────────────────────────────────────────────

const REGIME_GATE_CONFIG: Record<
  MarketRegimeClassification,
  {
    gate2RequiredOverride: number | null;
    gate1Strengthened: boolean;
    positionSizeLimitPct: number;
    buyingHalted: boolean;
    cashRatioMinPct: number;
    gate1BreachThreshold: number;
  }
> = {
  /** Risk-On 강세: Gate 2 통과 기준 9→8로 완화 */
  RISK_ON_BULL: {
    gate2RequiredOverride: 8,
    gate1Strengthened: false,
    positionSizeLimitPct: 100,
    buyingHalted: false,
    cashRatioMinPct: 0,
    gate1BreachThreshold: 3,
  },

  /** Risk-On 초기: 표준 기준 유지, 주도주 초기 신호 포착 */
  RISK_ON_EARLY: {
    gate2RequiredOverride: null,  // 기존 기준 유지 (9/12)
    gate1Strengthened: false,
    positionSizeLimitPct: 100,
    buyingHalted: false,
    cashRatioMinPct: 0,
    gate1BreachThreshold: 3,
  },

  /** Risk-Off 조정: Gate 1 강화, 포지션 사이즈 50% 제한 */
  RISK_OFF_CORRECTION: {
    gate2RequiredOverride: null,
    gate1Strengthened: true,
    positionSizeLimitPct: 50,
    buyingHalted: false,
    cashRatioMinPct: 30,
    gate1BreachThreshold: 2,
  },

  /** Risk-Off 위기: Gate 1 3개 이상 미충족 시 신규 매수 전면 중단, 현금 70%+ */
  RISK_OFF_CRISIS: {
    gate2RequiredOverride: null,
    gate1Strengthened: true,
    positionSizeLimitPct: 0,
    buyingHalted: true,
    cashRatioMinPct: 70,
    gate1BreachThreshold: 1,  // 1개 이상 미충족도 경계
  },
};

// ─── 레짐 분류 핵심 로직 ────────────────────────────────────────────────────────

/**
 * 4개 변수 조합으로 시장 레짐을 분류.
 *
 * 판정 기준:
 *
 * RISK_OFF_CRISIS (3/4 이상 부정적 신호):
 *   - VKOSPI ≥ 30 (극공포) OR
 *   - 외국인 4주 순매도(-) + KOSPI 200일선 하방 + 달러 강세 (3개 모두)
 *
 * RISK_OFF_CORRECTION (2/4 부정적 신호):
 *   - VKOSPI ≥ 22 OR (외국인 4주 순매도 + 달러 강세)
 *
 * RISK_ON_BULL (4/4 긍정적 신호 또는 강한 3개):
 *   - VKOSPI < 18 + 외국인 4주 순매수+ + KOSPI 200일선 위 + 달러 하락/중립
 *
 * RISK_ON_EARLY (기본 긍정적 환경):
 *   - 나머지 (RISK_OFF 임계값 미달, 아직 RISK_ON_BULL 조건 미달)
 */
function classifyRegimeFromVariables(
  input: MarketRegimeClassifierInput,
): MarketRegimeClassification {
  const { vkospi, foreignNetBuy4wTrend, kospiAbove200MA, dxyDirection } = input;

  // 각 변수를 불리언 위험 신호로 변환
  const vkospiDanger   = vkospi >= 30;        // 극공포 구간
  const vkospiElevated = vkospi >= 22;        // 불안 구간
  const foreignSelling = foreignNetBuy4wTrend < 0;   // 4주 순매도
  const foreignBuying  = foreignNetBuy4wTrend > 2000; // 강한 4주 순매수 (2000억+)
  const belowKospi200  = !kospiAbove200MA;
  const dollarStrong   = dxyDirection === 'UP';
  const dollarWeak     = dxyDirection === 'DOWN';

  // ── RISK_OFF_CRISIS: 최우선 위기 감지 ─────────────────────────────────────────
  if (
    vkospiDanger ||
    (foreignSelling && belowKospi200 && dollarStrong)
  ) {
    return 'RISK_OFF_CRISIS';
  }

  // ── RISK_OFF_CORRECTION: 조정 구간 ───────────────────────────────────────────
  if (
    vkospiElevated ||
    (foreignSelling && dollarStrong) ||
    (foreignSelling && belowKospi200)
  ) {
    return 'RISK_OFF_CORRECTION';
  }

  // ── RISK_ON_BULL: 이상적인 강세 환경 ─────────────────────────────────────────
  const bullSignals = [
    vkospi < 18,
    foreignBuying,
    kospiAbove200MA,
    dollarWeak || dxyDirection === 'FLAT',
  ];
  if (bullSignals.filter(Boolean).length >= 3) {
    return 'RISK_ON_BULL';
  }

  // ── 기본: RISK_ON_EARLY ───────────────────────────────────────────────────────
  return 'RISK_ON_EARLY';
}

// ─── 설명/행동 메시지 생성 ───────────────────────────────────────────────────────

function buildMessages(
  classification: MarketRegimeClassification,
  input: MarketRegimeClassifierInput,
): { description: string; actionMessage: string } {
  const { vkospi, foreignNetBuy4wTrend, kospiAbove200MA, dxyDirection } = input;

  const kospi200Label = kospiAbove200MA ? '200일선 위' : '200일선 아래';
  const dxyLabel = dxyDirection === 'UP' ? '달러 강세↑' : dxyDirection === 'DOWN' ? '달러 약세↓' : '달러 보합';
  const foreignLabel = foreignNetBuy4wTrend >= 0
    ? `외국인 4주 순매수 +${Math.round(foreignNetBuy4wTrend).toLocaleString()}억`
    : `외국인 4주 순매도 ${Math.round(foreignNetBuy4wTrend).toLocaleString()}억`;

  const context = `VKOSPI ${vkospi.toFixed(1)} · ${foreignLabel} · KOSPI ${kospi200Label} · ${dxyLabel}`;

  switch (classification) {
    case 'RISK_ON_BULL':
      return {
        description: `🟢 RISK-ON 강세 — ${context}`,
        actionMessage: '✅ Gate 2 통과 기준 8/12로 완화 적용. 공격적 포지션 허용. 주도주 풀 사이즈 진입 검토.',
      };
    case 'RISK_ON_EARLY':
      return {
        description: `🟡 RISK-ON 초기 — ${context}`,
        actionMessage: '⚡ 표준 기준 유지. 주도주 초기 신호 포착에 집중. Gate 1+2+3 모두 정상 적용.',
      };
    case 'RISK_OFF_CORRECTION':
      return {
        description: `🟠 RISK-OFF 조정 — ${context}`,
        actionMessage: '⚠️ Gate 1 강화 적용. 포지션 사이즈 50% 제한. 현금 30% 이상 유지. 신규 진입 시 조건 엄격화.',
      };
    case 'RISK_OFF_CRISIS':
      return {
        description: `🔴 RISK-OFF 위기 — ${context}`,
        actionMessage: '🛑 신규 매수 전면 중단. 현금 비중 70% 이상 자동 유지. 기존 포지션 점검 및 청산 준비.',
      };
  }
}

// ─── 메인 평가 함수 ──────────────────────────────────────────────────────────────

/**
 * 4개 핵심 변수를 기반으로 시장 레짐을 자동 분류하고, Gate 임계값 조정 지침을 반환한다.
 *
 * @param input - VKOSPI, 외국인 순매수 4주 추이, KOSPI 200일선 위치, 달러 방향
 * @returns 레짐 분류 + Gate 조정 설정 + 운용 지침
 */
export function evaluateMarketRegimeClassifier(
  input: MarketRegimeClassifierInput,
): MarketRegimeClassifierResult {
  const classification = classifyRegimeFromVariables(input);
  const config = REGIME_GATE_CONFIG[classification];
  const { description, actionMessage } = buildMessages(classification, input);

  return {
    classification,
    gate2RequiredOverride:   config.gate2RequiredOverride,
    gate1Strengthened:       config.gate1Strengthened,
    positionSizeLimitPct:    config.positionSizeLimitPct,
    buyingHalted:            config.buyingHalted,
    cashRatioMinPct:         config.cashRatioMinPct,
    gate1BreachThreshold:    config.gate1BreachThreshold,
    inputs:                  input,
    description,
    actionMessage,
    lastUpdated: new Date().toISOString(),
  };
}
