import {
  BearRegimeResult,
  BearRegimeCondition,
  BearSeasonalityResult,
  VkospiTriggerResult,
  VkospiTriggerLevel,
  InverseGate1Result,
  InverseGate1Condition,
  InverseGate1SignalType,
  MarketNeutralResult,
  MarketNeutralLeg,
  BetaNeutralScenario,
  BearScreenerResult,
  BearScreenerCondition,
  BearKellyResult,
  BearModeSimulatorInput,
  BearModeSimulatorResult,
  BearModeSimulatorScenarioResult,
  MacroEnvironment,
  Gate0Result,
} from '../../types/quant';

// ─── 아이디어 1: Gate -1 "Market Regime Detector" — Bull/Bear 자동 판별 게이트 ──

const FOMC_APPROX_MEETINGS: Array<{ month: number; day: number }> = [
  { month: 1, day: 31 },
  { month: 3, day: 20 },
  { month: 5, day: 10 },
  { month: 6, day: 20 },
  { month: 7, day: 31 },
  { month: 9, day: 20 },
  { month: 11, day: 10 },
  { month: 12, day: 20 },
];

function isWithinMonthDayRange(month: number, day: number, startMonth: number, startDay: number, endMonth: number, endDay: number): boolean {
  const current = month * 100 + day;
  const start = startMonth * 100 + startDay;
  const end = endMonth * 100 + endDay;
  if (start <= end) {
    return current >= start && current <= end;
  }
  return current >= start || current <= end;
}

/**
 * 아이디어 11: 계절성 Bear Calendar
 * 통계적으로 약세 빈도가 높은 구간(9~10월, 12월 중순~1월 초, 실적 시즌 직전, FOMC 직전)을
 * 감지하여 Gate -1 임계치를 자동 조정한다.
 */
export function evaluateBearSeasonality(
  macroEnv: MacroEnvironment,
  asOfDate: Date = new Date(),
): BearSeasonalityResult {
  const now = asOfDate.toISOString();
  const month = asOfDate.getUTCMonth() + 1;
  const day = asOfDate.getUTCDate();
  const year = asOfDate.getUTCFullYear();

  const isAutumnWeakness = month === 9 || month === 10;
  const isYearEndClearing = isWithinMonthDayRange(month, day, 12, 15, 1, 10);
  const isPreQ1Earnings = isWithinMonthDayRange(month, day, 3, 25, 4, 20);

  const todayUTC = Date.UTC(year, month - 1, day);
  const isPreFomc = FOMC_APPROX_MEETINGS.some(({ month: meetingMonth, day: meetingDay }) => {
    const meetingUTC = Date.UTC(year, meetingMonth - 1, meetingDay);
    const dayDiff = Math.floor((meetingUTC - todayUTC) / (1000 * 60 * 60 * 24));
    return dayDiff >= 1 && dayDiff <= 7;
  });

  const windows: BearSeasonalityResult['windows'] = [
    {
      id: 'AUTUMN_WEAKNESS',
      name: '9~10월 약세 시즌',
      active: isAutumnWeakness,
      description: '여름 랠리 소진 + 외국인 연말 리밸런싱 선반영 구간',
      period: '9월~10월',
    },
    {
      id: 'YEAR_END_CLEARING',
      name: '연말/연초 청산 압력',
      active: isYearEndClearing,
      description: '12월 윈도우드레싱 이후 포지션 정리 물량 출회 구간',
      period: '12/15~1/10',
    },
    {
      id: 'PRE_Q1_EARNINGS',
      name: '1Q 실적 시즌 직전',
      active: isPreQ1Earnings,
      description: '어닝 쇼크 우려 선반영 매도 가능성이 높은 기간',
      period: '3/25~4/20',
    },
    {
      id: 'PRE_FOMC',
      name: 'FOMC 직전 불확실성',
      active: isPreFomc,
      description: '정책 발표 직전 리스크 오프 성향 강화 구간',
      period: 'FOMC D-7~D-1',
    },
  ];

  const activeWindowIds = windows.filter(window => window.active).map(window => window.id);
  const isBearSeason = activeWindowIds.length > 0;
  const vkospiRisingConfirmed = macroEnv.vkospiRising === true;
  const inverseEntryWeightPct = isBearSeason && vkospiRisingConfirmed ? 20 : 0;
  const gateThresholdAdjustment = isBearSeason ? -1 : 0;

  const actionMessage = !isBearSeason
    ? '계절성 Bear Calendar 비활성 — Gate -1 기본 임계치(5개) 유지.'
    : inverseEntryWeightPct > 0
      ? `약세 계절성 + VKOSPI 동반 상승 확인. 인버스 진입 확률 가중치 +${inverseEntryWeightPct}% 적용, Gate -1 민감도 강화.`
      : '약세 계절성 구간 감지. Gate -1 임계치를 자동 하향 조정하여 민감도를 높입니다.';

  return {
    isBearSeason,
    windows,
    activeWindowIds,
    gateThresholdAdjustment,
    inverseEntryWeightPct,
    vkospiRisingConfirmed,
    actionMessage,
    lastUpdated: now,
  };
}

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

