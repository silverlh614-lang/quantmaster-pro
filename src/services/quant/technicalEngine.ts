// src/services/quant/technicalEngine.ts
import {
  ConditionId, ConfluenceScore, CycleAnalysis, CyclePosition,
  CatalystAnalysis, CatalystGrade, MomentumAcceleration,
  TMAResult, SRRResult, EnemyChecklistEnhanced,
  DataReliability, SignalVerdict, SignalGrade,
  EnemyChecklist, Gate0Result, SmartMoneyData, ExportMomentumData,
  CreditSpreadData, FinancialStressIndex, MultiTimeframe, EvaluationResult,
} from '../../types/quant';
import { REAL_DATA_CONDITIONS, AI_ESTIMATE_CONDITIONS } from './evolutionEngine';

// ─── 판단엔진 고도화 함수 ──────────────────────────────────────────────────────

/**
 * 합치(Confluence) 스코어 — 4개 독립 축의 방향 동시 확인
 */
export function computeConfluence(
  stockData: Record<ConditionId, number>,
  gate0: Gate0Result | undefined,
  advancedContext?: {
    smartMoney?: SmartMoneyData;
    exportMomentum?: ExportMomentumData;
    creditSpread?: CreditSpreadData;
    financialStress?: FinancialStressIndex;
  },
): ConfluenceScore {
  // 축1: 기술적 (RSI·MACD·BB·일목·VCP — 조건 2,6,10,18,20,25,26)
  const techIds: ConditionId[] = [2, 6, 10, 18, 20, 25, 26];
  const techScore = techIds.reduce((s, id) => s + (stockData[id] ?? 0), 0) / techIds.length;
  const technical = techScore >= 7 ? 'BULLISH' as const : techScore >= 4 ? 'NEUTRAL' as const : 'BEARISH' as const;

  // 축2: 수급 (기관·외인·수급질 — 조건 4,11,12)
  const supplyIds: ConditionId[] = [4, 11, 12];
  const supplyScore = supplyIds.reduce((s, id) => s + (stockData[id] ?? 0), 0) / supplyIds.length;
  const supply = supplyScore >= 7 ? 'BULLISH' as const : supplyScore >= 4 ? 'NEUTRAL' as const : 'BEARISH' as const;

  // 축3: 펀더멘털 (ROE·OCF·ICR·마진 — 조건 3,15,21,22,23)
  const fundIds: ConditionId[] = [3, 15, 21, 22, 23];
  const fundScore = fundIds.reduce((s, id) => s + (stockData[id] ?? 0), 0) / fundIds.length;
  const fundamental = fundScore >= 7 ? 'BULLISH' as const : fundScore >= 4 ? 'NEUTRAL' as const : 'BEARISH' as const;

  // 축4: 매크로 (Gate0 MHS + FSI + 크레딧)
  let macroScore = 0;
  if (gate0?.mhsLevel === 'HIGH') macroScore += 3;
  else if (gate0?.mhsLevel === 'MEDIUM') macroScore += 1;
  if (advancedContext?.financialStress?.systemAction === 'NORMAL') macroScore += 2;
  else if (advancedContext?.financialStress?.systemAction === 'CAUTION') macroScore += 1;
  if (advancedContext?.creditSpread?.isLiquidityExpanding) macroScore += 2;
  if (advancedContext?.smartMoney?.isEwyMtumBothInflow) macroScore += 1;
  const macro = macroScore >= 6 ? 'BULLISH' as const : macroScore >= 3 ? 'NEUTRAL' as const : 'BEARISH' as const;

  const axes = [technical, supply, fundamental, macro];
  const bullishCount = axes.filter(a => a === 'BULLISH').length;

  return { technical, supply, fundamental, macro, bullishCount, confirmed: bullishCount === 4 };
}

/**
 * 사이클 위치 분류 — EARLY / MID / LATE
 */
