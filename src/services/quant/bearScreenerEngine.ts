/**
 * bearScreenerEngine.ts — 아이디어 3: Bear Regime 전용 종목 발굴
 *
 * Gate -1이 Bear Regime을 감지하면 자동 활성화되는 Bear Screener.
 * 기존 27조건 대신 방어형 15조건으로 종목을 재스크리닝한다.
 */

import type {
  MacroEnvironment,
  BearRegimeResult,
  BearScreenerResult,
  BearScreenerCondition,
} from '../../types/quant';

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