// ─── 아이디어 4: VKOSPI 공포지수 트리거 시스템 ──────────────────────────────────

/**
 * VKOSPI 수치를 4단계 트리거 레벨로 평가하여 인버스 ETF 전략 및 현금 비중을 반환한다.
 * VKOSPI ≥ 50 (역사적 공포) 시 인버스 포지션 최대화 + V자 반등 준비 종목 리스트 병행 생성.
 */
export function evaluateVkospiTrigger(vkospi: number): VkospiTriggerResult {
  const now = new Date().toISOString();

  const INVERSE_ETFS = [
    'KODEX 200선물인버스2X (233740)',
    'KODEX 코스닥150선물인버스 (251340)',
    'TIGER 200선물인버스2X (252670)',
  ];

  const V_RECOVERY_STOCKS = [
    '삼성전자 (005930) — 반도체 V반등 선도주',
    'SK하이닉스 (000660) — HBM 수요 회복 수혜',
    '현대차 (005380) — 글로벌 수출 정상화',
    'POSCO홀딩스 (005490) — 철강 수요 반등',
    'KB금융 (105560) — 금리 안정화 수혜 금융주',
    'KODEX 200 (069500) — 지수 회복 직접 수혜',
  ];

  let level: VkospiTriggerLevel;
  let cashRatio: number;
  let inversePosition: number;
  let description: string;
  let actionMessage: string;
  let dualPositionActive: boolean;
  let vRecoveryStocks: string[] | undefined;

  if (vkospi >= 50) {
    level = 'HISTORICAL_FEAR';
    cashRatio = 10;
    inversePosition = 80;
    dualPositionActive = true;
    vRecoveryStocks = V_RECOVERY_STOCKS;
    description = `VKOSPI ${vkospi.toFixed(1)} — 역사적 공포 이벤트 (2008 금융위기·2020 코로나 수준).`;
    actionMessage = '🚨 역사적 공포 이벤트 — 인버스 ETF 최대 포지션(80%) 유지. 동시에 V자 반등 준비 리스트 자동 생성. 추가 공포 매도 시 분할 역발상 롱 준비.';
  } else if (vkospi >= 40) {
    level = 'ENTRY_2';
    cashRatio = 20;
    inversePosition = 60;
    dualPositionActive = false;
    description = `VKOSPI ${vkospi.toFixed(1)} — 고공포 구간. 인버스 ETF 추가 진입 신호.`;
    actionMessage = '🔴 인버스 ETF 추가 진입 — 포지션 60%까지 확대. 손절선: VKOSPI 35 하향 복귀 시 절반 청산.';
  } else if (vkospi >= 30) {
    level = 'ENTRY_1';
    cashRatio = 40;
    inversePosition = 30;
    dualPositionActive = false;
    description = `VKOSPI ${vkospi.toFixed(1)} — 공포 구간 진입. 인버스 ETF 1차 진입 적기.`;
    actionMessage = '🟠 인버스 ETF 1차 진입 — 포지션 30% 구축. 추가 상승 시(VKOSPI 40+) 2차 진입 대기.';
  } else if (vkospi >= 25) {
    level = 'WARNING';
    cashRatio = 20;
    inversePosition = 0;
    dualPositionActive = false;
    description = `VKOSPI ${vkospi.toFixed(1)} — 경계 구간. Bear Mode 경계경보 발령.`;
    actionMessage = '🟡 Bear Mode 경계경보 — 현금 비중 20% 확보. 신규 롱 포지션 규모 축소. 인버스 ETF 준비 대기.';
  } else {
    level = 'NORMAL';
    cashRatio = 0;
    inversePosition = 0;
    dualPositionActive = false;
    description = `VKOSPI ${vkospi.toFixed(1)} — 정상 시장. Risk-On 최적 환경.`;
    actionMessage = '🟢 정상 시장 — VKOSPI 20 이하는 Risk-On 최적기. 27조건 롱 시스템 전면 가동.';
  }

  return {
    level,
    vkospi,
    cashRatio,
    inversePosition,
    dualPositionActive,
    inverseEtfSuggestions: inversePosition > 0 ? INVERSE_ETFS : [],
    vRecoveryStocks,
    description,
    actionMessage,
    lastUpdated: now,
  };
}

