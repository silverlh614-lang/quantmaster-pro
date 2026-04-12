/**
 * macroEngine.ts — 거시 환경 평가 엔진
 *
 * Gate 0 (MHS), 자동매매 레짐 설정(getRegimeConfig),
 * MAPC(매크로 임계값 연동 포지션 자동 조절기)를 담당.
 */

import type {
  MacroEnvironment,
  Gate0Result,
  RateCycle,
  FXRegime,
  TradeRegime,
  RegimeConfig,
  MAPCResult,
  MAPCFactor,
  NikkeiLeadAlphaInput,
  NikkeiLeadAlphaResult,
  NikkeiKospiSectorCorrelation,
  NikkeiLeadGapResult,
} from '../../types/quant';
import { MHS, VKOSPI, VIX, FX, MACRO_AXIS_MAX, US10Y, KR_US_SPREAD } from '../../constants/thresholds';
import { clamp } from '../../utils/math';

// ─── 닛케이 5분봉 선행 지수화 (Nikkei → KOSPI) ─────────────────────────────────

export const NIKKEI_KOSPI_SECTOR_CORRELATION_TABLE: NikkeiKospiSectorCorrelation[] = [
  { nikkeiSector: 'DEFENSE', kospiSector: 'K-방산', correlation: 0.93, beta: 0.82 },
  { nikkeiSector: 'SEMICONDUCTOR', kospiSector: '반도체', correlation: 0.92, beta: 0.88 },
  { nikkeiSector: 'AUTOMOBILE', kospiSector: '자동차', correlation: 0.91, beta: 0.80 },
  { nikkeiSector: 'SHIPBUILDING', kospiSector: '조선', correlation: 0.90, beta: 0.76 },
  { nikkeiSector: 'ENERGY', kospiSector: '에너지', correlation: 0.90, beta: 0.74 },
  { nikkeiSector: 'BANK', kospiSector: '금융', correlation: 0.90, beta: 0.70 },
];

const NIKKEI_COLLECTION_TIME_KST = '08:30';
const KOSPI_PREOPEN_ALERT_TIME_KST = '09:00';

const NIKKEI_KOSPI_CORRELATION_MAP = NIKKEI_KOSPI_SECTOR_CORRELATION_TABLE.reduce<
Record<string, NikkeiKospiSectorCorrelation[]>
>((acc, row) => {
  if (!acc[row.nikkeiSector]) acc[row.nikkeiSector] = [];
  acc[row.nikkeiSector].push(row);
  return acc;
}, {});

function normalizeSectorKey(sector: string): string {
  return sector.trim().toUpperCase().replace(/\s+/g, '_');
}

/**
 * 닛케이 5분봉 기반 섹터 강도로 KOSPI 개장 이론 GAP 산출.
 * Gemini 수집(08:30) 결과를 입력받아 09:00 개장 전 알림 메시지에 사용한다.
 */
export function evaluateNikkeiLeadAlpha(input: NikkeiLeadAlphaInput): NikkeiLeadAlphaResult {
  const gapResults: NikkeiLeadGapResult[] = [];
  const unmatchedNikkeiSectors: string[] = [];

  for (const strength of input.nikkeiSectorStrengths) {
    const key = normalizeSectorKey(strength.sector);
    const matches = NIKKEI_KOSPI_CORRELATION_MAP[key] ?? [];

    if (matches.length === 0) {
      unmatchedNikkeiSectors.push(strength.sector);
      continue;
    }

    matches.forEach((row) => {
      const theoreticalGapPct = +(strength.changePct * row.beta).toFixed(2);
      gapResults.push({
        nikkeiSector: row.nikkeiSector,
        kospiSector: row.kospiSector,
        nikkeiChangePct: strength.changePct,
        theoreticalGapPct,
        correlation: row.correlation,
        beta: row.beta,
      });
    });
  }

  gapResults.sort((a, b) => Math.abs(b.theoreticalGapPct) - Math.abs(a.theoreticalGapPct));

  const topGap = gapResults[0];
  const maxAbsGap = topGap ? Math.abs(topGap.theoreticalGapPct) : 0;
  const avgCorrelation = gapResults.length > 0
    ? gapResults.reduce((sum, g) => sum + g.correlation, 0) / gapResults.length
    : 0;
  const predictiveConfidencePct = Math.round(avgCorrelation * 100);

  const alertLevel: NikkeiLeadAlphaResult['alertLevel'] =
    maxAbsGap >= 2.0 ? 'HIGH' : maxAbsGap >= 1.0 ? 'MEDIUM' : 'LOW';

  const summary = topGap
    ? `닛케이 선행 ${topGap.nikkeiSector} ${topGap.nikkeiChangePct >= 0 ? '+' : ''}${topGap.nikkeiChangePct.toFixed(2)}% → KOSPI ${topGap.kospiSector} 이론 GAP ${topGap.theoreticalGapPct >= 0 ? '+' : ''}${topGap.theoreticalGapPct.toFixed(2)}% (신뢰도 ${predictiveConfidencePct}%)`
    : '닛케이 섹터 데이터 매칭 없음 — 이론 GAP 산출 불가';

  return {
    collectionTimeKst: NIKKEI_COLLECTION_TIME_KST,
    alertTimeKst: KOSPI_PREOPEN_ALERT_TIME_KST,
    collectedAt: input.collectedAt ?? new Date().toISOString(),
    predictiveConfidencePct,
    alertLevel,
    summary,
    gapResults,
    unmatchedNikkeiSectors,
  };
}

