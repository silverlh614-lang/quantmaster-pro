// @responsibility quant extendedRegimeEngine 엔진 모듈
/**
 * extendedRegimeEngine.ts — 확장 레짐 분류 및 상승 초기 선취매 엔진
 *
 * 불확실성·위기·박스권 등 비정상 레짐 감지(classifyExtendedRegime),
 * 확장 레짐 7단계 재분류(deriveExtendedRegime),
 * 상승 초기 선취매 조건 평가(evaluateEarlyBullEntry)를 담당.
 */

import type {
  ConditionId,
  Gate0Result,
  MacroEnvironment,
  EconomicRegime,
  ExtendedRegimeData,
  FinancialStressIndex,
  EarlyBullEntryResult,
} from '../../types/quant';
import { MHS, VKOSPI, VIX } from '../../constants/thresholds';

// ─── 상승 초기 선취매 조건 평가 ─────────────────────────────────────────────────

/**
 * Bull Regime 상승 초기에 Gate 3 미달이어도 BUY 50% 허용하는 세 가지 조건 평가.
 *
 * ① ROE 유형 3 확인 (조건 id=3, Gate 1 전제조건 — 절대 우회 불가)
 * ② 외국인 Passive + Active 동반 순매수 3일 이상
 * ③ RS(상대강도) 섹터 내 상위 20% 이내 + KOSPI 대비 1개월 아웃퍼폼
 *
 * 세 조건 전부 충족 시 `triggered = true` → 호출자가 BUY 50% 포지션 부여.
 * 이후 Gate 3 조건 충족되면 나머지 50% 추가 진입.
 */
export function evaluateEarlyBullEntry(
  stockData: Record<ConditionId, number>,
  foreignPassiveActiveDays: number,    // 외국인 Passive+Active 동반 순매수 일수
  rsPercentileInSector: number,        // 섹터 내 RS 백분위 (0=최상위, 100=최하위)
  outperformsKospi1M: boolean,         // 최근 1개월 KOSPI 대비 아웃퍼폼 여부
): EarlyBullEntryResult {
  // ① ROE 유형 3 (조건 id=3) — Gate 1 기본값(≥5)과 동일 기준 적용
  const roeType3Confirmed = (stockData[3] ?? 0) >= 5;

  // ② 외국인 Passive+Active 동반 3일 이상
  const foreignCobuySatisfied = foreignPassiveActiveDays >= 3;

  // ③ RS 섹터 내 상위 20% + KOSPI 1개월 아웃퍼폼
  const rsConditionSatisfied = rsPercentileInSector <= 20 && outperformsKospi1M;

  const triggered = roeType3Confirmed && foreignCobuySatisfied && rsConditionSatisfied;

  const reasons: string[] = [];
  if (roeType3Confirmed)     reasons.push('ROE 유형 3 확인 (Gate 1 전제조건 유지)');
  if (foreignCobuySatisfied) reasons.push(`외국인 Passive+Active 동반매수 ${foreignPassiveActiveDays}일 연속`);
  if (rsConditionSatisfied)  reasons.push(`RS 섹터 내 상위 ${rsPercentileInSector}% + KOSPI 1개월 아웃퍼폼`);

  return { triggered, roeType3Confirmed, foreignCobuySatisfied, rsConditionSatisfied, reasons };
}

// ─── 불확실성 레짐 감지 및 적응형 Gate 시스템 ─────────────────────────────────

/**
 * Gate 0 결과 + 거시 데이터로부터 확장 레짐(UNCERTAIN/CRISIS/RANGE_BOUND)을 감지.
 * 기존 4단계(RECOVERY/EXPANSION/SLOWDOWN/RECESSION)에 3개 비정상 레짐을 추가하여
 * 시스템이 "판단 불능" 상태를 인식하고 방어 모드로 전환할 수 있게 합니다.
 *
 * Bull Regime 추가: KOSPI 20일선 위 + VKOSPI < 20 + MHS ≥ 70
 * → Gate 2: 9→7, Gate 3: 7→5 완화 (Gate 1은 절대 완화 금지)
 */