export function classifyCyclePosition(
  sectorRsRank: number,        // 상위 % (0=최상, 100=최하)
  newsPhase: 'SILENT' | 'EARLY' | 'GROWING' | 'CROWDED' | 'OVERHYPED',
  weeklyRsi?: number,
): CycleAnalysis {
  let position: CyclePosition = 'MID';
  let kellyMultiplier = 0.7;

  // EARLY: RS 상위 2~20% 진입 초기 + 뉴스 SILENT/EARLY
  if (sectorRsRank <= 20 && sectorRsRank >= 2 && (newsPhase === 'SILENT' || newsPhase === 'EARLY')) {
    position = 'EARLY';
    kellyMultiplier = 1.0;
  }
  // LATE: RS 상위 1% 과열 OR 뉴스 CROWDED/OVERHYPED OR 주봉 RSI 80+
  else if (sectorRsRank < 2 || newsPhase === 'CROWDED' || newsPhase === 'OVERHYPED' || (weeklyRsi && weeklyRsi >= 80)) {
    position = 'LATE';
    kellyMultiplier = 0;
  }

  const sectorRsTrend = sectorRsRank <= 5 ? 'ACCELERATING' as const
    : sectorRsRank <= 20 ? 'STABLE' as const : 'DECELERATING' as const;

  return {
    position,
    sectorRsRank,
    sectorRsTrend,
    newsPhase,
    foreignFlowPhase: 'ACTIVE_ONLY', // 기본값 — 실제 데이터 있을 때 오버라이드
    kellyMultiplier,
  };
}

/**
 * 촉매 품질 등급화 — A(구조적) / B(사이클) / C(단기)
 * AI가 추정한 촉매 점수(0-10)와 설명 텍스트에서 판별
 */
export function gradeCatalyst(
  catalystScore: number,       // 조건27 점수 (0-10)
  catalystDesc?: string,       // AI 설명 텍스트
): CatalystAnalysis {
  const desc = (catalystDesc ?? '').toLowerCase();

  // Grade A: 구조적 변화 키워드
  const gradeAKeywords = ['수주잔고', '법제화', '장기계약', '정부정책', 'nrc승인', '10년', '대규모', '구조적'];
  const isGradeA = catalystScore >= 8 && gradeAKeywords.some(k => desc.includes(k));

  // Grade C: 단기 재료 키워드
  const gradeCKeywords = ['테마', '소문', '단기', '루머', '공시', '일회성'];
  const isGradeC = catalystScore < 5 || gradeCKeywords.some(k => desc.includes(k));

  if (isGradeA) {
    return { grade: 'A', type: '구조적 변화', durability: 'STRUCTURAL', description: catalystDesc ?? '', strongBuyAllowed: true };
  }
  if (isGradeC) {
    return { grade: 'C', type: '단기 재료', durability: 'TEMPORARY', description: catalystDesc ?? '', strongBuyAllowed: false };
  }
  return { grade: 'B', type: '사이클 모멘텀', durability: 'CYCLICAL', description: catalystDesc ?? '', strongBuyAllowed: false };
}

/**
 * 모멘텀 가속도 분석
 */
export function analyzeMomentumAcceleration(
  rsiValues: number[],                   // 최근 3주 RSI [45, 52, 62]
  institutionalAmounts: number[],        // 최근 5일 기관 순매수 금액
  volumeTrend: 'INCREASING' | 'STABLE' | 'DECREASING',
): MomentumAcceleration {
  const rsiAccelerating = rsiValues.length >= 3
    && rsiValues.every((v, i) => i === 0 || v > rsiValues[i - 1]);
  const institutionalAccelerating = institutionalAmounts.length >= 3
    && institutionalAmounts.every((v, i) => i === 0 || v > institutionalAmounts[i - 1]);

  return {
    rsiTrend: rsiValues,
    rsiAccelerating,
    institutionalTrend: institutionalAmounts,
    institutionalAccelerating,
    volumeTrend,
    overallAcceleration: rsiAccelerating && institutionalAccelerating,
  };
}

