/**
 * bearRegimeEngine.ts — Bear 레짐 감지 엔진
 *
 * 아이디어 1: Gate -1 "Market Regime Detector" — Bull/Bear 자동 판별 게이트
 * 아이디어 2: 인버스 ETF 스코어링 시스템 — Inverse Gate 1
 */

import type {
  MacroEnvironment,
  Gate0Result,
  BearSeasonalityResult,
  BearRegimeResult,
  BearRegimeCondition,
  InverseGate1Result,
  InverseGate1Condition,
  InverseGate1SignalType,
} from '../../types/quant';

/**
 * 7개 매크로 조건을 평가하여 시장 레짐을 BULL / TRANSITION / BEAR 3단계로 분류한다.
 * 5개 이상 조건 충족 시 Bear Mode 자동 활성화.
 * MacroEnvironment에 이미 포함된 vkospi, samsungIri, bokRateDirection, usdKrw,
 * mhsLevel 등을 직접 활용하며, 나머지 보조 지표(kospiBelow120ma, foreignFuturesSellDays 등)는
 * MacroEnvironment의 optional 확장 필드에서 읽는다.
 */
export function evaluateBearRegime(
  macroEnv: MacroEnvironment,
  gate0: Gate0Result,
  seasonalityResult?: BearSeasonalityResult,
): BearRegimeResult {
  const now = new Date().toISOString();

  // ── 조건 1: KOSPI 120일 이평선 하회 + 일목 구름 하방 ──
  const cond1: BearRegimeCondition = {
    id: 'KOSPI_BELOW_120MA',
    name: 'KOSPI 120일선 하락 + 일목 구름 하방',
    triggered: !!(macroEnv.kospiBelow120ma && macroEnv.kospiIchimokuBearish),
    description: 'KOSPI가 120일 이동평균선 아래에 위치하고 일목균형표 구름 하방에 있습니다.',
  };

  // ── 조건 2: VKOSPI 25% 이상 + 상승 중 ──
  const cond2: BearRegimeCondition = {
    id: 'VKOSPI_HIGH_RISING',
    name: 'VKOSPI 25% 이상 + 상승 추세',
    triggered: macroEnv.vkospi >= 25 && macroEnv.vkospiRising === true,
    description: `VKOSPI ${macroEnv.vkospi.toFixed(1)} — 시장 변동성 경보 구간 진입.`,
  };

  // ── 조건 3: 삼성 IRI +3.0pt 이상 급등 ──
  const iriDelta = macroEnv.samsungIriDelta ?? 0;
  const cond3: BearRegimeCondition = {
    id: 'SAMSUNG_IRI_SURGE',
    name: '삼성 IRI +3.0pt 이상 급등',
    triggered: iriDelta >= 3.0,
    description: `삼성 IRI 변화 +${iriDelta.toFixed(1)}pt — 기관 위험회피 심화.`,
  };

  // ── 조건 4: 외국인 선물 누적 순매도 10일 이상 ──
  const sellDays = macroEnv.foreignFuturesSellDays ?? 0;
  const cond4: BearRegimeCondition = {
    id: 'FOREIGN_FUTURES_SELL',
    name: '외국인 선물 연속 순매도 10일 이상',
    triggered: sellDays >= 10,
    description: `외국인 선물 연속 순매도 ${sellDays}일째.`,
  };

  // ── 조건 5: MHS GREEN→YELLOW→RED 전환 확인 ──
  const mhsLevel = gate0.mhsLevel;
  const mhsTrend = macroEnv.mhsTrend ?? 'STABLE';
  const cond5: BearRegimeCondition = {
    id: 'MHS_DETERIORATING',
    name: 'MHS GREEN→YELLOW→RED 전환',
    triggered: (mhsLevel === 'LOW') || (mhsLevel === 'MEDIUM' && mhsTrend === 'DETERIORATING'),
    description: `MHS ${gate0.macroHealthScore} (${mhsLevel}) — ${mhsTrend === 'DETERIORATING' ? '악화 추세' : '매수 중단 수준'}.`,
  };

  // ── 조건 6: BOK 금리 인상 사이클 진행 중 ──
  const cond6: BearRegimeCondition = {
    id: 'BOK_RATE_HIKING',
    name: 'BOK 금리 인상 사이클',
    triggered: macroEnv.bokRateDirection === 'HIKING',
    description: '한국은행 기준금리 인상 사이클 — 유동성 긴축 환경.',
  };

  // ── 조건 7: USD/KRW 1,350 이상 급등 국면 ──
  const cond7: BearRegimeCondition = {
    id: 'USDKRW_SURGE',
    name: 'USD/KRW 1,350 이상 급등',
    triggered: macroEnv.usdKrw >= 1350,
    description: `USD/KRW ${macroEnv.usdKrw.toLocaleString()} — 원화 급약세, 외국인 자금 유출 압력.`,
  };

  const allConditions = [cond1, cond2, cond3, cond4, cond5, cond6, cond7];
  const triggeredCount = allConditions.filter(c => c.triggered).length;
  const BASE_BEAR_THRESHOLD = 5;
  const BEAR_THRESHOLD = Math.max(3, BASE_BEAR_THRESHOLD + (seasonalityResult?.gateThresholdAdjustment ?? 0));

  let regime: BearRegimeResult['regime'];
  let actionRecommendation: string;
  let cashRatioRecommended: number;
  let defenseMode: boolean;

  if (triggeredCount >= BEAR_THRESHOLD) {
    regime = 'BEAR';
    actionRecommendation = '🔴 Bear Mode 활성화 — 인버스/방어자산 선택 모드. 신규 롱 포지션 전면 중단. KODEX 200선물인버스2X 및 방어섹터 재편 권고.';
    cashRatioRecommended = 70;
    defenseMode = true;
  } else if (triggeredCount >= 3) {
    regime = 'TRANSITION';
    actionRecommendation = '🟡 Transition Mode — 현금 비중 확대 및 헤지 레이어 활성화. 신규 진입 규모 축소(50%), 기존 포지션 점검.';
    cashRatioRecommended = 40;
    defenseMode = false;
  } else {
    regime = 'BULL';
    actionRecommendation = '🟢 Bull Mode — 27조건 롱 시스템 정상 작동. Gate 1→3 표준 기준 적용.';
    cashRatioRecommended = 20;
    defenseMode = false;
  }

  if (seasonalityResult?.isBearSeason && seasonalityResult.gateThresholdAdjustment < 0) {
    actionRecommendation += ` (계절성 약세 구간 반영: 임계치 ${BASE_BEAR_THRESHOLD}→${BEAR_THRESHOLD})`;
  }

  return {
    regime,
    conditions: allConditions,
    triggeredCount,
    threshold: BEAR_THRESHOLD,
    actionRecommendation,
    cashRatioRecommended,
    defenseMode,
    lastUpdated: now,
  };
}