// ─── Gate 0: 거시 환경 생존 게이트 ──────────────────────────────────────────

/** MHS 세부 점수 계산 (4개 축, 각 0-25) */
function computeMacroScoreDetails(env: MacroEnvironment) {
  // 금리 축 (0-MACRO_AXIS_MAX): 금리 인하 유리, 인상 불리
  let interestRateScore = 20;
  if (env.bokRateDirection === 'HIKING') interestRateScore -= 10;
  else if (env.bokRateDirection === 'CUTTING') interestRateScore += 5;
  if (env.us10yYield > US10Y.HIGH) interestRateScore -= 5;
  if (env.krUsSpread < KR_US_SPREAD.INVERSION) interestRateScore -= 5;
  interestRateScore = clamp(interestRateScore, 0, MACRO_AXIS_MAX);

  // 유동성 축 (0-MACRO_AXIS_MAX): M2 > 명목GDP → Risk-On
  let liquidityScore = 15;
  if (env.m2GrowthYoY > env.nominalGdpGrowth) liquidityScore += 10;
  else liquidityScore -= 5;
  if (env.bankLendingGrowth > 5) liquidityScore += 3;
  else if (env.bankLendingGrowth < 0) liquidityScore -= 5;
  liquidityScore = clamp(liquidityScore, 0, MACRO_AXIS_MAX);

  // 경기 축 (0-MACRO_AXIS_MAX): 수출 + OECD CLI
  let economicScore = 15;
  if (env.oeciCliKorea > 101) economicScore += 5;
  else if (env.oeciCliKorea < 99) economicScore -= 5;
  if (env.exportGrowth3mAvg > 5) economicScore += 5;
  else if (env.exportGrowth3mAvg < -5) economicScore -= 10;
  economicScore = clamp(economicScore, 0, MACRO_AXIS_MAX);

  // 리스크 축 (0-MACRO_AXIS_MAX): VKOSPI + VIX + 삼성IRI
  let riskScore = MACRO_AXIS_MAX;
  if (env.vkospi > VKOSPI.ELEVATED) riskScore -= 12;
  else if (env.vkospi > VKOSPI.CALM) riskScore -= 6;
  if (env.vix > VIX.FEAR) riskScore -= 10;
  else if (env.vix > VIX.ELEVATED) riskScore -= 5;
  if (env.samsungIri < 0.7) riskScore -= 5;
  riskScore = clamp(riskScore, 0, MACRO_AXIS_MAX);

  return { interestRateScore, liquidityScore, economicScore, riskScore };
}

/** Gate 0 전체 평가 */
export function evaluateGate0(env: MacroEnvironment): Gate0Result {
  const details = computeMacroScoreDetails(env);
  const macroHealthScore = details.interestRateScore + details.liquidityScore
    + details.economicScore + details.riskScore;

  const mhsLevel: Gate0Result['mhsLevel'] =
    macroHealthScore >= MHS.BULL ? 'HIGH' : macroHealthScore >= MHS.NEUTRAL ? 'MEDIUM' : 'LOW';

  // DEFENSE: MHS < 30 (기존 40 → 30으로 완화 — MHS 30~50은 NEUTRAL로 제한적 매수 허용)
  const buyingHalted = macroHealthScore < MHS.DEFENSE;
  // MAPC: 조정 켈리 = 기본 켈리 × (MHS / 100); MHS < 30 은 buyingHalted 로 차단
  const kellyReduction = macroHealthScore < MHS.DEFENSE ? 1.0 : 1 - (macroHealthScore / 100);

  // 4단계 자동매매 레짐 결정
  const tradeRegime: TradeRegime =
    buyingHalted                                              ? 'DEFENSE' :
    macroHealthScore >= MHS.BULL && env.vkospi < VKOSPI.CALM ? 'BULL_AGGRESSIVE' :
    macroHealthScore >= MHS.NEUTRAL                           ? 'BULL_NORMAL' :
                                                                'NEUTRAL';

  const rateCycle: RateCycle =
    env.bokRateDirection === 'HIKING' ? 'TIGHTENING' :
    env.bokRateDirection === 'CUTTING' ? 'EASING' : 'PAUSE';

  const fxRegime: FXRegime =
    env.usdKrw >= FX.DOLLAR_STRONG ? 'DOLLAR_STRONG' :
    env.usdKrw <= FX.DOLLAR_WEAK ? 'DOLLAR_WEAK' : 'NEUTRAL';

  return {
    passed: !buyingHalted,
    macroHealthScore,
    mhsLevel,
    tradeRegime,
    kellyReduction,
    buyingHalted,
    rateCycle,
    fxRegime,
    details,
  };
}