/**
 * TMA (추세 모멘텀 가속도 측정기) — 수익률의 2차 미분
 *
 * 물리학 원리: 포물선 운동에서 최고점 도달 전에 이미 가속도는 0이 된다.
 * 가격이 최고점이어도 TMA가 음수 전환 시 1~2주 먼저 변곡점을 포착한다.
 *
 * TMA = (오늘 수익률 - N일전 수익률) / N  [단위: %/일]
 *
 * 단계 분류:
 *   ACCELERATING          — TMA>0 & 상승 추세 (속도·가속 모두 양)
 *   DECELERATING_POSITIVE — TMA>0 이지만 감소 추세 → 경계 구간
 *   DECELERATING_NEGATIVE — TMA<0 → 감속 진입 → 변곡 경보
 *   CRASHED               — TMA<-0.5 → 급격한 감속 → 즉각 대응
 *
 * @param dailyCloses - 일봉 종가 (오래된 순, 최소 period+2 개)
 * @param period      - 가속도 측정 기간 (기본 5일)
 * @param historyLen  - 스파크라인 이력 길이 (기본 15)
 */
export function evaluateTMA(dailyCloses: number[], period = 5, historyLen = 15): TMAResult {
  const empty: TMAResult = {
    tma: 0, returnToday: 0, returnNAgo: 0, period, alert: 'NONE',
    phase: 'ACCELERATING', tmaHistory: [], tmaDecelerating: false,
  };
  if (dailyCloses.length < period + 2) return empty;

  // 1. 일별 수익률(%) 계산
  const returns: number[] = [];
  for (let i = 1; i < dailyCloses.length; i++) {
    returns.push(((dailyCloses[i] - dailyCloses[i - 1]) / dailyCloses[i - 1]) * 100);
  }

  // 2. 롤링 TMA 시계열 — returns[period] 부터 끝까지
  const tmaHistory: number[] = [];
  for (let i = period; i < returns.length; i++) {
    tmaHistory.push((returns[i] - returns[i - period]) / period);
  }

  if (tmaHistory.length === 0) return empty;

  const tma = tmaHistory[tmaHistory.length - 1];
  const prevTma = tmaHistory.length >= 2 ? tmaHistory[tmaHistory.length - 2] : tma;

  // 3. 경보 단계
  let alert: TMAResult['alert'] = 'NONE';
  if (tma < -0.5) alert = 'IMMEDIATE';
  else if (tma < 0) alert = 'DECELERATION';

  // 4. TMA가 양수이지만 직전 대비 하락 중 (경계 신호)
  const tmaDecelerating = tma > 0 && tma < prevTma;

  // 5. 단계 분류
  let phase: TMAResult['phase'];
  if (tma < -0.5)              phase = 'CRASHED';
  else if (tma < 0)            phase = 'DECELERATING_NEGATIVE';
  else if (tmaDecelerating)    phase = 'DECELERATING_POSITIVE';
  else                         phase = 'ACCELERATING';

  return {
    tma,
    returnToday: returns[returns.length - 1],
    returnNAgo: returns[returns.length - 1 - period],
    period,
    alert,
    phase,
    tmaHistory: tmaHistory.slice(-historyLen),
    tmaDecelerating,
  };
}

/**
 * SRR (섹터 내 상대강도 역전 감지)
 *
 * RS Ratio = 종목 20일 수익률 / 섹터ETF 20일 수익률
 *
 * 경보 단계:
 *   NORMAL   — RS Ratio ≥ 1.0 유지, 순위 유지
 *   WATCH    — RS Ratio < 1.0 진입 (1~2주) 또는 순위 이탈 임박
 *   WARNING  — RS Ratio < 1.0 → 3주 연속 (주도주 지위 상실)
 *   CRITICAL — RS Ratio < 0.8 → 5주 연속 (즉각 교체 매매 검토)
 *
 * Gate 3 연동: 매수 시 상위 5% → 현재 상위 20% 이탈 → rankBandBreached 경보
 *
 * @param weeklyRsRatios  주간 RS Ratio 이력 (오래된 순, 최소 1주)
 * @param entryRsRank     매수 시점 RS 순위 (%, 0~100, 낮을수록 우수)
 * @param currentRsRank   현재 RS 순위 (%)
 * @param stockReturn20d  종목 최근 20일 수익률 (%)
 * @param sectorReturn20d 섹터 ETF 최근 20일 수익률 (%)
 */