// ─── 아이디어 9: Market Neutral 모드 — 롱/인버스 동시 보유로 변동성 수익 추구 ──

/**
 * TRANSITION 레짐에서 Market Neutral 전략을 평가한다.
 * 롱(50%) + 인버스(30%) + 현금(20%) 구조로 베타를 중립화하여
 * 시장 방향과 무관하게 롱 종목의 개별 알파(초과 수익)만 추구한다.
 *
 * 핵심 공식:
 *   포트폴리오 수익 = 롱 비중 × (시장 수익 + 알파) + 인버스 비중 × (−시장 수익 × 2배) + 현금
 *   → 시장 베타가 상쇄되어 알파가 전체 성과를 좌우한다.
 */
export function evaluateMarketNeutral(
  bearRegimeResult: BearRegimeResult,
): MarketNeutralResult {
  const now = new Date().toISOString();
  const regime = bearRegimeResult.regime;
  const isActive = regime === 'TRANSITION';

  const legs: MarketNeutralLeg[] = [
    {
      type: 'LONG',
      weightPct: 50,
      label: '롱 포지션 (실적 주도주)',
      description: '3-Gate 시스템이 선별한 최고 품질 종목. 조선·방산 등 시장 대비 아웃퍼폼 기대 섹터.',
      examples: ['HD현대중공업', 'LIG넥스원', '한화에어로스페이스', 'HD한국조선해양'],
    },
    {
      type: 'INVERSE',
      weightPct: 30,
      label: '인버스 ETF (시장 헤지)',
      description: 'KOSPI 200 지수 하락 시 수익을 내는 인버스 ETF로 시장 베타를 상쇄한다.',
      examples: ['KODEX 200선물인버스 (114800)', 'TIGER 200선물인버스2X (252670)'],
    },
    {
      type: 'CASH',
      weightPct: 20,
      label: '현금 (기회 대기)',
      description: 'TRANSITION 구간이 BEAR로 전환될 경우 즉시 인버스를 추가하거나, BULL 전환 시 롱 비중을 확대한다.',
      examples: ['CMA', '단기채 ETF'],
    },
  ];

  // 베타 중립화 시나리오: 시장 −5%, 롱 알파 +3%, 인버스 2배 레버리지 기준
  // 롱 수익 = 50% × (−5% + 3%) = −1%
  // 인버스 수익 = 30% × (+10%) = +3%
  // 현금 = 20% × 0% = 0%
  // 합계 = +2%
  const marketReturn = -5;
  const longAlpha = 3;
  const inverseReturn = 10; // 인버스 2배 ETF 기준, 시장 −5% → +10%
  const longReturn = (marketReturn + longAlpha) * (50 / 100);
  const invReturn = inverseReturn * (30 / 100);
  const totalReturn = parseFloat((longReturn + invReturn).toFixed(2));

  const betaNeutralScenario: BetaNeutralScenario = {
    marketReturn,
    longAlpha,
    inverseReturn,
    totalReturn,
    description:
      `시장 ${marketReturn}% 하락 시: 롱(50%) ${longReturn > 0 ? '+' : ''}${longReturn.toFixed(1)}% ` +
      `+ 인버스(30%) +${invReturn.toFixed(1)}% = 포트폴리오 ${totalReturn >= 0 ? '+' : ''}${totalReturn}%`,
  };

  const strategyDescription =
    'TRANSITION 구간(변동성 ↑, 방향 불명확)에서 롱과 인버스를 동시 보유해 시장 방향에 무관하게 ' +
    '롱 종목의 개별 알파만 수익화하는 베타 중립 전략. ' +
    'QuantMaster Pro의 3-Gate 시스템이 선별한 최고 품질 종목에 이 전략을 결합하면 샤프 지수를 극적으로 개선할 수 있다.';

  const sharpeImprovementNote =
    '롱 단독 대비 변동성을 약 40% 축소하면서 알파를 보존 → 샤프 지수 1.2 → 2.0+ 개선 기대';

  const actionMessage = isActive
    ? '🟡 Market Neutral 모드 활성화 — 롱 50% / 인버스 30% / 현금 20% 구조로 베타를 중립화하세요. 3-Gate 선별 실적 주도주 롱 + KODEX 200선물인버스 헤지 권고.'
    : regime === 'BEAR'
    ? '🔴 BEAR 모드 — Market Neutral 전략 비활성. 인버스 비중 확대 및 롱 포지션 전면 청산 권고.'
    : '🟢 BULL 모드 — Market Neutral 전략 불필요. 27조건 롱 시스템 전면 가동.';

  return {
    isActive,
    regime,
    legs,
    betaNeutralScenario,
    sharpeImprovementNote,
    strategyDescription,
    actionMessage,
    lastUpdated: now,
  };
}