// ─── 레짐별 Gate·Kelly 설정 ────────────────────────────────────────────────────

/**
 * MHS + VKOSPI → 자동매매 레짐 설정 반환.
 *
 * 자동매매 엔진(autoTradeEngine.ts)이 매 사이클마다 호출하여
 * Gate 통과 기준과 허용 신호 등급을 동적으로 결정한다.
 *
 * Gate 2: GATE2_IDS 12개 기준 / Gate 3: GATE3_IDS 10개 기준
 */
export function getRegimeConfig(mhs: number, vkospi: number): RegimeConfig {
  // BULL_AGGRESSIVE: MHS ≥ 70 + VKOSPI < 20
  if (mhs >= MHS.BULL && vkospi < VKOSPI.CALM) {
    return {
      gate2PassCount: 7,   // 12개 중 7개 (기존 9에서 완화)
      gate3PassCount: 5,   // 10개 중 5개 (기존 7에서 완화)
      maxPositionKelly: 1.0,
      allowedSignals: ['CONFIRMED_STRONG_BUY', 'STRONG_BUY', 'BUY', 'WATCH'],
    };
  }
  // BULL_NORMAL: MHS 50~70
  if (mhs >= MHS.NEUTRAL) {
    return {
      gate2PassCount: 8,
      gate3PassCount: 6,
      maxPositionKelly: 0.7,
      allowedSignals: ['CONFIRMED_STRONG_BUY', 'STRONG_BUY', 'BUY'],
    };
  }
  // NEUTRAL: MHS 30~50
  if (mhs >= MHS.DEFENSE) {
    return {
      gate2PassCount: 9,   // 기존 기준 유지
      gate3PassCount: 7,
      maxPositionKelly: 0.5,
      allowedSignals: ['CONFIRMED_STRONG_BUY', 'STRONG_BUY'],
    };
  }
  // DEFENSE: MHS < 30 → 매수 전면 차단
  return {
    gate2PassCount: 99,
    gate3PassCount: 99,
    maxPositionKelly: 0,
    allowedSignals: [],  // 방어 모드: 매도 신호만 처리
  };
}

// ─── MAPC: Macro-Adaptive Position Controller ────────────────────────────────

/**
 * MAPC (매크로 임계값 연동 포지션 자동 조절기)
 *
 * 조정 켈리 = 기본 켈리 × (MHS / 100)
 *
 * BOK 금리·USD/KRW·VIX·VKOSPI를 실시간 모니터링하여
 * 매크로 환경 악화 시 인간의 판단 전에 시스템이 먼저 포지션 크기를 수축시킨다.
 *
 * 4개 축(금리·유동성·경기·리스크) 각각의 기여 점수로 MHS를 분해 →
 * 어떤 축이 켈리를 얼마나 끌어내리는지 실시간 추적 가능.
 *
 * @param gate0        Gate 0 평가 결과 (MHS + 4축 세부 점수)
 * @param env          실시간 매크로 환경 데이터
 * @param baseKellyPct Gate 2에서 산출된 원본 포지션 크기 (%)
 */