export function evaluateSRR(
  weeklyRsRatios: number[],
  entryRsRank: number,
  currentRsRank: number,
  stockReturn20d: number,
  sectorReturn20d: number,
): SRRResult {
  // ── 현재 RS Ratio ────────────────────────────────────────────────────────
  // sectorReturn20d가 0에 가까우면 분모 보정 (±0.001 미만 → 1.0으로 취급)
  const rsRatio = Math.abs(sectorReturn20d) < 0.001
    ? (stockReturn20d >= 0 ? 1.5 : 0.5)
    : stockReturn20d / sectorReturn20d;

  // ── 연속 위반 주수 계산 ───────────────────────────────────────────────────
  // 최근부터 역방향으로 연속 위반 주수를 셈
  function countConsecutiveTail(ratios: number[], threshold: number): number {
    let count = 0;
    for (let i = ratios.length - 1; i >= 0; i--) {
      if (ratios[i] < threshold) count++;
      else break;
    }
    return count;
  }

  const allRatios = [...weeklyRsRatios, rsRatio];
  const consecutiveBelowOne = countConsecutiveTail(allRatios, 1.0);
  const consecutiveBelowEight = countConsecutiveTail(allRatios, 0.8);

  // ── 주도주 지위 상실 / 교체 신호 ─────────────────────────────────────────
  const leadingStockLost = consecutiveBelowOne >= 3;
  const replaceSignal = consecutiveBelowEight >= 5;

  // ── 순위 이탈 (Gate 3 연동) ───────────────────────────────────────────────
  const rankDrift = currentRsRank - entryRsRank;
  // 매수 시 상위 5% 이었으나 현재 상위 20% 밖으로 이탈
  const rankBandBreached = entryRsRank <= 5 && currentRsRank > 20;

  // ── 경보 단계 ────────────────────────────────────────────────────────────
  let alert: SRRResult['alert'];
  let actionMessage: string;

  if (replaceSignal) {
    alert = 'CRITICAL';
    actionMessage = `RS Ratio < 0.8 → ${consecutiveBelowEight}주 연속 — 즉각 교체 매매 검토. 섹터 내 주도주 지위 완전 상실.`;
  } else if (leadingStockLost || rankBandBreached) {
    alert = 'WARNING';
    actionMessage = leadingStockLost
      ? `RS Ratio < 1.0 → ${consecutiveBelowOne}주 연속 — 주도주 지위 상실 경보. 비중 축소 준비.`
      : `매수 시 RS 상위 ${entryRsRank.toFixed(1)}% → 현재 ${currentRsRank.toFixed(1)}% — 상위 20% 이탈. 사이클 후반 진입 신호.`;
  } else if (consecutiveBelowOne >= 1 || rankDrift > 10) {
    alert = 'WATCH';
    actionMessage = consecutiveBelowOne >= 1
      ? `RS Ratio < 1.0 진입 (${consecutiveBelowOne}주) — 3주 지속 시 주도주 지위 상실 경보 발동.`
      : `RS 순위 +${rankDrift.toFixed(1)}%p 이탈 — 섹터 내 상대 강도 약화 주시.`;
  } else {
    alert = 'NORMAL';
    actionMessage = `RS Ratio ${rsRatio.toFixed(2)} — 섹터 내 상대 강도 유지. 주도주 지위 정상.`;
  }

  return {
    rsRatio,
    stockReturn20d,
    sectorReturn20d,
    weeklyRsRatios: allRatios.slice(-8),   // 최근 8주만 보관
    consecutiveBelowOne,
    consecutiveBelowEight,
    entryRsRank,
    currentRsRank,
    rankDrift,
    leadingStockLost,
    replaceSignal,
    rankBandBreached,
    alert,
    actionMessage,
  };
}

/**
 * 강화된 적의 체크리스트 — 7항목 역검증
 */