// ─── 아이디어 3: Bear Regime 전용 종목 발굴 — "하락 수혜주" 자동 탐색 ──────────

/**
 * Gate -1이 Bear Regime을 감지하면 자동 활성화되는 Bear Screener.
 * 기존 27조건 대신 방어형 15조건으로 종목을 재스크리닝한다.
 *
 * 카테고리:
 *  - 방어주 (Defensive):        음식료·통신·유틸리티 — 경기와 무관한 필수 소비
 *  - 역주기주 (Counter-Cyclical): 채권형 ETF, 금 ETF, 달러 ETF
 *  - 숏 수혜주 (Value-Depressed): 실적 탄탄하나 주가만 눌린 종목
 *  - 변동성 수혜주 (Volatility Beneficiary): 보험주, 금융주(NIM 개선)
 */
export function evaluateBearScreener(
  macroEnv: MacroEnvironment,
  bearRegimeResult: BearRegimeResult,
): BearScreenerResult {
  const now = new Date().toISOString();
  const isActive = bearRegimeResult.regime === 'BEAR';

  // ─── 방어주 조건 (4개) ──────────────────────────────────────────────────────

  /** 조건 D1: 배당 수익률 3% 이상 — 하락장에서도 안정적 현금흐름 */
  const condD1: BearScreenerCondition = {
    id: 'DIVIDEND_YIELD_3PCT',
    name: '배당 수익률 3% 이상',
    passed: true, // AI 스크리닝 단계에서 검증 — 항상 활성화하여 탐색 유도
    category: 'DEFENSIVE',
    description: '배당 수익률 3% 이상인 고배당 방어주는 하락장에서 주가 하방 지지 역할을 한다.',
  };

  /** 조건 D2: 음식료·생활용품 필수소비재 섹터 */
  const condD2: BearScreenerCondition = {
    id: 'ESSENTIAL_CONSUMER_SECTOR',
    name: '필수소비재 섹터 (음식료·생활용품)',
    passed: true,
    category: 'DEFENSIVE',
    description: '경기 둔화와 무관하게 수요가 유지되는 필수소비재 업종으로 하락장 방어력이 높다.',
  };

  /** 조건 D3: 통신·유틸리티 섹터 — 규제 보호 + 안정 배당 */
  const condD3: BearScreenerCondition = {
    id: 'TELCO_UTILITY_SECTOR',
    name: '통신·유틸리티 섹터',
    passed: true,
    category: 'DEFENSIVE',
    description: '규제 산업으로 경쟁이 제한되어 있고 안정적 현금흐름·배당으로 하락장 방어력 우수.',
  };

  /** 조건 D4: 저베타 (β < 0.7) — 시장 대비 낮은 변동성 */
  const condD4: BearScreenerCondition = {
    id: 'LOW_BETA',
    name: '저베타 종목 (β 0.7 미만)',
    passed: true,
    category: 'DEFENSIVE',
    description: '시장 하락 시 상대적으로 낮은 낙폭을 기록하는 저베타 종목을 우선 탐색.',
  };

  // ─── 역주기주 조건 (4개) ─────────────────────────────────────────────────────

  /** 조건 CC1: 채권형 ETF — 금리 하락 기대 시 가격 상승 */
  const condCC1: BearScreenerCondition = {
    id: 'BOND_ETF_CANDIDATE',
    name: '채권형 ETF 수혜 (금리 하락 기대)',
    passed: macroEnv.bokRateDirection === 'CUTTING' || macroEnv.bokRateDirection === 'HOLDING',
    category: 'COUNTER_CYCLICAL',
    description: `한국은행 기준금리 ${macroEnv.bokRateDirection} — 금리 하락/동결 구간에서 채권형 ETF 가격 상승 기대.`,
  };

  /** 조건 CC2: 금 ETF — 달러 약세·경기 침체 헤지 */
  const condCC2: BearScreenerCondition = {
    id: 'GOLD_ETF_HEDGE',
    name: '금 ETF 헤지 (KODEX 골드선물 등)',
    passed: true,
    category: 'COUNTER_CYCLICAL',
    description: '경기 침체·지정학적 리스크 확대 시 안전자산 선호로 금 ETF 수혜 증가.',
  };

  /** 조건 CC3: 달러 ETF — USD/KRW 상승 수혜 */
  const condCC3: BearScreenerCondition = {
    id: 'DOLLAR_ETF_SURGE',
    name: '달러 ETF 수혜 (USD/KRW 상승)',
    passed: macroEnv.usdKrw >= 1320,
    category: 'COUNTER_CYCLICAL',
    description: `USD/KRW ${macroEnv.usdKrw.toLocaleString()} — 원화 약세 구간에서 달러 ETF(KODEX 미국달러선물 등) 수혜 발생.`,
  };

  /** 조건 CC4: 음의 시장 상관관계 자산 — 하락 시 반등 패턴 */
  const condCC4: BearScreenerCondition = {
    id: 'NEGATIVE_CORRELATION',
    name: '하락장 역상관 자산',
    passed: true,
    category: 'COUNTER_CYCLICAL',
    description: 'KOSPI 하락 시 반등하는 역상관 자산(인버스 제외)으로 포트폴리오 방어력 강화.',
  };

  // ─── 숏 수혜주 조건 (4개) ───────────────────────────────────────────────────

  /** 조건 VD1: ROE 15% 이상 — 탄탄한 실적 기반 */
  const condVD1: BearScreenerCondition = {
    id: 'ROE_ABOVE_15',
    name: 'ROE 15% 이상 (탄탄한 실적)',
    passed: true,
    category: 'VALUE_DEPRESSED',
    description: '강력한 이익 창출 능력을 증명하는 ROE 15% 이상 종목. 주가 하락은 공매도 과잉, 재진입 기회.',
  };

  /** 조건 VD2: PER 섹터 평균 이하 — 저평가 매력 */
  const condVD2: BearScreenerCondition = {
    id: 'PER_BELOW_SECTOR_AVG',
    name: 'PER 섹터 평균 이하 (저평가)',
    passed: true,
    category: 'VALUE_DEPRESSED',
    description: '섹터 평균 PER 대비 낮은 밸류에이션으로 하락장 방어 여력 및 반등 시 상승폭 확대 기대.',
  };

  /** 조건 VD3: 공매도 잔고 감소 추세 — 숏 커버링 매수 기대 */
  const condVD3: BearScreenerCondition = {
    id: 'SHORT_INTEREST_DECLINING',
    name: '공매도 잔고 감소 (숏 커버링 기대)',
    passed: true,
    category: 'VALUE_DEPRESSED',
    description: '공매도 잔고가 고점 대비 감소 중인 종목은 숏 커버링에 의한 기술적 반등 가능성이 높다.',
  };

  /** 조건 VD4: 52주 고점 대비 30% 이상 하락 + 실적 유지 — 과매도 구간 */
  const condVD4: BearScreenerCondition = {
    id: 'OVERSOLD_FUNDAMENTALS_INTACT',
    name: '과매도 + 실적 유지 (52주 -30% 이상 하락)',
    passed: true,
    category: 'VALUE_DEPRESSED',
    description: '실적은 견조하나 시장 공포로 과도하게 하락한 종목. 공매도 세력의 반대편 포지션 기회.',
  };

  // ─── 변동성 수혜주 조건 (3개) ───────────────────────────────────────────────

  /** 조건 VB1: 보험 섹터 — VKOSPI 상승 시 보험료 인상 기대 */
  const condVB1: BearScreenerCondition = {
    id: 'INSURANCE_SECTOR',
    name: '보험 섹터 (변동성 상승 수혜)',
    passed: macroEnv.vkospi >= 20,
    category: 'VOLATILITY_BENEFICIARY',
    description: `VKOSPI ${macroEnv.vkospi.toFixed(1)} — 변동성 상승 구간에서 보험사 손해율 개선 및 보험료 조정 수혜 기대.`,
  };

  /** 조건 VB2: 금융주 NIM 개선 — 기준금리 유지/인상 수혜 */
  const condVB2: BearScreenerCondition = {
    id: 'FINANCIAL_NIM_IMPROVEMENT',
    name: '금융주 NIM 개선 (금리 유지/인상 구간)',
    passed: macroEnv.bokRateDirection === 'HIKING' || macroEnv.bokRateDirection === 'HOLDING',
    category: 'VOLATILITY_BENEFICIARY',
    description: `BOK 금리 ${macroEnv.bokRateDirection} — 금리 유지/인상 기조에서 은행·금융지주의 순이자마진(NIM) 개선 기대.`,
  };

  /** 조건 VB3: 달러 강세 수혜 수출 방어주 — 환율 헤지 완료 종목 */
  const condVB3: BearScreenerCondition = {
    id: 'DOLLAR_HEDGE_EXPORTER',
    name: '달러 강세 수혜 수출 방어주',
    passed: macroEnv.usdKrw >= 1300 && (macroEnv.dxyBullish === true),
    category: 'VOLATILITY_BENEFICIARY',
    description: `USD/KRW ${macroEnv.usdKrw.toLocaleString()}, DXY 강세 ${macroEnv.dxyBullish ? '확인' : '미확인'} — 환율 수혜를 받는 수출 중심 방어주 탐색.`,
  };

  const allConditions: BearScreenerCondition[] = [
    condD1, condD2, condD3, condD4,
    condCC1, condCC2, condCC3, condCC4,
    condVD1, condVD2, condVD3, condVD4,
    condVB1, condVB2, condVB3,
  ];

  const passedCount = allConditions.filter(c => c.passed).length;

  const categories = {
    defensive: allConditions.filter(c => c.category === 'DEFENSIVE'),
    counterCyclical: allConditions.filter(c => c.category === 'COUNTER_CYCLICAL'),
    valueDepressed: allConditions.filter(c => c.category === 'VALUE_DEPRESSED'),
    volatilityBeneficiary: allConditions.filter(c => c.category === 'VOLATILITY_BENEFICIARY'),
  };

  const searchQueries = [
    '하락장 방어주 음식료 고배당 한국',
    '통신주 유틸리티 배당 저베타 한국',
    `KODEX 골드선물 금 ETF 한국`,
    `달러 ETF KODEX 미국달러선물 ${macroEnv.usdKrw >= 1320 ? '수혜' : '관련'}`,
    '채권 ETF KODEX 국고채 한국',
    '보험주 삼성화재 현대해상 한국',
    '은행주 KB금융 신한지주 NIM 개선',
    `공매도 감소 실적 저평가 종목 한국`,
    '52주 신저가 과매도 ROE 탄탄 종목',
  ];

  const triggerReason = isActive
    ? `Gate -1 Bear Regime 감지 (${bearRegimeResult.triggeredCount}/${bearRegimeResult.threshold} 조건 충족) — 27조건 Bull 스크리너 → 방어형 15조건 Bear Screener 자동 전환`
    : 'Bear Screener 비활성 — Bull/Transition Mode';

  const screeningNote = isActive
    ? '🔴 Bear Mode 활성: 방어주·역주기주·숏 수혜주·변동성 수혜주 4개 카테고리에서 하락 수혜 종목을 자동 탐색합니다. 파생상품 없이 하락장 수익을 추구하는 현실적 접근입니다.'
    : '기본 27조건 Bull 스크리너 활성 — Gate -1이 Bear Regime을 감지하면 자동으로 Bear Screener로 전환됩니다.';

  return {
    isActive,
    triggerReason,
    conditions: allConditions,
    passedCount,
    categories,
    searchQueries,
    screeningNote,
    lastUpdated: now,
  };
}