export function classifyExtendedRegime(
  gate0: Gate0Result | undefined,
  macroEnv: MacroEnvironment | undefined,
  baseRegime: EconomicRegime | undefined,
  options?: {
    kospi60dVolatility?: number;      // KOSPI 60일 변동성 (%)
    leadingSectorCount?: number;      // 명확한 주도 섹터 수
    foreignFlowDirection?: 'CONSISTENT_BUY' | 'CONSISTENT_SELL' | 'ALTERNATING';
    kospiSp500Correlation?: number;   // KOSPI-S&P500 상관계수
    financialStress?: FinancialStressIndex;  // 레이어 K: 금융시스템 스트레스
    kospiAboveMa20?: boolean;         // KOSPI 20일 이동평균선 위 여부 (Bull Regime 판단용)
  }
): ExtendedRegimeData['systemAction'] {
  if (!gate0 || !macroEnv) {
    return {
      mode: 'NORMAL',
      cashRatio: 30,
      gateAdjustment: { gate1Threshold: 5, gate2Required: 9, gate3Required: 7 },
      message: '거시 데이터 미수집. 기본 모드 유지.',
    };
  }

  const { macroHealthScore, mhsLevel } = gate0;
  const { vkospi, vix, exportGrowth3mAvg } = macroEnv;
  const kospi60dVol = options?.kospi60dVolatility ?? 0;
  const leadingSectors = options?.leadingSectorCount ?? 3;
  const foreignFlow = options?.foreignFlowDirection ?? 'ALTERNATING';
  const correlation = options?.kospiSp500Correlation ?? 0.7;
  const fsi = options?.financialStress;

  // ── FSI CRISIS → Gate 0 buyingHalted 강제 발동, Kelly 0% ──
  if (fsi && fsi.systemAction === 'CRISIS') {
    return {
      mode: 'FULL_STOP',
      cashRatio: 100,
      gateAdjustment: { gate1Threshold: 10, gate2Required: 12, gate3Required: 10 },
      message: `금융시스템 스트레스 위기 (FSI ${fsi.compositeScore}, TED ${fsi.tedSpread.bps}bp, HY ${fsi.usHySpread.bps}bp, MOVE ${fsi.moveIndex.current}). 전량 현금 전환.`,
    };
  }

  // ── FSI DEFENSIVE → 방어 모드 강화 ──
  if (fsi && fsi.systemAction === 'DEFENSIVE') {
    return {
      mode: 'CASH_HEAVY',
      cashRatio: 80,
      gateAdjustment: { gate1Threshold: 7, gate2Required: 11, gate3Required: 9 },
      message: `금융시스템 스트레스 경고 (FSI ${fsi.compositeScore}). Gate 기준 대폭 강화.`,
    };
  }

  // ── CRISIS 감지: 극단적 공포 + 신용 위기 ──
  if (vkospi > VKOSPI.EXTREME && vix > VIX.FEAR && macroHealthScore < MHS.DEFENSE) {
    return {
      mode: 'FULL_STOP',
      cashRatio: 100,
      gateAdjustment: { gate1Threshold: 10, gate2Required: 12, gate3Required: 10 },
      message: `위기 레짐 감지 (VKOSPI ${vkospi}, VIX ${vix}, MHS ${macroHealthScore}). 전량 현금 전환. Gate 평가 사실상 중단.`,
    };
  }

  // ── RANGE_BOUND 감지: 낮은 변동성 + 주도주 부재 + 외국인 방향성 없음 ──
  if (kospi60dVol > 0 && kospi60dVol < 5 && leadingSectors === 0 && foreignFlow === 'ALTERNATING') {
    return {
      mode: 'PAIR_TRADE',
      cashRatio: 60,
      gateAdjustment: { gate1Threshold: 6, gate2Required: 10, gate3Required: 8 },
      message: `박스권 횡보 감지 (60일 변동성 ${kospi60dVol}%, 주도섹터 0개). 페어트레이딩/현금 비중 확대 모드. Gate 기준 강화.`,
    };
  }

  // ── UNCERTAIN 감지: 신호 혼조 (4축 모두 40~60 밴드 또는 상관관계 붕괴) ──
  const { interestRateScore, liquidityScore, economicScore, riskScore } = gate0.details;
  const allMidRange = [interestRateScore, liquidityScore, economicScore, riskScore]
    .every(s => s >= 8 && s <= 17); // 각 축 0-25 중 중간 밴드
  const correlationBreakdown = correlation < 0.3;

  if (allMidRange || (correlationBreakdown && mhsLevel === 'MEDIUM')) {
    return {
      mode: 'DEFENSIVE',
      cashRatio: 70,
      gateAdjustment: { gate1Threshold: 6, gate2Required: 10, gate3Required: 8 },
      message: `불확실성 레짐 감지 (${allMidRange ? '4축 신호 혼조' : '글로벌 상관관계 이탈'}). 현금 70%, Gate 기준 상향.`,
    };
  }

  // ── 회복 초기 감지: 바닥 반등 신호 → Gate 완화 ──
  if (baseRegime === 'RECOVERY' && macroEnv.bokRateDirection === 'CUTTING' && exportGrowth3mAvg > 0) {
    return {
      mode: 'NORMAL',
      cashRatio: 20,
      gateAdjustment: { gate1Threshold: 4, gate2Required: 8, gate3Required: 6 },
      message: `회복 초기 감지 (금리 인하 + 수출 반등). Gate 기준 완화하여 초기 주도주 포착 강화.`,
    };
  }

  // ── Bull Regime: KOSPI 20일선 위 + VKOSPI < 20 + MHS ≥ 70 → 공격 참여 기준 완화 ──
  // Gate 1 (생존 5개) 는 절대 완화 금지. Gate 2/3만 완화하여 상승 초기 참여 강화.
  if (options?.kospiAboveMa20 && vkospi < VKOSPI.CALM && macroHealthScore >= MHS.BULL) {
    return {
      mode: 'NORMAL',
      cashRatio: 15,
      gateAdjustment: { gate1Threshold: 5, gate2Required: 7, gate3Required: 5 },
      message: `Bull Regime 선언 (KOSPI 20일선 위, VKOSPI ${vkospi.toFixed(1)}, MHS ${macroHealthScore}). Gate 2: 9→7, Gate 3: 7→5 완화. Gate 1은 유지.`,
    };
  }

  // ── 정상 시장: 4단계 TradeRegime 기반 ──
  if (mhsLevel === 'HIGH') {
    // BULL_AGGRESSIVE는 Bull Regime 블록에서 이미 처리됨 (gate2:7, gate3:5)
    // 여기는 BULL_NORMAL 진입 직전 (MHS≥70 + VKOSPI≥20): 기본 기준 적용
    return {
      mode: 'NORMAL',
      cashRatio: 20,
      gateAdjustment: { gate1Threshold: 5, gate2Required: 9, gate3Required: 7 },
      message: '정상 Bull 시장. 기본 Gate 기준 적용.',
    };
  }

  if (mhsLevel === 'MEDIUM') {
    // BULL_NORMAL (MHS 50~69): 기존 DEFENSIVE(gate2:10)에서 완화
    return {
      mode: 'NORMAL',
      cashRatio: 30,
      gateAdjustment: { gate1Threshold: 5, gate2Required: 8, gate3Required: 6 },
      message: `BULL_NORMAL (MHS ${macroHealthScore}). Gate 2: 8, Gate 3: 6. Kelly 70% 상한.`,
    };
  }

  // mhsLevel === 'LOW' → NEUTRAL (MHS 30~49)
  // MHS < 30은 buyingHalted로 이미 차단됨 — 여기는 30~49 구간
  return {
    mode: 'DEFENSIVE',
    cashRatio: 50,
    gateAdjustment: { gate1Threshold: 5, gate2Required: 9, gate3Required: 7 },
    message: `NEUTRAL (MHS ${macroHealthScore}). 기본 Gate 기준, STRONG_BUY만 허용. Kelly 50% 상한.`,
  };
}