export function evaluateEnemyChecklist(
  base: EnemyChecklist | undefined,
  flags: Partial<{
    lockupExpiringSoon: boolean;
    majorShareholderSelling: boolean;
    creditBalanceSurge: boolean;
    shortInterestSurge: boolean;
    targetPriceDowngrade: boolean;
    fundMaturityDue: boolean;
    clientPerformanceWeak: boolean;
  }>,
): EnemyChecklistEnhanced {
  const f = {
    lockupExpiringSoon: flags.lockupExpiringSoon ?? false,
    majorShareholderSelling: flags.majorShareholderSelling ?? false,
    creditBalanceSurge: flags.creditBalanceSurge ?? false,
    shortInterestSurge: flags.shortInterestSurge ?? false,
    targetPriceDowngrade: flags.targetPriceDowngrade ?? false,
    fundMaturityDue: flags.fundMaturityDue ?? false,
    clientPerformanceWeak: flags.clientPerformanceWeak ?? false,
  };
  const blockedCount = Object.values(f).filter(Boolean).length;

  return {
    bearCase: base?.bearCase ?? '',
    riskFactors: base?.riskFactors ?? [],
    counterArguments: base?.counterArguments ?? [],
    ...f,
    blockedCount,
    strongBuyBlocked: blockedCount >= 2,
  };
}

/**
 * 데이터 신뢰도 추적
 */
export function computeDataReliability(stockData: Record<ConditionId, number>): DataReliability {
  const realCount = REAL_DATA_CONDITIONS.filter(id => (stockData[id] ?? 0) > 0).length;
  const aiCount = AI_ESTIMATE_CONDITIONS.filter(id => (stockData[id] ?? 0) > 0).length;
  const total = realCount + aiCount;
  const reliabilityPct = total > 0 ? Math.round((realCount / total) * 100) : 0;

  return {
    realDataCount: realCount,
    aiEstimateCount: aiCount,
    reliabilityPct,
    degraded: reliabilityPct < 50,
  };
}

/**
 * 최종 신호 판정 — CONFIRMED STRONG BUY 7개 조건 검증
 *
 * ① 기존 6개 조건 (25/27, RS, 기관, RRR, 일목, VKOSPI)
 * ② 합치 4/4축 BULLISH
 * ③ 멀티타임프레임 월봉+주봉 BULLISH
 * ④ 촉매 등급 A
 * ⑤ 역검증 통과 (blockedCount < 2)
 * ⑥ 사이클 EARLY
 * ⑦ 모멘텀 가속 확인
 */
/**
 * 최종 신호 판정 — 4단계 체계
 *
 * CONFIRMED_STRONG_BUY : 7/7 고급 조건 + 데이터 신뢰도 정상 → Kelly 100%, 자동매매 허용
 * BUY                  : Gate 1~3 전부 통과 + RRR ≥ 2.0 → Kelly 50%, 분할 1차 진입
 *                        (또는 상승 초기 선취매 조건 3개 충족 → Gate 3 미달이어도 BUY 50%)
 * WATCH                : Gate 1~2 통과, Gate 3 미달 → Kelly 0%, 알림 대기
 * HOLD                 : Gate 1만 통과 또는 전부 미달 → Kelly 0%, 관망
 *
 * ※ STRONG_BUY 등급은 하위 호환성을 위해 타입에 유지하나 이 함수에서는 발급하지 않음.
 */