export function evaluateMAPCResult(
  gate0: Gate0Result,
  env: MacroEnvironment,
  baseKellyPct: number,
): MAPCResult {
  const { interestRateScore, liquidityScore, economicScore, riskScore } = gate0.details;

  // ── 4개 축 팩터 구성 ──────────────────────────────────────────────────────
  const factorStatus = (score: number): MAPCFactor['status'] =>
    score >= 18 ? 'RISK_ON' : score >= 10 ? 'NEUTRAL' : 'RISK_OFF';

  const factors: MAPCFactor[] = [
    {
      id: 'interest',
      nameKo: '금리·채권',
      currentValue: `BOK ${env.bokRateDirection === 'HIKING' ? '인상' : env.bokRateDirection === 'CUTTING' ? '인하' : '동결'} / US10Y ${env.us10yYield.toFixed(2)}%`,
      score: interestRateScore,
      status: factorStatus(interestRateScore),
      keySignal: env.bokRateDirection === 'HIKING'
        ? 'BOK 기준금리 인상 → Kelly 압박'
        : env.bokRateDirection === 'CUTTING'
          ? 'BOK 금리 인하 사이클 → Risk-On 지지'
          : `US10Y ${env.us10yYield.toFixed(2)}% / KR-US 스프레드 ${env.krUsSpread.toFixed(2)}pp`,
    },
    {
      id: 'liquidity',
      nameKo: '유동성',
      currentValue: `M2 YoY ${env.m2GrowthYoY.toFixed(1)}% / 여신 ${env.bankLendingGrowth.toFixed(1)}%`,
      score: liquidityScore,
      status: factorStatus(liquidityScore),
      keySignal: env.m2GrowthYoY > env.nominalGdpGrowth
        ? `M2(${env.m2GrowthYoY.toFixed(1)}%) > GDP(${env.nominalGdpGrowth.toFixed(1)}%) → 유동성 잉여`
        : `M2(${env.m2GrowthYoY.toFixed(1)}%) ≤ GDP(${env.nominalGdpGrowth.toFixed(1)}%) → 유동성 긴축`,
    },
    {
      id: 'economy',
      nameKo: '경기',
      currentValue: `OECD CLI ${env.oeciCliKorea.toFixed(1)} / 수출 ${env.exportGrowth3mAvg >= 0 ? '+' : ''}${env.exportGrowth3mAvg.toFixed(1)}%`,
      score: economicScore,
      status: factorStatus(economicScore),
      keySignal: env.oeciCliKorea >= 101
        ? `OECD CLI ${env.oeciCliKorea.toFixed(1)} — 경기 확장 국면`
        : env.oeciCliKorea < 99
          ? `OECD CLI ${env.oeciCliKorea.toFixed(1)} — 경기 수축 경보`
          : `수출 증가율 3M 평균 ${env.exportGrowth3mAvg >= 0 ? '+' : ''}${env.exportGrowth3mAvg.toFixed(1)}%`,
    },
    {
      id: 'risk',
      nameKo: '리스크',
      currentValue: `VIX ${env.vix.toFixed(1)} / VKOSPI ${env.vkospi.toFixed(1)} / USD/KRW ${env.usdKrw}`,
      score: riskScore,
      status: factorStatus(riskScore),
      keySignal: env.vix > 30 || env.vkospi > 30
        ? `VIX ${env.vix.toFixed(1)} · VKOSPI ${env.vkospi.toFixed(1)} — 공포지수 급등`
        : env.vix > 22 || env.vkospi > 22
          ? `공포지수 경계 (VIX ${env.vix.toFixed(1)} / VKOSPI ${env.vkospi.toFixed(1)})`
          : `공포지수 안정 / USD/KRW ${env.usdKrw}`,
    },
  ];

  // ── 조정 켈리 계산 ────────────────────────────────────────────────────────
  const mhsMultiplier = gate0.buyingHalted ? 0 : gate0.macroHealthScore / 100;
  const adjustedKellyPct = +(baseKellyPct * mhsMultiplier).toFixed(2);
  const reductionAmt = +(baseKellyPct - adjustedKellyPct).toFixed(2);
  const reductionPct = baseKellyPct > 0
    ? +((reductionAmt / baseKellyPct) * 100).toFixed(1)
    : 0;

  // ── 경보 단계 ────────────────────────────────────────────────────────────
  let alert: MAPCResult['alert'];
  let alertReason: string;
  let actionMessage: string;

  if (gate0.buyingHalted) {
    alert = 'RED';
    alertReason = `MHS ${gate0.macroHealthScore}/100 — 매수 중단 임계(40) 하회`;
    actionMessage = '전면 매수 중단. 기존 포지션 방어 우선. 현금 보유 극대화.';
  } else if (gate0.mhsLevel === 'MEDIUM') {
    alert = 'YELLOW';
    const weakFactors = factors.filter(f => f.status === 'RISK_OFF').map(f => f.nameKo);
    alertReason = `MHS ${gate0.macroHealthScore}/100 — 매크로 환경 취약${weakFactors.length ? ` (${weakFactors.join('·')} 약세)` : ''}`;
    actionMessage = `기본 켈리의 ${(mhsMultiplier * 100).toFixed(0)}%만 집행. 신규 매수 신중히.`;
  } else {
    alert = 'GREEN';
    alertReason = `MHS ${gate0.macroHealthScore}/100 — 매크로 환경 건전`;
    actionMessage = `기본 켈리의 ${(mhsMultiplier * 100).toFixed(0)}% 집행. 정상 포지셔닝 가능.`;
  }

  return {
    baseKellyPct,
    mhsScore: gate0.macroHealthScore,
    buyingHalted: gate0.buyingHalted,
    factors,
    mhsMultiplier,
    adjustedKellyPct,
    reductionAmt,
    reductionPct,
    snapshot: {
      bokRate: env.bokRateDirection,
      usdKrw: env.usdKrw,
      vix: env.vix,
      vkospi: env.vkospi,
    },
    alert,
    alertReason,
    actionMessage,
  };
}