/**
 * 확장 레짐 기반으로 기존 EconomicRegime 4단계를 7단계로 재분류.
 * AI가 반환한 baseRegime + Gate0 수치를 결합하여 최종 판정.
 */
export function deriveExtendedRegime(
  baseRegime: EconomicRegime | undefined,
  gate0: Gate0Result | undefined,
  macroEnv: MacroEnvironment | undefined,
  options?: {
    kospi60dVolatility?: number;
    leadingSectorCount?: number;
    foreignFlowDirection?: 'CONSISTENT_BUY' | 'CONSISTENT_SELL' | 'ALTERNATING';
    kospiSp500Correlation?: number;
    kospiAboveMa20?: boolean;
  }
): EconomicRegime {
  if (!gate0 || !macroEnv) return baseRegime ?? 'EXPANSION';

  const { macroHealthScore } = gate0;
  const { vkospi, vix } = macroEnv;
  const kospi60dVol = options?.kospi60dVolatility ?? 0;
  const leadingSectors = options?.leadingSectorCount ?? 3;
  const foreignFlow = options?.foreignFlowDirection ?? 'ALTERNATING';
  const correlation = options?.kospiSp500Correlation ?? 0.7;

  // CRISIS
  if (vkospi > VKOSPI.EXTREME && vix > VIX.FEAR && macroHealthScore < MHS.DEFENSE) return 'CRISIS';

  // RANGE_BOUND
  if (kospi60dVol > 0 && kospi60dVol < 5 && leadingSectors === 0 && foreignFlow === 'ALTERNATING') return 'RANGE_BOUND';

  // UNCERTAIN
  const { interestRateScore, liquidityScore, economicScore, riskScore } = gate0.details;
  const allMidRange = [interestRateScore, liquidityScore, economicScore, riskScore].every(s => s >= 8 && s <= 17);
  if (allMidRange || (correlation < 0.3 && gate0.mhsLevel === 'MEDIUM')) return 'UNCERTAIN';

  return baseRegime ?? 'EXPANSION';
}