// ─── 아이디어 6: Bear Mode Kelly Criterion — 하락 베팅에 적용하는 켈리 공식 ──

/** 두 날짜(ISO 문자열) 사이의 거래일(영업일) 수를 계산한다. (토·일 제외)
 * 진입일(from)은 day 0으로 간주하고, from 다음 날부터 카운트를 시작한다.
 * 예: 월요일 진입 → 화요일 end면 1거래일 경과.
 */
function countTradingDaysBetween(from: string, to: string): number {
  const start = new Date(from);
  const end = new Date(to);
  if (end <= start) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1); // 진입일(day 0) 제외, 다음 날부터 카운트
  while (cursor <= end) {
    const day = cursor.getDay(); // 0=일, 6=토
    if (day !== 0 && day !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Bear Mode Kelly Criterion — 인버스 ETF에 대한 최적 포지션 비중 자동 계산.
 *
 * Bear Kelly = (p × b - q) / b
 *   p = Bear 신호 합치 확률 (Gate -1 충족도로 추정)
 *   b = 기대 수익률 배수 (인버스 2X ETF ≈ 1.8)
 *   q = 1 - p
 *
 * 인버스 ETF는 시간가치 손실(음의 롤링 비용)이 있으므로
 * 최대 보유 기간을 30거래일로 제한하는 Time-Stop 로직을 포함한다.
 *
 * @param bearRegimeResult Gate -1 Bear Regime 평가 결과
 * @param entryDate 포지션 진입일 (ISO 날짜 문자열, null이면 미진입)
 */
export function evaluateBearKelly(
  bearRegimeResult: BearRegimeResult,
  entryDate: string | null = null,
  inverseEntryWeightPct: number = 0,
): BearKellyResult {
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  const MAX_HOLDING_DAYS = 30;
  // 인버스 2X ETF 기대 수익률 배수 (실전 슬리피지·롤링 비용 감안 1.8)
  const B = 1.8;

  const isActive = bearRegimeResult.regime === 'BEAR';

  // rawP = 충족 조건 수 / 전체 조건 수 (Gate -1 기준, 경계 없는 원시 확률)
  const rawP = bearRegimeResult.conditions.length > 0
    ? bearRegimeResult.triggeredCount / bearRegimeResult.conditions.length
    : 0;
  // p = Bear Mode 활성 시 rawP에 0.5 하한 적용 (최소한의 Bear 신뢰도 보장);
  // Bear Mode가 아닐 때는 0으로 처리
  const weightedP = rawP * (1 + Math.max(0, inverseEntryWeightPct) / 100);
  const p = isActive ? Math.max(0.5, Math.min(weightedP, 1.0)) : 0;
  const q = 1 - p;

  // Bear Kelly 공식: (p × b - q) / b
  const rawKellyFraction = p > 0 ? Math.max(0, (p * B - q) / B) : 0;

  // 전체 켈리 포지션 (%) — 최대 30% 상한 (인버스 ETF 레버리지 위험 감안)
  const kellyPct = Math.min(rawKellyFraction * 100, 30);

  // 반 켈리 — 실전 권고 (시간가치 손실·슬리피지 보정)
  const halfKellyPct = kellyPct / 2;

  // Time-Stop 계산
  let tradingDaysElapsed = 0;
  let tradingDaysRemaining = MAX_HOLDING_DAYS;
  let timeStopTriggered = false;

  if (entryDate) {
    tradingDaysElapsed = countTradingDaysBetween(entryDate, today);
    tradingDaysRemaining = Math.max(0, MAX_HOLDING_DAYS - tradingDaysElapsed);
    timeStopTriggered = tradingDaysElapsed >= MAX_HOLDING_DAYS;
  }

  const timeStopAlert = timeStopTriggered
    ? `⚠️ Time-Stop 발동 — 진입일(${entryDate})로부터 30거래일 경과. 인버스 ETF 즉시 청산 권고. 시간가치 손실 누적으로 추가 보유 시 음(-)의 기대수익.`
    : entryDate
      ? `⏱ 잔여 ${tradingDaysRemaining}거래일 (${tradingDaysElapsed}/${MAX_HOLDING_DAYS}일 경과) — Time-Stop 30거래일 내 포지션 청산 권고.`
      : '포지션 진입 후 Time-Stop이 자동 카운트다운됩니다. 30거래일 도달 시 자동 청산 알림이 발송됩니다.';

  const formulaNote = `Bear Kelly = (p × b − q) / b = (${p.toFixed(2)} × ${B} − ${q.toFixed(2)}) / ${B} = ${rawKellyFraction.toFixed(3)} → 전체켈리 ${kellyPct.toFixed(1)}% / 반켈리 ${halfKellyPct.toFixed(1)}%`;

  let actionMessage: string;
  if (!isActive) {
    actionMessage = '🟢 Bear Regime 비활성 — Bear Kelly 포지션 없음. Gate -1이 Bear Mode를 감지하면 켈리 공식이 자동 계산됩니다.';
  } else if (timeStopTriggered) {
    actionMessage = `🔴 Time-Stop 발동 — 인버스 ETF 즉시 청산. Bear Kelly: 반켈리 ${halfKellyPct.toFixed(1)}% (전체켈리 ${kellyPct.toFixed(1)}%)`;
  } else if (kellyPct < 5) {
    actionMessage = `🟡 Bear 신호 약함 — 켈리 포지션 ${halfKellyPct.toFixed(1)}% (반켈리). 조건 추가 충족 확인 후 진입 권고.`;
  } else {
    actionMessage = `🔴 Bear Kelly 활성 — 인버스 ETF 권장 비중 ${halfKellyPct.toFixed(1)}% (반켈리). 최대 30거래일 보유, Time-Stop 엄수.`;
  }

  return {
    isActive,
    p,
    b: B,
    q,
    rawKellyFraction,
    kellyPct,
    halfKellyPct,
    maxHoldingDays: MAX_HOLDING_DAYS,
    entryDate,
    tradingDaysElapsed,
    tradingDaysRemaining,
    timeStopTriggered,
    timeStopAlert,
    formulaNote,
    actionMessage,
    lastUpdated: now,
  };
}

// ─── 아이디어 8: Bear Mode 손익 시뮬레이터 ─────────────────────────────────────

/** KODEX 인버스 2X ETF 실효 배율 (슬리피지·롤링 비용 반영) */
const BEAR_SIM_INVERSE_2X_MULTIPLIER = 1.8;

/** Bear Mode 시뮬레이터에서 사용할 기본 인버스 ETF 명칭 */
const BEAR_SIM_ETF_NAME = 'KODEX 인버스 2X (122630)';

/** Gate -1 감지 후 Bear Mode 전환까지 대기하는 거래일 수 (D+3) */
const BEAR_SIM_SWITCH_DELAY_DAYS = 3;

/**
 * Gate -1 감지일로부터 지정된 거래일 수만큼 뒤의 날짜를 계산한다.
 * 토·일은 거래일에서 제외한다.
 * 참고: 한국 공휴일은 별도 처리하지 않으며, 실제 D+3 전환일은 공휴일 여부에 따라
 * 하루 이상 차이가 날 수 있다 (시뮬레이션 추정치로 사용).
 */
function addTradingDays(fromDateStr: string, days: number): string {
  const date = new Date(fromDateStr);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return date.toISOString().split('T')[0];
}

/**
 * 아이디어 8: Bear Mode 손익 시뮬레이터
 *
 * 사용자가 입력한 Bear 구간 시나리오를 기반으로 다음을 계산한다:
 *   1. 롱 포트폴리오가 Bear 구간에서 기록한 실제 수익률 (사용자 입력)
 *   2. Gate -1이 Bear를 감지한 D+3에 KODEX 인버스 2X로 전환했을 경우 시뮬레이션 수익률
 *   3. 두 수익률의 알파 차이 (%p)
 *
 * Bear Mode 수익 추정:
 *   bearModeReturn = -1 × marketReturn × INVERSE_2X_MULTIPLIER (1.8)
 *
 * @param inputs 사용자가 입력한 Bear 구간 시나리오 목록
 */
export function evaluateBearModeSimulator(
  inputs: BearModeSimulatorInput[],
): BearModeSimulatorResult {
  const now = new Date().toISOString();

  const scenarios: BearModeSimulatorScenarioResult[] = inputs.map(input => {
    const switchDate = addTradingDays(input.gateDetectionDate, BEAR_SIM_SWITCH_DELAY_DAYS);

    // Bear Mode 수익률: 시장 하락 × 인버스 2X 배율 (시장이 하락하면 양의 수익)
    const bearModeReturn = parseFloat(
      (-input.marketReturn * BEAR_SIM_INVERSE_2X_MULTIPLIER).toFixed(2),
    );
    const longReturn = input.longPortfolioReturn;
    const alphaDifference = parseFloat((bearModeReturn - longReturn).toFixed(2));

    let recommendation: string;
    if (alphaDifference > 20) {
      recommendation = `🔴 강력한 전환 신호 — Bear Mode 전환 시 ${alphaDifference.toFixed(1)}%p 알파 획득 가능. 다음 Gate -1 감지 시 D+3 즉시 전환 권고.`;
    } else if (alphaDifference > 0) {
      recommendation = `🟡 유의미한 알파 — ${alphaDifference.toFixed(1)}%p 개선. 시스템 신호를 따르는 것이 직관 대비 유리.`;
    } else {
      recommendation = `🟢 Bear Mode 전환 효과 미미 — 해당 구간에서는 롱 포트폴리오가 Bear Mode 대비 우위.`;
    }

    return {
      label: input.label,
      bearStartDate: input.bearStartDate,
      bearEndDate: input.bearEndDate,
      switchDate,
      switchDayOffset: BEAR_SIM_SWITCH_DELAY_DAYS,
      longReturn,
      bearModeReturn,
      alphaDifference,
      inverseEtfName: BEAR_SIM_ETF_NAME,
      recommendation,
    };
  });

  // 최고 알파 시나리오: 동일 알파 시 먼저 나온 시나리오(낮은 인덱스) 선택
  const bestScenario = scenarios.length > 0
    ? [...scenarios].sort((a, b) => b.alphaDifference - a.alphaDifference)[0]
    : null;

  let conclusionMessage: string;
  if (scenarios.length === 0) {
    conclusionMessage = '🟢 시나리오 없음 — Bear 구간 데이터를 입력하면 손익 시뮬레이션이 자동 계산됩니다.';
  } else if (bestScenario && bestScenario.alphaDifference > 0) {
    conclusionMessage = `📊 시스템 신호를 따랐다면 최대 +${bestScenario.alphaDifference.toFixed(1)}%p 알파 획득 가능 (${bestScenario.label}). 데이터가 말했고, 그걸 따랐다면 이만큼 벌었다.`;
  } else {
    conclusionMessage = '📊 시뮬레이션 완료 — 입력된 시나리오에서는 Bear Mode 전환 효과가 제한적입니다.';
  }

  return {
    scenarios,
    bestScenario,
    conclusionMessage,
    lastUpdated: now,
  };
}