// ─── 아이디어 2: 인버스 ETF 스코어링 시스템 — Inverse Gate 1 ────────────────

/**
 * 롱 시스템의 거울상(Mirror System) — 27개 조건의 역전(Inversion)으로 구성된
 * Inverse Gate 1의 5개 Bear 필수 조건을 평가한다.
 * 5개 모두 충족 시 → STRONG BEAR 시그널 발동 → KODEX 200선물인버스2X 또는
 * TIGER 인버스 ETF 즉시 진입 권고.
 */
export function evaluateInverseGate1(
  macroEnv: MacroEnvironment,
): InverseGate1Result {
  const now = new Date().toISOString();

  // ── 조건 1: KOSPI 일목 구름 하단 이탈 확인 ──
  const cond1: InverseGate1Condition = {
    id: 'KOSPI_ICHIMOKU_BREAK_DOWN',
    name: '① KOSPI 일목 구름 하단 이탈',
    triggered: macroEnv.kospiIchimokuBearish === true,
    description: 'KOSPI가 일목균형표 구름 하단을 이탈한 상태입니다. 롱 시스템의 "구름 위 안착" 조건의 역전 신호.',
  };

  // ── 조건 2: VKOSPI 20 이상 + 상승 가속 ──
  const cond2: InverseGate1Condition = {
    id: 'VKOSPI_20_ACCELERATING',
    name: '② VKOSPI 20 이상 + 상승 가속',
    triggered: macroEnv.vkospi >= 20 && macroEnv.vkospiRising === true,
    description: `VKOSPI ${macroEnv.vkospi.toFixed(1)} — 변동성 가속 구간 진입. 시장 공포 확산 중.`,
  };

  // ── 조건 3: 외국인 선물 순매도 가속 (3일 연속 증가) ──
  const sellDays = macroEnv.foreignFuturesSellDays ?? 0;
  const cond3: InverseGate1Condition = {
    id: 'FOREIGN_FUTURES_SELL_ACCEL',
    name: '③ 외국인 선물 순매도 가속 (3일 연속)',
    triggered: sellDays >= 3,
    description: `외국인 선물 연속 순매도 ${sellDays}일째 — 외국인 자금 이탈 가속.`,
  };

  // ── 조건 4: 기준금리 인상 or 동결(긴축 유지) 사이클 ──
  const cond4: InverseGate1Condition = {
    id: 'RATE_TIGHTENING_OR_HOLD',
    name: '④ 기준금리 인상 or 동결 (긴축 유지)',
    triggered: macroEnv.bokRateDirection === 'HIKING' || macroEnv.bokRateDirection === 'HOLDING',
    description: `한국은행 기준금리 ${macroEnv.bokRateDirection === 'HIKING' ? '인상' : '동결'} — 긴축 환경 유지. 유동성 수축 압력.`,
  };

  // ── 조건 5: 달러인덱스(DXY) 강세 전환 확인 ──
  const cond5: InverseGate1Condition = {
    id: 'DXY_BULLISH_TURN',
    name: '⑤ 달러인덱스(DXY) 강세 전환',
    triggered: macroEnv.dxyBullish === true,
    description: '달러인덱스 강세 전환 확인 — 신흥국(한국 포함) 자금 이탈 압력 증가.',
  };

  const allConditions = [cond1, cond2, cond3, cond4, cond5];
  const triggeredCount = allConditions.filter(c => c.triggered).length;
  const allTriggered = triggeredCount === 5;

  const INVERSE_ETFS = [
    'KODEX 200선물인버스2X (233740)',
    'TIGER 200선물인버스2X (252670)',
    'KODEX 코스닥150선물인버스 (251340)',
  ];

  let signalType: InverseGate1SignalType;
  let actionMessage: string;

  if (allTriggered) {
    signalType = 'STRONG_BEAR';
    actionMessage = '🔴 STRONG BEAR 시그널 발동 — Inverse Gate 1 5개 조건 전부 충족. KODEX 200선물인버스2X 또는 TIGER 인버스 즉시 진입 권고. 신규 롱 포지션 전면 중단.';
  } else if (triggeredCount >= 3) {
    signalType = 'PARTIAL';
    actionMessage = `🟠 인버스 ETF 대기 시그널 — ${triggeredCount}/5개 조건 충족. 잔여 조건 확인 후 5개 모두 충족 시 STRONG BEAR 발동. 현금 비중 확대 권고.`;
  } else {
    signalType = 'INACTIVE';
    actionMessage = `🟢 인버스 게이트 비활성 — ${triggeredCount}/5개 조건만 충족. 27조건 롱 시스템 정상 운용 가능.`;
  }

  return {
    signalType,
    conditions: allConditions,
    triggeredCount,
    allTriggered,
    etfRecommendations: allTriggered ? INVERSE_ETFS : [],
    actionMessage,
    lastUpdated: now,
  };
}