export function computeSignalVerdict(
  gate1Passed: boolean,
  gate2Passed: boolean,
  gate3Passed: boolean,
  recommendation: EvaluationResult['recommendation'],
  rrr: number,
  confluence: ConfluenceScore,
  multiTimeframe: MultiTimeframe | undefined,
  catalystAnalysis: CatalystAnalysis,
  enemyEnhanced: EnemyChecklistEnhanced,
  cycleAnalysis: CycleAnalysis,
  momentumAcc: MomentumAcceleration,
  dataReliability: DataReliability,
  earlyBullEntryOk: boolean = false,   // Step 3: 상승 초기 선취매 조건 충족 여부
  isBullRegime: boolean = false,        // Step 1: Bull Regime 완화 적용 중 여부
): SignalVerdict {
  const passed: string[] = [];
  const failed: string[] = [];

  // ① Gate 1~3 전부 통과 + 풀 포지션
  const gatesOk = gate1Passed && gate2Passed && gate3Passed && recommendation === '풀 포지션';
  if (gatesOk) passed.push('Gate 1~3 통과 + 풀 포지션');
  else failed.push('Gate 미달 또는 관망/매도');

  // ② 합치 4/4
  if (confluence.confirmed) passed.push(`합치 4/4 (${confluence.bullishCount}/4 BULLISH)`);
  else failed.push(`합치 ${confluence.bullishCount}/4 (미확인)`);

  // ③ 멀티타임프레임
  const mtfOk = multiTimeframe?.monthly === 'BULLISH' && multiTimeframe?.weekly === 'BULLISH';
  if (mtfOk) passed.push('월봉+주봉 BULLISH');
  else failed.push('멀티타임프레임 미달');

  // ④ 촉매 A등급
  if (catalystAnalysis.grade === 'A') passed.push(`촉매 A등급 (${catalystAnalysis.type})`);
  else failed.push(`촉매 ${catalystAnalysis.grade}등급`);

  // ⑤ 역검증 통과
  if (!enemyEnhanced.strongBuyBlocked) passed.push('역검증 통과');
  else failed.push(`역검증 실패 (${enemyEnhanced.blockedCount}개 위험)`);

  // ⑥ 사이클 EARLY
  if (cycleAnalysis.position === 'EARLY') passed.push('사이클 EARLY');
  else failed.push(`사이클 ${cycleAnalysis.position}`);

  // ⑦ 모멘텀 가속
  if (momentumAcc.overallAcceleration) passed.push('모멘텀 가속 확인');
  else failed.push('모멘텀 비가속');

  // 데이터 신뢰도 경고
  if (dataReliability.degraded) failed.push(`데이터 신뢰도 ${dataReliability.reliabilityPct}% (AI 의존 과다)`);

  // ── 4단계 등급 결정 ────────────────────────────────────────────────────────
  let grade: SignalGrade;
  let kellyPct: number;
  let positionRule: string;
  let isEarlyBullEntry = false;

  if (passed.length === 7 && !dataReliability.degraded) {
    // ─ CONFIRMED STRONG BUY: 7/7 고급 조건 전부 충족
    grade = 'CONFIRMED_STRONG_BUY';
    kellyPct = 100;
    positionRule = '풀 포지션, 자동매매 허용';
  } else if (gate1Passed && gate2Passed && gate3Passed && rrr >= 2.0) {
    // ─ BUY: Gate 1~3 전부 통과 + RRR ≥ 2.0 → Kelly 50% 분할 1차 진입
    grade = 'BUY';
    kellyPct = 50;
    positionRule = 'Gate 1~3 통과 + RRR≥2.0 — 분할 1차 진입';
  } else if (gate1Passed && gate2Passed && !gate3Passed && earlyBullEntryOk) {
    // ─ BUY (선취매): Gate 3 미달이어도 상승 초기 3조건 충족 → BUY 50%
    //   이후 Gate 3 충족 시 나머지 50% 추가
    grade = 'BUY';
    kellyPct = 50;
    positionRule = '상승 초기 선취매 (Gate 3 미달) — Gate 3 충족 후 나머지 50% 추가';
    isEarlyBullEntry = true;
  } else if (gate1Passed && gate2Passed) {
    // ─ WATCH: Gate 1+2 통과, Gate 3 미달 → 알림 대기, 트리거 시 진입
    grade = 'WATCH';
    kellyPct = 0;
    positionRule = '알림 대기 — Gate 3 충족 또는 선취매 조건 확인 시 진입';
    if (isBullRegime) positionRule += ' (Bull Regime 완화 적용 중)';
  } else {
    // ─ HOLD: Gate 1만 통과 또는 전부 미달
    grade = 'HOLD';
    kellyPct = 0;
    positionRule = '관망 — Gate 1' + (gate1Passed ? '만 통과' : ' 미달');
  }

  return {
    grade,
    kellyPct,
    positionRule,
    passedConditions: passed,
    failedConditions: failed,
    isBullRegime,
    isEarlyBullEntry,
  };
}
