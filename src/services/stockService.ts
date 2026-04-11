import { AI_MODELS } from "../constants/aiConfig";
import { getAI, aiCache, lsGet, lsSet, getCachedAIResponse, withRetry, safeJsonParse } from './stock/aiClient';
import { enrichStockWithRealData } from './stock/enrichment';
import { fetchMarketIndicators } from './stock/marketOverview';
import {
  BacktestResult,
  BacktestPosition,
  BacktestPortfolioState,
  BacktestDailyLog,
  Portfolio,
  EconomicRegimeData,
  SmartMoneyData,
  ExportMomentumData,
  GeopoliticalRiskData,
  CreditSpreadData,
  MacroEnvironment,
  QuantScreenResult,
  DartScreenerResult,
  SilentAccumulationResult,
  ExtendedRegimeData,
  ThemeReverseTrackResult,
  NewsFrequencyScore,
  GlobalMultiSourceData,
  GlobalCorrelationMatrix,
  SupplyChainIntelligence,
  SectorOrderIntelligence,
  FinancialStressIndex,
  FomcSentimentAnalysis,
} from "../types/quant";

import { getMacroSnapshot, snapshotToMacroFields, getTradeData } from './ecosService';
import { fetchKisSupply, fetchKisShortSelling } from './stock/kisDataFetcher';
import { fetchCorpCode, fetchDartFinancials } from './stock/dartDataFetcher';

import {
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateStochastic,
  calculateIchimoku,
  detectVCP,
  calculateDisparity
} from "../utils/indicators";

export type { 
  BacktestResult,
  BacktestPosition,
  BacktestPortfolioState,
  BacktestDailyLog,
  Portfolio
};

export {
  type WalkForwardAnalysis,
  type NewsArticle,
  type ChartPattern,
  type StockRecommendation,
  type AdvancedAnalysisResult,
  type MarketDataPoint,
  type SnsSentiment,
  type EuphoriaSignal,
  type GlobalEtfMonitoring,
  type MarketOverview,
  type MarketContext,
  type MarketPhaseLog,
  type RecommendationResponse,
  type StockFilters,
} from './stock/types';

import type {
  StockRecommendation,
  StockFilters,
  RecommendationResponse,
  AdvancedAnalysisResult,
  MarketOverview,
  MarketContext,
  MarketPhaseLog,
  MarketDataPoint,
  WalkForwardAnalysis,
} from './stock/types';
// ─── Step 4–7 추출 모듈 re-export ──────────────────────────────────────────
export { fetchHistoricalData, backtestPortfolio, runAdvancedAnalysis, performWalkForwardAnalysis } from './stock/historicalData';
export { calculateTranchePlan, enrichStockWithRealData } from './stock/enrichment';
export { fetchCurrentPrice, syncStockPrice, syncStockPriceKIS } from './stock/priceSync';
export { clearSearchCache, searchStock } from './stock/stockSearch';
export { parsePortfolioFile, generateReportSummary } from './stock/reportUtils';
export { syncMarketOverviewIndices, getMarketOverview } from './stock/marketOverview';



export async function getStockRecommendations(filters?: StockFilters): Promise<RecommendationResponse | null> {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const mode = filters?.mode || 'MOMENTUM';

  // ── QUANT_SCREEN 모드: 정량 스크리닝 → DART 공시 → 조용한 매집 파이프라인 ──
  if (mode === 'QUANT_SCREEN') {
    return runQuantScreenPipeline(filters);
  }

  // ── BEAR_SCREEN 모드: Bear Regime 전용 하락 수혜주 탐색 ──────────────────────
  if (mode === 'BEAR_SCREEN') {
    return getBearScreenerRecommendations(filters);
  }

  // ── 사전 수집 실데이터: Yahoo + ECOS 캐시 → Search 횟수 절감 ──
  const [yahooCached] = await Promise.allSettled([fetchMarketIndicators()]);
  const yahoo = yahooCached.status === 'fulfilled' ? yahooCached.value : null;
  const macroCached = lsGet(`macro-environment-${todayDate}`)?.data as Record<string, unknown> | undefined;
  const cachedVkospi     = yahoo?.vkospi     ?? null;
  const cachedUs10y      = yahoo?.us10yYield ?? null;
  const cachedUsdKrw     = (macroCached?.usdKrw as number | undefined) ?? null;
  const preFilledBlock = [
    cachedVkospi  !== null ? `- VKOSPI: ${cachedVkospi.toFixed(2)} (Yahoo Finance 실데이터, 검색 불필요)` : '',
    cachedUs10y   !== null ? `- 미국 10년물 국채 금리: ${cachedUs10y.toFixed(2)}% (Yahoo ^TNX 실데이터, 검색 불필요)` : '',
    cachedUsdKrw  !== null ? `- USD/KRW 환율: ${cachedUsdKrw.toFixed(0)}원 (ECOS 실데이터, 검색 불필요)` : '',
  ].filter(Boolean).join('\n');

  const filterPrompt = filters ? `
      [사용자 정의 정량 필터]
      - ROE > ${filters.minRoe || 0}%
      - PER < ${filters.maxPer || 999}
      - 부채비율 < ${filters.maxDebtRatio || 999}%
      - 시가총액 > ${filters.minMarketCap || 0}억
      이 조건을 만족하는 종목들 중에서만 추천하라.
  ` : '';

  const momentumSearchQueries = [
    `오늘(${todayDate})의 코스피 지수`,
    `오늘의 코스닥 지수`,
    `코스피 200일 이동평균선(200MA)`,
    // VKOSPI·글로벌 지수는 Yahoo/ECOS 실데이터로 사전 수집 → Search 불필요
    `오늘의 한국 주도주`,
    `기관 대량 매수 종목 한국`,
    `외국인 순매수 상위 종목 한국`
  ];

  const earlyDetectSearchQueries = [
    `거래량 급감 횡보 종목 한국`,
    `52주 신고가 5% 이내 근접 종목 한국`,
    `기관 연속 소량 매수 종목 한국`,
    `볼린저밴드 수축 최저 종목 한국`,
    `VCP 패턴 종목 한국`,
    `섹터 대장주 신고가 경신 후 2등주`,
    `KODEX 조선 ETF 자금 유입`,
    `PLUS 방산 ETF 자금 유입`,
    `섹터 ETF 순자산 증가 종목`
  ];

  const searchQueries = mode === 'EARLY_DETECT' ? earlyDetectSearchQueries : momentumSearchQueries;

  const modePrompt = mode === 'EARLY_DETECT' ? `
      [선행 신호 우선 탐색 - 급등 전 종목 포착 모드]
      다음 조건을 모두 또는 대부분 충족하는 종목을 최우선으로 선정하라:
      1. 주가 상승률: 최근 1개월 기준 KOSPI/KOSDAQ 대비 아웃퍼폼하되, 단기(5일) 상승률은 3% 미만인 종목 (이미 급등한 종목 제외)
      2. 거래량 조건: 최근 3~5일 거래량이 20일 평균의 50% 이하로 마른 상태 (매도 물량 소진 신호, VCP 패턴)
      3. 기술적 위치: 52주 신고가 대비 -5% 이내 근접, 볼린저밴드 폭(BBWidth)이 최근 3개월 내 최저 수준, 주가가 주요 이평선(20일, 60일) 위에서 횡보 중
      4. 수급 조건: 기관이 최근 3~7일간 조용히 소량 순매수 중, 외국인 매수는 아직 본격화되지 않은 상태
      5. 섹터 조건: 해당 섹터 대장주가 이미 신고가를 경신했으나, 해당 종목은 아직 대장주 대비 상승률이 30% 이상 뒤처진 상태
      
      위 조건을 충족할수록 높은 confidenceScore를 부여하고, 이미 단기 급등(5일 기준 +15% 이상)한 종목은 추천에서 제외하라.
  ` : `
      [모멘텀 추종 - 현재 주도주 포착 모드]
      현재 시장에서 가장 강력한 상승 모멘텀을 가진 주도주를 선정하라.
      기관과 외국인의 동반 대량 매수가 확인되고, 신고가를 경신하며 추세가 강화되는 종목을 우선한다.
  `;

  const prompt = `
      [절대 원칙: 실시간성 보장 및 과거 데이터 배제]
      현재 한국 시각은 ${now}입니다. (오늘 날짜: ${todayDate})
      추천 모드: ${mode === 'EARLY_DETECT' ? '미리 볼 종목 (Early Detect)' : '지금 살 종목 (Momentum)'}

      [사전 수집 실데이터 — 이 항목들은 검색 없이 바로 사용하라]
${preFilledBlock || '      (사전 수집 데이터 없음 — 필요 시 검색)'}

      ${filterPrompt}
      ${modePrompt}
      당신은 반드시 'googleSearch' 도구를 사용하여 '현재 시점의 실시간 데이터'만을 기반으로 응답해야 합니다.
      특히 해외 지수(나스닥, S&P 500 등)는 반드시 현재 시점의 실시간 또는 가장 최근 종가를 반영해야 합니다.
      과거의 훈련 데이터, 예시 데이터, 혹은 이전에 생성했던 데이터를 재사용하는 것은 엄격히 금지됩니다.
      조회 시 항상 현재(${now})를 기준으로 하는 조건을 강력하게 부여합니다.

      [중요 알림: 기술적 지표 실계산 시스템 도입]
      현재 시스템은 Yahoo Finance의 OHLCV 데이터를 기반으로 RSI, MACD, Bollinger Bands, VCP 패턴 등을 코드로 직접 계산합니다.
      따라서 당신은 이러한 수치를 '추정'할 필요가 없습니다. 대신, 검색을 통해 얻은 '현재가'와 '거래량' 데이터를 정확히 반영하고,
      이러한 지표들이 가리키는 '의미'와 '투자 전략'에 집중하여 분석을 수행하십시오.
      당신이 생성한 JSON 데이터는 이후 실시간 데이터로 'Enrichment(강화)' 과정을 거치게 됩니다.
      
      [필수 검색 단계 - 실시간 데이터 확보]
      1. 다음 쿼리들을 검색하여 시장 상황을 파악하라: ${searchQueries.join(', ')}
      2. 현재 시장 상황(BULL, BEAR, SIDEWAYS 등)에 가장 적합한 종목 3~5개를 선정하라.
      3. 선정된 각 종목에 대해 다음 정보를 'googleSearch'로 검색하라:
         - '네이버 증권 [종목명]' (현재가 및 시가총액 확인용)
         - '${todayDate} [종목명] 실시간 주가'
         - 'KRX:[종목코드] 주가'
      4. **[초정밀 가격 검증 및 시가총액 대조]**
         - 검색 결과에서 반드시 오늘(${todayDate}) 날짜와 현재 시각이 포함된 최신 가격 정보를 선택하라.
         - **[필수]** 해당 종목의 시가총액을 확인하여 [현재가 * 발행주식수 = 시가총액] 공식이 맞는지 검증하라. 자릿수 오류를 절대적으로 방지하라.
         - 여러 검색 결과(네이버 증권, 다음 금융, 구글 파이낸스 등)를 비교하여 가장 신뢰할 수 있는 데이터를 채택하라.
      5. **[DART corpCode 확보]** 각 종목에 대해 'DART 고유번호(corpCode, 8자리)'를 반드시 검색하여 'corpCode' 필드에 포함하라. 이는 이후 실시간 재무 데이터 연동에 필수적이다.
      6. **[차트 패턴 분석]** 각 종목의 최근 주가 흐름을 분석하여 다음 패턴 중 하나 이상이 발견되는지 확인하라:
         - 상승 패턴: 상승삼각형, 상승플래그, 상승패넌트, 컵 앤 핸들, 삼각수렴
         - 상승 반전: 쌍바닥(Double Bottom), 3중바닥, 하락쐐기, 역 헤드 앤 숄더(Inverse H&S), 라운드 바텀
         - 하락 패턴: 하락삼각형, 하락플래그, 하락패넌트, 상승쐐기
         - 하락 반전: 브로드닝 탑, 더블 탑(쌍봉), 트리플 탑, 헤드 앤 숄더(H&S), 라운드 탑, 다이아몬드 탑
      7. **[뉴스 데이터 확보]** 각 종목에 대해 가장 최근의 뉴스 기사 3개를 찾아 'latestNews' 필드에 [헤드라인, 날짜, URL] 형식으로 포함하라.
      7. **[판단 기준 - STRONG_BUY, BUY, STRONG_SELL, SELL]**
         - ${mode === 'EARLY_DETECT' ? 'EARLY_DETECT 모드에서는 거래량 마름과 횡보 후 돌파 직전 신호를 가장 높게 평가하라.' : 'MOMENTUM 모드에서는 강력한 수급과 추세 강도를 가장 높게 평가하라.'}
         [BUY/STRONG_BUY 발동 전 필수 선결 조건 - 하나라도 미충족 시 즉시 HOLD]
        ① Gate 1 전부 통과 필수: cycleVerified, roeType3, riskOnEnvironment, mechanicalStop, notPreviousLeader 중 하나라도 False이면 HOLD.
        ② RRR 최소 기준 필수: BUY 2.0 이상, STRONG_BUY 3.0 이상. 미충족 시 HOLD.
        ③ 일목균형표 구름대 위치 필수: ichimokuStatus가 ABOVE_CLOUD 상태여야만 BUY 허용.
        ④ 다이버전스 부재 필수: divergenceCheck가 False이면 STRONG_BUY 발동 금지 (BUY로 강등).

        [BUY 수치 임계값 — 반드시 모두 충족]
        - 기술적 조건: RSI 40~70, 이격도(20일) 97~105%, 볼린저밴드 LOWER_TOUCH 또는 CENTER_REVERSION, MACD 히스토그램 전환/확대 중.
        - 수급 조건: 외인+기관 동반 순매수(BUY 3일, STRONG_BUY 5일), 거래량 20일 평균 150% 이상.
        - 펀더멘털 조건: OCF > 당기순이익, 부채비율 100% 미만, 이자보상배율 3배 초과.
        - 시장 환경 조건: VKOSPI 25 미만, BEAR/RISK_OFF 시 STRONG_BUY 금지 및 BUY 비중 축소.

         - **STRONG_BUY**: 압도적인 상승 모멘텀(RS 상위 5% 이내), 주도주 사이클 초입(신고가 경신), 기관/외인 5거래일 연속 순매수 필수, 모든 기술적 지표가 완벽한 정배열 및 상향 돌파를 가리키며, 27개 체크리스트 중 25개 이상을 만족하는 경우.
         - **BUY**: 명확한 상승 추세, 주도 섹터 1~2순위 부합, 안정적인 수급 유입(최근 5일 중 3일 이상 순매수), 주요 지지선에서의 반등이 확인되었으며, 27개 체크리스트 중 22개 이상을 만족하는 경우.
         - **STRONG_SELL**: 추세 붕괴, 재료 소멸, 극심한 고평가, 대규모 수급 이탈이 명확하며 하락 압력이 매우 강한 경우.
         - **SELL**: 추세 약화, 모멘텀 둔화, 수급 이탈 조짐, 기술적 저항에 부딪힌 경우.
      8. **[엄격한 평가 원칙]** 단순히 '좋아 보인다'는 이유로 BUY를 주지 마라. 위 기준을 '보수적'으로 적용하여 데이터가 확실할 때만 긍정적 의견을 제시하라.
      9. **[초정밀 검증]** 검색 결과에서 반드시 오늘(${todayDate}) 날짜와 현재 시각이 포함된 최신 가격 정보를 선택하라. 
         - **[시가총액 교차 검증 필수]** 모든 추천 종목의 가격은 반드시 시가총액과 대조하여 자릿수 오류가 없는지 확인하라. (예: 100만원대 종목을 30만원대로 기재하는 오류 절대 금지)
         - 여러 검색 결과(네이버 증권, 다음 금융, 야후 파이낸스 등)를 비교하여 가장 최신의 데이터를 채택하라. 며칠 전 데이터는 절대 사용하지 마라.
      10. **[트레이딩 전략 수립]** 각 종목에 대해 현재가 기준 최적의 '진입가(entryPrice)', '손절가(stopLoss)', '1차 목표가(targetPrice)', '2차 목표가(targetPrice2)'를 기술적 분석(지지/저항, 피보나치 등)을 통해 산출하라.
      11. **[데이터 출처 명시]** 'dataSource' 필드에 어떤 사이트에서 몇 시에 데이터를 가져왔는지 명시하라.
      12. **[글로벌 ETF 모니터링]** 'googleSearch'를 사용하여 KODEX 200(069500), TIGER 미국S&P500(360750), KODEX 레버리지(122630), TIGER 차이나전기차SOLACTIVE(371460) 등 주요 ETF의 현재가, 등락률, 자금 유입/유출 현황을 검색하여 'globalEtfMonitoring' 필드에 반영하라. 각 항목에 반드시 symbol(종목코드), name(ETF명), price(현재가 숫자), change(등락률 숫자 %), flow("INFLOW" 또는 "OUTFLOW"), implication(한글 설명) 필드를 모두 포함하라.
      12-1. **[환율/국채 데이터]** 프롬프트 상단 '사전 수집 실데이터'에서 USD/KRW 환율과 10년물 금리를 그대로 사용하라. 사전 수집값이 없는 경우에만 'googleSearch'로 검색하라. 각각 'exchangeRate': { "value": 환율숫자, "change": 0 }, 'bondYield': { "value": 금리숫자, "change": 0 } 형식으로 채워라.
      13. **[장세 전환 감지]** 현재 시장의 주도 섹터가 바뀌고 있는지(Regime Shift)를 판단하여 'regimeShiftDetector' 필드에 반영하라.
      14. **[다중 시계열 분석]** 월봉, 주봉, 일봉의 추세가 일치하는지 확인하여 'multiTimeframe' 필드에 반영하라.
      15. **[눌림목 성격 판단 (Pullback Analysis)]** 주가가 조정(눌림목)을 받을 때 거래량이 감소하는지(건전한 조정) 또는 증가하는지(매도 압력)를 반드시 확인하여 'technicalSignals'의 'volumeSurge' 및 'reason' 필드에 반영하라. 거래량이 줄어들며 지지받는 눌림목을 최우선으로 추천하라.
      16. **[섹터 대장주 선행 확인]** 해당 종목이 속한 섹터의 대장주(Leading Stock)가 최근 5거래일 이내에 신고가를 경신했는지 확인하라. 대장주가 먼저 길을 열어준 종목에 대해 'isLeadingSector' 및 'gate' 평가 시 가산점을 부여하라.
      17. **[AI 공시 감성 분석]** 'googleSearch'를 사용하여 해당 종목의 최근 DART 공시(실적, 수주, 증자 등)를 분석하여 'disclosureSentiment'에 반영하라.
      18. **[공매도/대차잔고 분석]** 'googleSearch'를 사용하여 해당 종목의 공매도 비율(Short Selling Ratio)과 대차잔고 추이를 분석하여 'shortSelling' 필드에 반영하라. 특히 공매도 급감에 따른 숏 커버링 가능성을 체크하라.
      19. **[텐배거 DNA 패턴 매칭]** 다음 과거 대장주들의 급등 직전 DNA와 현재 종목을 비교하여 'tenbaggerDNA' 필드에 유사도(similarity, 0-100)와 매칭 패턴명, 이유를 기술하라.
          - **에코프로(2023)**: RSI 45-55(과열 전), 거래량 마름(VCP), 대장주 신고가 선행, ROE 유형 3, 전 사이클 비주도주.
          - **씨젠(2020)**: 폭발적 실적 가속도(OPM 급증), 강력한 외부 촉매제(팬데믹), 이평선 정배열 초입.
          - **HD현대중공업(2024)**: 장기 바닥권 탈출, 섹터 전체 수주 잔고 폭증, 기관/외인 역대급 쌍끌이 매수.
      20. **[적의 체크리스트 (Enemy's Checklist)]** 해당 종목의 하락 시나리오(Bear Case), 주요 리스크 요인, 그리고 매수 논거에 대한 반박(Counter Arguments)을 분석하여 'enemyChecklist' 필드에 반영하라.
      21. **[계절성 레이어 (Seasonality Layer)]** 현재 월(${todayDate.split('-')[1]}월)의 해당 종목 또는 섹터의 역사적 수익률, 승률, 성수기 여부를 분석하여 'seasonality' 필드에 반영하라.
      22. **[수익률 귀인 분석 (Attribution Analysis)]** 해당 종목의 추천 강도를 섹터 기여도, 모멘텀 기여도, 밸류 기여도, 그리고 알파(개별 종목 특성)로 세분화하여 'attribution' 필드에 반영하라.
      23. **[8시간 비동기 해소 (Timezone Sync)]** 한국 시장(KST)과 미국 시장(EST)의 시차를 고려하여, 미국 지수는 전일 종가가 아닌 '현재 실시간 선물 지수' 또는 '가장 최근 마감 지수'를 정확히 구분하여 반영하라.
      24. **[3-Gate Triage 분류]** 각 종목을 다음 기준에 따라 Gate 1, 2, 3으로 분류하라:
          - **Gate 1 (Survival Filter)**: 주도주 사이클, ROE 유형 3, 시장 환경 Risk-On, 기계적 손절 설정, 신규 주도주 여부 등 5대 생존 조건 충족 여부. (최소 조건)
          - **Gate 2 (Growth Verification)**: 수급 질, 일목균형표, 경제적 해자, 기술적 정배열, 거래량, 기관/외인 수급, 목표가 여력, 실적 서프라이즈, 실체적 펀더멘털, 정책/매크로, 이익의 질 OCF, 상대강도 RS 등 12개 항목 중 9개 이상 충족.
          - **Gate 3 (Precision Timing)**: 심리적 객관성, 터틀 돌파, 피보나치, 엘리엇 파동, 마크 미너비니 VCP, 변동성 축적 등 10개 정밀 타이밍 조건 분석.
          - 가장 높은 단계를 'gate' 필드(1, 2, 3)에 숫자로 기록하라.

      [AI 기반 동적 가중치 (Dynamic Weighting) 적용]
      현재 판단된 장세(BULL, BEAR, SIDEWAYS, TRANSITION)에 따라 27개 체크리스트 항목의 배점을 정밀 조절하여 'Confidence Score'를 계산하라.
      - 약세장(BEAR/RISK_OFF)일수록 재무방어력과 이익의 질에 높은 가중치를 두어라.
      - 강세장(BULL/RISK_ON)일수록 모멘텀과 기술적 돌파에 높은 가중치를 두어라.

      [시장 상황에 따른 추천 전략]
      1. 시황이 좋지 않은 경우(BEAR, VKOSPI 25 이상 등)에는 종목 추천을 최소화(0~3개)하라. 
      2. 시황이 극도로 악화된 경우 "현재는 현금 비중 확대 및 관망이 필요한 시점입니다"라는 메시지와 함께 추천 종목을 반드시 빈 배열([])로 반환하라.
      3. 추천 종목이 있다면 최대 5개까지만 추천하여 응답의 완성도를 높여라.
      4. **[필수]** 'reason' 필드는 해당 종목의 점수나 등급에 가장 큰 영향을 미친 구체적인 기술적 지표나 펀더멘털 요인을 반드시 포함하여 2~3문장으로 핵심만 상세히 작성하라.
      5. **[필수]** 'sectorAnalysis' 필드는 해당 종목이 속한 산업 섹터에 대한 AI 분석을 제공하라. 다음 내용을 반드시 포함해야 한다:
         - sectorName: 산업 명칭
         - currentTrends: 주요 트렌드 2~3가지
         - leadingStocks: 주도 상위 3개 종목 (종목명, 코드, 시가총액)
         - catalysts: 주가 견인 촉매제 2~3가지
         - riskFactors: 리스크 요인 2~3가지
      6. 각 필드의 설명(description 등)은 핵심 위주로 매우 간결하게 작성하라.
      7. 불필요한 수식어나 중복된 정보는 배제하라.
      8. 반드시 유효한 JSON 형식으로 닫는 중괄호까지 완벽하게 작성하라.
      9. 종목은 최대 5개까지만 추천하라.

    응답은 반드시 다음 JSON 형식으로만 하며, 절대 중간에 끊기지 않도록 끝까지 완성하라:
    {
      "marketContext": {
        "kospi": { "index": 0, "change": 0, "changePercent": 0, "status": "NEUTRAL", "analysis": "...", "ma200": 2650.5 },
        "kosdaq": { "index": 0, "change": 0, "changePercent": 0, "status": "NEUTRAL", "analysis": "..." },
        "globalIndices": { "nasdaq": { "index": 0, "changePercent": 0 }, "snp500": { "index": 0, "changePercent": 0 }, "dow": { "index": 0, "changePercent": 0 }, "sox": { "index": 0, "changePercent": 0 } },
        "globalMacro": { "us10yYield": 0, "brentOil": 0, "gold": 0, "dollarIndex": 0 },
        "fearAndGreed": { "value": 0, "status": "..." },
        "iri": 0, "vkospi": 0, 
        "globalEtfMonitoring": [
          { "symbol": "069500", "name": "KODEX 200", "price": 35000, "change": 0.8, "flow": "INFLOW", "implication": "외국인 순매수 유입" },
          { "symbol": "360750", "name": "TIGER 미국S&P500", "price": 18500, "change": -0.3, "flow": "OUTFLOW", "implication": "미국 증시 조정 반영" }
        ],
        "regimeShiftDetector": {
          "currentRegime": "...",
          "nextRegimeProbability": 0,
          "leadingIndicator": "..."
        },
        "volumeTrend": "STABLE",
        "exchangeRate": { "value": 0, "change": 0 },
        "bondYield": { "value": 0, "change": 0 },
        "overallSentiment": "...",
        "marketPhase": "BULL",
        "activeStrategy": "...",
        "dataSource": "..."
      },
      "recommendations": [
        {
          "name": "종목명", "code": "종목코드", "corpCode": "00123456", "reason": "...", "type": "STRONG_BUY/BUY/STRONG_SELL/SELL", "gate": 3, "patterns": ["..."], "hotness": 9, "roeType": "...",
          "//gate_guide": "1: Survival, 2: Growth, 3: Timing 중 해당 종목이 도달한 가장 높은 단계를 숫자로 입력하라.",
          "isLeadingSector": true, "isSectorTopPick": true, "momentumRank": 1, "confidenceScore": 85,
          "supplyQuality": { "passive": true, "active": true }, "peakPrice": 0, "currentPrice": 0, "priceUpdatedAt": "...", "dataSource": "...",
          "isPreviousLeader": false, "ichimokuStatus": "ABOVE_CLOUD", "relatedSectors": ["..."],
          "valuation": { "per": 0, "pbr": 0, "epsGrowth": 0, "debtRatio": 0 },
          "technicalSignals": { 
            "maAlignment": "BULLISH", "rsi": 0, "macdStatus": "GOLDEN_CROSS", "bollingerStatus": "NEUTRAL", "stochasticStatus": "NEUTRAL", "volumeSurge": true, "disparity20": 0, "macdHistogram": 0, "bbWidth": 0, "stochRsi": 0,
            "macdHistogramDetail": { "status": "BULLISH", "implication": "..." },
            "bbWidthDetail": { "status": "SQUEEZE", "implication": "..." },
            "stochRsiDetail": { "status": "OVERSOLD", "implication": "..." }
          },
          "economicMoat": { "type": "BRAND", "description": "..." },
          "scores": { "value": 0, "momentum": 0 },
          "shortSelling": { "ratio": 0, "trend": "DECREASING", "implication": "..." },
          "tenbaggerDNA": { "similarity": 0, "matchPattern": "에코프로2023", "reason": "..." },
          "checklist": { "cycleVerified": true, "momentumRanking": true, "roeType3": true, "supplyInflow": true, "riskOnEnvironment": true, "ichimokuBreakout": true, "mechanicalStop": true, "economicMoatVerified": true, "notPreviousLeader": true, "technicalGoldenCross": true, "volumeSurgeVerified": true, "institutionalBuying": true, "consensusTarget": true, "earningsSurprise": true, "performanceReality": true, "policyAlignment": true, "psychologicalObjectivity": true, "turtleBreakout": true, "fibonacciLevel": true, "elliottWaveVerified": true, "ocfQuality": true, "marginAcceleration": true, "interestCoverage": true, "relativeStrength": true, "vcpPattern": true, "divergenceCheck": true, "catalystAnalysis": true },
          "catalystDetail": { "description": "...", "score": 15, "upcomingEvents": ["..."] },
          "catalystSummary": "촉매제 분석 통과 이유(예: 실적 발표 예정, 정부 정책 수혜 등)를 20자 이내로 요약",
          "visualReport": { "financial": 1, "technical": 1, "supply": 1, "summary": "..." },
          "elliottWaveStatus": { "wave": "WAVE_3", "description": "..." },
          "analystRatings": { "strongBuy": 0, "buy": 0, "strongSell": 0, "sell": 0, "consensus": "...", "targetPriceAvg": 0, "targetPriceHigh": 0, "targetPriceLow": 0, "sources": ["..."] },
          "newsSentiment": { "score": 0, "status": "POSITIVE", "summary": "..." },
          "chartPattern": { "name": "역 헤드 앤 숄더", "type": "REVERSAL_BULLISH", "description": "강력한 바닥 다지기 후 추세 반전 신호", "reliability": 85 },
          "roeAnalysis": { "drivers": ["..."], "historicalTrend": "...", "strategy": "...", "metrics": { "netProfitMargin": 0, "assetTurnover": 0, "equityMultiplier": 0 } },
          "strategicInsight": { "cyclePosition": "NEW_LEADER", "earningsQuality": "...", "policyContext": "..." },
          "marketCap": 0, "marketCapCategory": "LARGE", "correlationGroup": "...",
          "aiConvictionScore": { "totalScore": 0, "factors": [{ "name": "...", "score": 0, "weight": 0 }], "marketPhase": "BULL", "description": "..." },
          "shortSelling": { "ratio": 0, "trend": "DECREASING", "implication": "..." },
          "tenbaggerDNA": { "similarity": 0, "matchPattern": "...", "reason": "..." },
          "disclosureSentiment": { "score": 0, "summary": "..." },
          "shortSelling": { "ratio": 0, "trend": "DECREASING", "implication": "..." },
          "tenbaggerDNA": { "similarity": 0, "matchPattern": "...", "reason": "..." },
          "isPullbackVolumeLow": true,
          "sectorLeaderNewHigh": true,
          "multiTimeframe": { "monthly": "BULLISH", "weekly": "BULLISH", "daily": "BULLISH", "consistency": true },
          "enemyChecklist": { "bearCase": "...", "riskFactors": ["..."], "counterArguments": ["..."] },
          "seasonality": { "month": 0, "historicalPerformance": 0, "winRate": 0, "isPeakSeason": true },
          "attribution": { "sectorContribution": 0, "momentumContribution": 0, "valueContribution": 0, "alpha": 0 },
          "tranchePlan": {
            "tranche1": { "size": 0, "trigger": "...", "status": "PENDING" },
            "tranche2": { "size": 0, "trigger": "...", "status": "PENDING" },
            "tranche3": { "size": 0, "trigger": "...", "status": "PENDING" }
          },
          "correlationScore": 0,
          "historicalAnalogy": { "stockName": "...", "period": "...", "similarity": 0, "reason": "..." },
          "latestNews": [
            { "headline": "뉴스 제목", "date": "2026-03-28", "url": "https://..." }
          ],
          "anomalyDetection": { "type": "FUNDAMENTAL_DIVERGENCE", "score": 0, "description": "..." },
          "semanticMapping": { "theme": "...", "keywords": ["..."], "relevanceScore": 0, "description": "..." },
          "gateEvaluation": { "gate1Passed": true, "gate2Passed": true, "gate3Passed": true, "finalScore": 0, "recommendation": "...", "positionSize": 0 },
          "multiTimeframe": { "monthly": "BULLISH", "weekly": "BULLISH", "daily": "BULLISH", "consistency": true },
          "sectorAnalysis": { "sectorName": "...", "currentTrends": ["..."], "leadingStocks": [{ "name": "...", "code": "...", "marketCap": "..." }], "catalysts": ["..."], "riskFactors": ["..."] },
          "dataSource": "...",
          "targetPrice": 0, "targetPrice2": 0, "entryPrice": 0, "entryPrice2": 0, "stopLoss": 0, "riskFactors": ["..."]
        }
      ]
    }
    
    [주의: JSON 응답 외에 어떤 텍스트도 포함하지 마라. 반드시 유효한 JSON 형식으로 닫는 중괄호까지 완벽하게 작성하라.]
  `;

  const cacheKey = `recommendations-${JSON.stringify(filters)}-${todayDate}`;
  
  return getCachedAIResponse(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            maxOutputTokens: 12000,
            temperature: 0.1, // Increased to 0.1 to encourage fresh search
          },
        });
      }, 2, 2000);

      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      const parsed = safeJsonParse(text);
      
      // Ensure recommendations is always an array
      if (parsed && !parsed.recommendations) {
        parsed.recommendations = [];
      }

      // Enrich with real data
      if (parsed && parsed.recommendations.length > 0) {
        console.log(`Enriching ${parsed.recommendations.length} recommendations with real data (sequentially)...`);
        const enrichedRecommendations = [];
        for (const stock of parsed.recommendations) {
          try {
            const enriched = await enrichStockWithRealData(stock);
            enrichedRecommendations.push(enriched);
            // Small delay between stocks to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (err) {
            console.error(`Failed to enrich ${stock.name}:`, err);
            enrichedRecommendations.push(stock);
          }
        }
        parsed.recommendations = enrichedRecommendations;
      }
      
      return parsed;
    } catch (error) {
      console.error("Error in getStockRecommendations:", error);
      throw error;
    }
  });
}

// ─── 아이디어 3: Bear Screener — Bear Regime 전용 하락 수혜주 AI 탐색 ──────────

/**
 * Gate -1이 Bear Regime을 감지했을 때 자동 활성화되는 Bear Screener.
 * 기존 27조건 Bull 스크리너 대신 방어형 15조건 기반으로 4개 카테고리
 * (방어주·역주기주·숏 수혜주·변동성 수혜주)에서 하락 수혜주를 탐색한다.
 */
async function getBearScreenerRecommendations(filters?: StockFilters): Promise<RecommendationResponse | null> {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];

  const cacheKey = `bear-screener-${todayDate}`;

  return getCachedAIResponse(cacheKey, async () => {
    const prompt = `
      [Bear Regime 전용 하락 수혜주 스크리닝 — Bear Screener]
      현재 한국 시각: ${now}  (오늘: ${todayDate})
      QuantMaster Pro의 Gate -1이 BEAR Regime을 감지했습니다.
      기존 27조건 Bull 스크리너 대신, 하락장에서 오히려 수익이 나는 "하락 수혜주"를 발굴하십시오.

      [스크리닝 카테고리 — 반드시 각 카테고리에서 1~2종목 이상 탐색]

      ① 방어주 (DEFENSIVE): 음식료·생활용품·통신·유틸리티 섹터
         - 배당 수익률 3% 이상, 베타 0.7 미만
         - 경기 둔화와 무관한 필수 소비 수요 보유
         - 예: KT&G, 한국전력, SK텔레콤, 하이트진로, CJ제일제당

      ② 역주기주 (COUNTER_CYCLICAL): 채권·금·달러 ETF 및 관련 종목
         - KODEX 골드선물(H) ETF, KODEX 미국달러선물 ETF
         - KODEX 국고채3년 ETF, TIGER 단기채권액티브 ETF
         - 달러/금 현물 비중이 높은 보험·금융사

      ③ 숏 수혜주 (VALUE_DEPRESSED): 실적 탄탄, 주가만 눌린 종목
         - ROE 15% 이상, PER 섹터 평균 이하
         - 52주 고점 대비 -30% 이상 하락, 공매도 잔고 감소 추세
         - 공매도 세력의 반대편: 실적 견조하여 숏 커버링 기대

      ④ 변동성 수혜주 (VOLATILITY_BENEFICIARY): 보험주, 금융주(NIM 개선)
         - VKOSPI 상승 시 손해율 개선 기대 보험주
         - 기준금리 유지·인상 구간 NIM 개선 은행·금융지주
         - 예: 삼성화재, 현대해상, DB손해보험, KB금융, 신한지주

      [반드시 실시간 검색 수행]
      1. "현재 하락장 방어주 한국 ${todayDate}", "고배당 저베타 한국주식"
      2. "채권 ETF 금 ETF 달러 ETF 한국 ${todayDate}"
      3. "공매도 잔고 감소 과매도 실적 종목 ${todayDate}"
      4. "보험주 금융주 NIM 개선 ${todayDate}"
      5. 각 종목의 실시간 주가 및 시가총액 교차검증 필수

      [Bear Screener 15개 방어 조건 평가]
      각 추천 종목에 대해 다음 15개 조건을 True/False로 평가하여 'checklist'에 포함하라:
      방어주 조건: dividendYield3pct, essentialConsumerSector, telcoUtilitySector, lowBeta
      역주기주 조건: bondEtfCandidate, goldEtfHedge, dollarEtfSurge, negativeCorrelation
      숏 수혜주 조건: roeAbove15, perBelowSectorAvg, shortInterestDeclining, oversoldFundamentalsIntact
      변동성 수혜주 조건: insuranceSector, financialNimImprovement, dollarHedgeExporter

      [Bear Screener 전용 BUY 조건 (일반 27조건과 다름)]
      Bear Screener에서는 다음 조건으로 BUY를 판단한다:
      - STRONG_BUY: 해당 카테고리 조건 4개 이상 충족 + 배당 수익률 4% 이상 또는 ROE 20% 이상 + 기관 매수 확인
      - BUY: 해당 카테고리 조건 3개 이상 충족 + 실적 안정성 확인
      - HOLD: 조건 2개 이하 충족 또는 펀더멘털 불명확
      주의: 일목균형표 ABOVE_CLOUD 조건은 Bear Screener에서 필수가 아님 (방어주는 눌린 상태일 수 있음)

      응답 형식은 기존 getStockRecommendations와 동일한 JSON이지만,
      bearScreenerCategory 필드를 추가하라: "DEFENSIVE" | "COUNTER_CYCLICAL" | "VALUE_DEPRESSED" | "VOLATILITY_BENEFICIARY"

      응답은 반드시 다음 JSON 형식으로만 하라:
      {
        "marketContext": {
          "kospi": { "index": 0, "change": 0, "changePercent": 0, "status": "BEAR", "analysis": "Bear Regime 활성..." },
          "kosdaq": { "index": 0, "change": 0, "changePercent": 0, "status": "BEAR", "analysis": "..." },
          "globalIndices": { "nasdaq": { "index": 0, "changePercent": 0 }, "snp500": { "index": 0, "changePercent": 0 }, "dow": { "index": 0, "changePercent": 0 }, "sox": { "index": 0, "changePercent": 0 } },
          "globalMacro": { "us10yYield": 0, "brentOil": 0, "gold": 0, "dollarIndex": 0 },
          "fearAndGreed": { "value": 0, "status": "FEAR" },
          "iri": 0, "vkospi": 0,
          "globalEtfMonitoring": [],
          "regimeShiftDetector": { "currentRegime": "BEAR", "nextRegimeProbability": 0, "leadingIndicator": "..." },
          "volumeTrend": "DECLINING",
          "exchangeRate": { "value": 0, "change": 0 },
          "bondYield": { "value": 0, "change": 0 },
          "overallSentiment": "Bear Screener 활성 — 하락 수혜주 탐색 모드",
          "marketPhase": "BEAR",
          "activeStrategy": "Bear Screener — 방어주·역주기주·숏수혜주·변동성수혜주",
          "dataSource": "..."
        },
        "recommendations": [
          {
            "name": "종목명", "code": "종목코드", "corpCode": "00000000", "reason": "Bear Screener 선정 이유...",
            "type": "BUY", "gate": 2, "patterns": [], "hotness": 6,
            "bearScreenerCategory": "DEFENSIVE",
            "isLeadingSector": false, "isSectorTopPick": true, "momentumRank": 1, "confidenceScore": 75,
            "supplyQuality": { "passive": true, "active": false },
            "peakPrice": 0, "currentPrice": 0, "priceUpdatedAt": "...", "dataSource": "...",
            "isPreviousLeader": false, "ichimokuStatus": "IN_CLOUD", "relatedSectors": ["방어주"],
            "valuation": { "per": 0, "pbr": 0, "epsGrowth": 0, "debtRatio": 0 },
            "technicalSignals": {
              "maAlignment": "NEUTRAL", "rsi": 40, "macdStatus": "NEUTRAL", "bollingerStatus": "LOWER_TOUCH",
              "stochasticStatus": "OVERSOLD", "volumeSurge": false, "disparity20": 0,
              "macdHistogram": 0, "bbWidth": 0, "stochRsi": 0,
              "macdHistogramDetail": { "status": "NEUTRAL", "implication": "..." },
              "bbWidthDetail": { "status": "NORMAL", "implication": "..." },
              "stochRsiDetail": { "status": "OVERSOLD", "implication": "..." }
            },
            "economicMoat": { "type": "BRAND", "description": "..." },
            "scores": { "value": 0, "momentum": 0 },
            "shortSelling": { "ratio": 0, "trend": "DECREASING", "implication": "공매도 감소, 숏 커버링 기대" },
            "tenbaggerDNA": { "similarity": 0, "matchPattern": "", "reason": "..." },
            "checklist": {
              "dividendYield3pct": true, "essentialConsumerSector": true, "telcoUtilitySector": false, "lowBeta": true,
              "bondEtfCandidate": false, "goldEtfHedge": false, "dollarEtfSurge": false, "negativeCorrelation": false,
              "roeAbove15": true, "perBelowSectorAvg": true, "shortInterestDeclining": true, "oversoldFundamentalsIntact": true,
              "insuranceSector": false, "financialNimImprovement": false, "dollarHedgeExporter": false
            },
            "catalystDetail": { "description": "...", "score": 10, "upcomingEvents": ["..."] },
            "catalystSummary": "Bear Regime 방어 수혜",
            "visualReport": { "financial": 1, "technical": 1, "supply": 1, "summary": "..." },
            "roeAnalysis": { "drivers": ["..."], "historicalTrend": "...", "strategy": "...", "metrics": { "netProfitMargin": 0, "assetTurnover": 0, "equityMultiplier": 0 } },
            "sectorAnalysis": { "sectorName": "방어주", "currentTrends": ["..."], "leadingStocks": [], "catalysts": ["..."], "riskFactors": ["..."] },
            "latestNews": [],
            "enemyChecklist": { "bearCase": "...", "riskFactors": ["..."], "counterArguments": ["..."] },
            "seasonality": { "month": 0, "historicalPerformance": 0, "winRate": 0, "isPeakSeason": false },
            "attribution": { "sectorContribution": 0, "momentumContribution": 0, "valueContribution": 0, "alpha": 0 },
            "multiTimeframe": { "monthly": "NEUTRAL", "weekly": "BEARISH", "daily": "BEARISH", "consistency": false },
            "tranchePlan": {
              "tranche1": { "size": 40, "trigger": "현재가 진입", "status": "PENDING" },
              "tranche2": { "size": 40, "trigger": "추가 하락 시 분할", "status": "PENDING" },
              "tranche3": { "size": 20, "trigger": "반등 확인 후", "status": "PENDING" }
            },
            "marketCap": 0, "marketCapCategory": "LARGE",
            "targetPrice": 0, "targetPrice2": 0, "entryPrice": 0, "stopLoss": 0, "riskFactors": ["..."]
          }
        ]
      }

      [주의: JSON 응답 외에 어떤 텍스트도 포함하지 마라. 반드시 유효한 JSON으로 작성하라.]
    `;

    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            maxOutputTokens: 12000,
            temperature: 0.1,
          },
        });
      }, 2, 2000);

      const text = response.text;
      if (!text) throw new Error("Bear Screener: No response from AI");

      const parsed = safeJsonParse(text);
      if (parsed && !parsed.recommendations) parsed.recommendations = [];

      // Enrich with real data
      if (parsed && parsed.recommendations.length > 0) {
        const enrichedRecommendations = [];
        for (const stock of parsed.recommendations) {
          try {
            const enriched = await enrichStockWithRealData(stock);
            enrichedRecommendations.push(enriched);
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (err) {
            console.error(`Bear Screener: Failed to enrich ${stock.name}:`, err);
            enrichedRecommendations.push(stock);
          }
        }
        parsed.recommendations = enrichedRecommendations;
      }

      return parsed;
    } catch (error) {
      console.error("Error in getBearScreenerRecommendations:", error);
      throw error;
    }
  });
}







// ─── 배치 통합 호출 (12개 → 3개 압축) ─────────────────────────────────────────
//
// 기존 12개 개별 AI 호출을 3개 배치 호출로 통합.
// Google Search 1회로 공유 컨텍스트 기반 응답 → 품질 향상 + 비용 75% 절감.
//
// Batch 1: getBatchGlobalIntel()  — macro + regime + extendedRegime + creditSpreads + financialStress + smartMoney
// Batch 2: getBatchSectorIntel()  — exportMomentum + geoRisk + supplyChain + sectorOrders
// Batch 3: getBatchMarketIntel()  — globalCorrelation + fomcSentiment

export interface BatchGlobalIntelResult {
  macro: MacroEnvironment;
  regime: EconomicRegimeData;
  extendedRegime: ExtendedRegimeData;
  creditSpreads: CreditSpreadData;
  financialStress: FinancialStressIndex;
  smartMoney: SmartMoneyData;
}

export interface BatchSectorIntelResult {
  exportMomentum: ExportMomentumData;
  geoRisk: GeopoliticalRiskData;
  supplyChain: SupplyChainIntelligence;
  sectorOrders: SectorOrderIntelligence;
}

export interface BatchMarketIntelResult {
  globalCorrelation: GlobalCorrelationMatrix;
  fomcSentiment: FomcSentimentAnalysis;
}

/**
 * Batch 1: 글로벌 거시경제 인텔리전스 통합 호출.
 * Phase A (Search 없음): ECOS + Yahoo → macro 10개 필드 + regime + extendedRegime
 * Phase B (Search 1회): creditSpreads + financialStress + smartMoney
 * 비용: 기존 Search 1회(전체) → Phase A 무료 + Phase B Search 1회(3개 지표만)
 */
export async function getBatchGlobalIntel(): Promise<BatchGlobalIntelResult> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  // ── 1단계: 무료 데이터 병렬 수집 (ECOS 한국은행 + Yahoo Finance, Search 0회) ──
  type EcosF = Partial<{
    bokRateDirection: 'HIKING' | 'HOLDING' | 'CUTTING';
    m2GrowthYoY: number; nominalGdpGrowth: number;
    exportGrowth3mAvg: number; usdKrw: number;
    bankLendingGrowth: number; // 104Y015 실데이터
  }>;
  let ecosFields: EcosF = {};
  let yahooFields = { vix: null as number | null, us10yYield: null as number | null,
                      usShortRate: null as number | null, samsungIri: null as number | null,
                      vkospi: null as number | null };
  let bokRateValue: number | null = null;

  const [ecosSnapshotR, yahooR] = await Promise.allSettled([
    getMacroSnapshot(),
    fetchMarketIndicators(),
  ]);
  if (ecosSnapshotR.status === 'fulfilled') {
    const snap = ecosSnapshotR.value;
    ecosFields = snapshotToMacroFields(snap);
    if (snap.bokRate) bokRateValue = snap.bokRate.rate;
    console.log('[getBatchGlobalIntel] ECOS 수집 완료:', Object.keys(ecosFields));
  } else {
    console.warn('[getBatchGlobalIntel] ECOS 수집 실패:', ecosSnapshotR.reason);
  }
  if (yahooR.status === 'fulfilled') {
    yahooFields = yahooR.value;
    console.log('[getBatchGlobalIntel] Yahoo 수집 완료: vix=%d us10y=%d', yahooFields.vix, yahooFields.us10yYield);
  }

  // krUsSpread = 한국 기준금리 - 미국 단기금리(^IRX proxy)
  const krUsSpread = (bokRateValue !== null && yahooFields.usShortRate !== null)
    ? parseFloat((bokRateValue - yahooFields.usShortRate).toFixed(2))
    : null;

  // 사전 확보 필드 조합 (AI Phase A에 전달 → 검색 대체)
  const preFilledMacro: Record<string, number | string> = {
    ...(ecosFields.bokRateDirection    ? { bokRateDirection:    ecosFields.bokRateDirection }    : {}),
    ...(ecosFields.m2GrowthYoY        !== undefined ? { m2GrowthYoY:        ecosFields.m2GrowthYoY }        : {}),
    ...(ecosFields.nominalGdpGrowth   !== undefined ? { nominalGdpGrowth:   ecosFields.nominalGdpGrowth }   : {}),
    ...(ecosFields.exportGrowth3mAvg  !== undefined ? { exportGrowth3mAvg:  ecosFields.exportGrowth3mAvg }  : {}),
    ...(ecosFields.usdKrw             !== undefined ? { usdKrw:             ecosFields.usdKrw }             : {}),
    ...(ecosFields.bankLendingGrowth  !== undefined ? { bankLendingGrowth:  ecosFields.bankLendingGrowth }  : {}), // ECOS 104Y015
    ...(yahooFields.vix       !== null ? { vix:        yahooFields.vix }       : {}),
    ...(yahooFields.us10yYield !== null ? { us10yYield: yahooFields.us10yYield } : {}),
    ...(yahooFields.samsungIri !== null ? { samsungIri: yahooFields.samsungIri } : {}),
    ...(yahooFields.vkospi    !== null ? { vkospi:     yahooFields.vkospi }    : {}), // Yahoo ^VKOSPI 실데이터
    ...(krUsSpread             !== null ? { krUsSpread }                          : {}),
  };
  const preFilledCount = Object.keys(preFilledMacro).length;
  console.log(`[getBatchGlobalIntel] 사전 확보 macro 필드 ${preFilledCount}/12`);

  // ── Phase A 프롬프트: Search 없이 API 수치 기반 해석 (macro 완성 + regime 분류) ──
  const phaseAPrompt = `현재 한국 날짜: ${todayDate}

아래는 ECOS 한국은행 + Yahoo Finance에서 수집한 실제 수치입니다.
Google 검색 없이 이 데이터만으로 분석하세요.

[확보 실데이터 ${preFilledCount}/12개]
${JSON.stringify(preFilledMacro, null, 2)}

━━━ 1. macro: 12개 지표 완성 ━━━
확보된 필드는 그대로 사용. 누락 필드만 주어진 데이터로 추정:
- oeciCliKorea: exportGrowth3mAvg + nominalGdpGrowth 기반 추정

━━━ 2. regime: 경기 레짐 (4단계) ━━━
RECOVERY/EXPANSION/SLOWDOWN/RECESSION.
- regime, confidence(0-100), rationale, allowedSectors(최대6), avoidSectors(최대4)
- keyIndicators: { exportGrowth, bokRateDirection, oeciCli, gdpGrowth }

━━━ 3. extendedRegime: 7단계 레짐 ━━━
RECOVERY/EXPANSION/SLOWDOWN/RECESSION/UNCERTAIN/CRISIS/RANGE_BOUND.
- 기본 regime 필드 + uncertaintyMetrics + systemAction
- uncertaintyMetrics: { regimeClarity(0-100), signalConflict(0-100), kospi60dVolatility, leadingSectorCount, foreignFlowDirection("CONSISTENT_BUY"|"CONSISTENT_SELL"|"ALTERNATING"), correlationBreakdown(boolean) }
- systemAction: { mode("NORMAL"|"DEFENSIVE"|"CASH_HEAVY"|"FULL_STOP"|"PAIR_TRADE"), cashRatio(0-100), gateAdjustment: { gate1Threshold, gate2Required, gate3Required }, message }

모든 lastUpdated: "${requestedAtISO}"
응답 형식 (JSON only): { "macro": {...}, "regime": {...}, "extendedRegime": {...} }`.trim();

  // ── Phase B 데이터: FRED API(HY Spread) + Yahoo ETF(스마트머니) → Search 0회 ──
  const fetchFred = async (seriesId: string): Promise<number | null> => {
    try {
      const res = await fetch(`/api/fred?series_id=${seriesId}`);
      if (!res.ok) return null;
      const data = await res.json();
      const obs: { value: string }[] = data.observations ?? [];
      const latest = obs.find(o => o.value !== '.' && o.value !== '');
      return latest ? parseFloat(latest.value) : null;
    } catch { return null; }
  };

  // FRED + Yahoo ETF 병렬 수집 (Search 대체)
  const [fredHyR, fredSofrR, yahooPhaseB] = await Promise.allSettled([
    fetchFred('BAMLH0A0HYM2'),  // ICE BofA US HY OAS (%, × 100 = bps)
    fetchFred('SOFR'),           // SOFR rate (TED spread 근사: SOFR - ^IRX)
    fetchMarketIndicators(),     // EWY, MTUM 5일 수익률 포함
  ]);

  const fredHySpread  = fredHyR.status  === 'fulfilled' && fredHyR.value  !== null ? Math.round(fredHyR.value * 100)  : null;
  const fredSofr      = fredSofrR.status === 'fulfilled' && fredSofrR.value !== null ? fredSofrR.value : null;
  const yahooB        = yahooPhaseB.status === 'fulfilled' ? yahooPhaseB.value : null;
  const tedSpreadBps  = (fredSofr !== null && yahooB?.usShortRate !== null && yahooB?.usShortRate !== undefined)
    ? Math.round((fredSofr - (yahooB.usShortRate ?? 0)) * 100) : null;
  const ewyRet  = yahooB?.ewyReturn  ?? null;
  const mtumRet = yahooB?.mtumReturn ?? null;

  // Phase B 프롬프트: 사전 수집 실데이터 주입, Search 없음
  const phaseBLines: string[] = [];
  if (fredHySpread !== null) phaseBLines.push(`- US HY Spread (FRED BAMLH0A0HYM2): ${fredHySpread}bp`);
  if (tedSpreadBps !== null) phaseBLines.push(`- TED Spread 근사 (SOFR-T-bill): ${tedSpreadBps}bp`);
  if (ewyRet !== null)       phaseBLines.push(`- EWY(한국 ETF) 5일 수익률: ${ewyRet >= 0 ? '+' : ''}${ewyRet}%`);
  if (mtumRet !== null)      phaseBLines.push(`- MTUM(모멘텀 ETF) 5일 수익률: ${mtumRet >= 0 ? '+' : ''}${mtumRet}%`);

  const phaseBPrompt = `현재 한국 날짜: ${todayDate}

아래 실데이터를 기반으로 3가지 금융시장 지표를 JSON으로 반환하세요. Google 검색 불필요.

[사전 수집 실데이터]
${phaseBLines.length > 0 ? phaseBLines.join('\n') : '(데이터 수집 실패 — 추정값 사용)'}

━━━ 1. creditSpreads: 신용 스프레드 ━━━
위 US HY Spread 실데이터를 usHySpread(bp)에 그대로 사용.
- krCorporateSpread(bp) 추정: 국내 AA- 회사채 - 국채 3년물 스프레드
- embiSpread(bp) 추정: 신흥국 EMBI 스프레드
- isCrisisAlert: krCorporateSpread>=150, isLiquidityExpanding: NARROWING AND <100
- trend: "WIDENING"|"NARROWING"|"STABLE"

━━━ 2. financialStress: 금융 스트레스 지수 ━━━
위 TED Spread 근사값을 tedSpread.bps에 그대로 사용.
위 US HY Spread를 usHySpread.bps에 그대로 사용.
- moveIndex: {current, alert("NORMAL"|"ELEVATED"|"EXTREME")} — VIX 기반 추정
- compositeScore(0-100), systemAction("NORMAL"|"CAUTION"|"DEFENSIVE"|"CRISIS")

━━━ 3. smartMoney: 스마트머니 ETF 흐름 ━━━
위 EWY/MTUM 5일 수익률을 priceChange에 그대로 사용. flow: 양수=INFLOW, 음수=OUTFLOW.
- score(0-10): EWY+MTUM 동시 INFLOW=+4, EWY만=+2, MTUM만=+1
- etfFlows: [{ticker,name,flow,weeklyAumChange(%),priceChange(%),significance}]
- isEwyMtumBothInflow(boolean), leadTimeWeeks, signal("BULLISH"|"BEARISH"|"NEUTRAL")

모든 lastUpdated: "${requestedAtISO}"
응답 형식 (JSON only): { "creditSpreads": {...}, "financialStress": {...}, "smartMoney": {...} }`.trim();

  const cacheKey = `batch-global-intel-${todayDate}`;

  return getCachedAIResponse<BatchGlobalIntelResult>(cacheKey, async () => {
    // Phase A (Search 없음) + Phase B (Search 없음, FRED+Yahoo 실데이터) 병렬 실행
    const [phaseARes, phaseBRes] = await Promise.allSettled([
      withRetry(() => getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: phaseAPrompt,
        config: { temperature: 0.1, maxOutputTokens: 4096 },
      }), 2, 2000),
      withRetry(() => getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: phaseBPrompt,
        config: { temperature: 0.1, maxOutputTokens: 4096 },  // googleSearch 제거
      }), 2, 2000),
    ]);

    if (phaseARes.status === 'rejected') console.error('[getBatchGlobalIntel] Phase A 실패:', phaseARes.reason);
    if (phaseBRes.status === 'rejected') console.error('[getBatchGlobalIntel] Phase B 실패:', phaseBRes.reason);

    const fallbackMacro = {
      bokRateDirection: 'HOLDING' as const, us10yYield: 4.3, krUsSpread: -1.25,
      m2GrowthYoY: 6.0, bankLendingGrowth: 5.0, nominalGdpGrowth: 3.5,
      oeciCliKorea: 100.0, exportGrowth3mAvg: 8.0, vkospi: 18.0,
      samsungIri: 1.0, vix: 18.0, usdKrw: 1380.0,
    };
    const fallbackRegime = {
      regime: 'EXPANSION' as const, confidence: 50, rationale: 'Phase A 실패. 기본값.',
      allowedSectors: ['반도체', '조선', '방산'], avoidSectors: [],
      keyIndicators: { exportGrowth: 'N/A', bokRateDirection: 'N/A', oeciCli: 'N/A', gdpGrowth: 'N/A' },
      lastUpdated: requestedAtISO,
    };

    const parsedA = (phaseARes.status === 'fulfilled' && phaseARes.value.text)
      ? safeJsonParse(phaseARes.value.text) as Pick<BatchGlobalIntelResult, 'macro' | 'regime' | 'extendedRegime'>
      : null;
    const parsedB = (phaseBRes.status === 'fulfilled' && phaseBRes.value.text)
      ? safeJsonParse(phaseBRes.value.text) as Pick<BatchGlobalIntelResult, 'creditSpreads' | 'financialStress' | 'smartMoney'>
      : null;

    const parsed: BatchGlobalIntelResult = {
      macro:          parsedA?.macro          ?? fallbackMacro,
      regime:         parsedA?.regime         ?? fallbackRegime,
      extendedRegime: parsedA?.extendedRegime ?? {
        ...fallbackRegime,
        uncertaintyMetrics: { regimeClarity: 50, signalConflict: 50, kospi60dVolatility: 0, leadingSectorCount: 0, foreignFlowDirection: 'ALTERNATING' as const, correlationBreakdown: false },
        systemAction: { mode: 'DEFENSIVE' as const, cashRatio: 50, gateAdjustment: { gate1Threshold: 6, gate2Required: 10, gate3Required: 8 }, message: 'Phase A 실패. 방어 모드.' },
      },
      creditSpreads:  parsedB?.creditSpreads  ?? { krCorporateSpread: 70, usHySpread: 330, embiSpread: 390, isCrisisAlert: false, isLiquidityExpanding: false, trend: 'STABLE' as const, lastUpdated: requestedAtISO },
      financialStress:parsedB?.financialStress ?? { tedSpread: { bps: 0, alert: 'NORMAL' as const }, usHySpread: { bps: 0, trend: 'STABLE' as const }, moveIndex: { current: 0, alert: 'NORMAL' as const }, compositeScore: 0, systemAction: 'NORMAL' as const, lastUpdated: requestedAtISO },
      smartMoney:     parsedB?.smartMoney     ?? { score: 5, etfFlows: [], isEwyMtumBothInflow: false, leadTimeWeeks: 'N/A', signal: 'NEUTRAL' as const, lastUpdated: requestedAtISO },
    };

    // ── API 실데이터로 macro 오버라이드 (ECOS + Yahoo, AI 추정값보다 우선) ──
    const apiOverride = {
      ...ecosFields,
      ...(yahooFields.vix        !== null ? { vix:        yahooFields.vix }        : {}),
      ...(yahooFields.us10yYield !== null ? { us10yYield: yahooFields.us10yYield } : {}),
      ...(yahooFields.samsungIri !== null ? { samsungIri: yahooFields.samsungIri } : {}),
      ...(yahooFields.vkospi     !== null ? { vkospi:     yahooFields.vkospi }     : {}),
      ...(krUsSpread             !== null ? { krUsSpread }                          : {}),
    } as Partial<typeof parsed.macro>;
    if (Object.keys(apiOverride).length > 0) {
      parsed.macro = { ...parsed.macro, ...apiOverride };
      console.log('[getBatchGlobalIntel] API 실데이터 오버라이드:', Object.keys(apiOverride));
    }

    // 개별 캐시 저장 → 기존 개별 함수 호출 시 캐시 히트
    const nowTs   = Date.now();
    const macroKey  = `macro-environment-${todayDate}`;
    const regimeKey = `economic-regime-${todayDate}`;
    const extRegKey = `extended-regime-${todayDate}`;
    const weekKey   = `${requestedAt.getFullYear()}-W${Math.ceil((requestedAt.getDate() - requestedAt.getDay() + 1) / 7).toString().padStart(2, '0')}`;
    const creditKey = `credit-spread-${weekKey}`;
    const fsiKey    = `financial-stress-index-${weekKey}`;
    const smartKey  = `smart-money-${todayDate}`;

    if (parsed.macro)           { aiCache[macroKey]  = { data: parsed.macro,           timestamp: nowTs }; lsSet(macroKey,  { data: parsed.macro,           timestamp: nowTs }); }
    if (parsed.regime)          { aiCache[regimeKey] = { data: parsed.regime,          timestamp: nowTs }; lsSet(regimeKey, { data: parsed.regime,          timestamp: nowTs }); }
    if (parsed.extendedRegime)  { aiCache[extRegKey] = { data: parsed.extendedRegime,  timestamp: nowTs }; lsSet(extRegKey, { data: parsed.extendedRegime,  timestamp: nowTs }); }
    if (parsed.creditSpreads)   { aiCache[creditKey] = { data: parsed.creditSpreads,   timestamp: nowTs }; lsSet(creditKey, { data: parsed.creditSpreads,   timestamp: nowTs }); }
    if (parsed.financialStress) { aiCache[fsiKey]    = { data: parsed.financialStress, timestamp: nowTs }; lsSet(fsiKey,    { data: parsed.financialStress, timestamp: nowTs }); }
    if (parsed.smartMoney)      { aiCache[smartKey]  = { data: parsed.smartMoney,      timestamp: nowTs }; lsSet(smartKey,  { data: parsed.smartMoney,      timestamp: nowTs }); }

    return parsed;
  });
}

/**
 * Batch 2: 섹터/무역 인텔리전스 통합 호출.
 * exportMomentum + geoRisk + supplyChain + sectorOrders
 * 4개 개별 호출 → 1회 Google Search로 통합.
 */
export async function getBatchSectorIntel(): Promise<BatchSectorIntelResult> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  // ── 1단계: ECOS 총수출 데이터 수집 (Search 0회) ──
  let ecosExport: { latestYoY: number; ma3m: number; consecutivePositive: number; monthlyRows: string } | null = null;
  try {
    const rows = await getTradeData(4); // 최근 4개월
    if (rows.length >= 3) {
      const recent = rows.slice(-4);
      const latestYoY = recent[recent.length - 1].exportGrowthYoY;
      const ma3m = parseFloat(
        (recent.slice(-3).reduce((s, d) => s + d.exportGrowthYoY, 0) / 3).toFixed(2)
      );
      // 최신 기준으로 역순 탐색하여 연속 양성 개월 수 계산
      let consecutivePositive = 0;
      for (let i = recent.length - 1; i >= 0; i--) {
        if (recent[i].exportGrowthYoY > 0) consecutivePositive++;
        else break;
      }
      const monthlyRows = recent
        .map(d => `  ${d.date}: YoY ${d.exportGrowthYoY > 0 ? '+' : ''}${d.exportGrowthYoY.toFixed(1)}%`)
        .join('\n');
      ecosExport = { latestYoY, ma3m, consecutivePositive, monthlyRows };
      console.log('[getBatchSectorIntel] ECOS 수출 수집 완료: 최신YoY=%d% 3MA=%d%', latestYoY, ma3m);
    }
  } catch (e) {
    console.warn('[getBatchSectorIntel] ECOS 수출 수집 실패:', e);
  }

  // ── Phase A 프롬프트: ECOS 실데이터 → exportMomentum 파생 (Search 없음) ──
  const phaseAPrompt = ecosExport
    ? `현재 한국 날짜: ${todayDate}

아래는 ECOS 한국은행 통관 기준 총수출 실데이터입니다. Google 검색 없이 이 수치를 기반으로 분석하세요.

[ECOS 총수출 YoY 증감률]
${ecosExport.monthlyRows}
- 최신 월 YoY: ${ecosExport.latestYoY > 0 ? '+' : ''}${ecosExport.latestYoY}%
- 3개월 이동평균: ${ecosExport.ma3m > 0 ? '+' : ''}${ecosExport.ma3m}%
- 연속 플러스 개월: ${ecosExport.consecutivePositive}개월

위 수치와 한국 수출 구조(반도체 약 20%, 자동차 10%, 선박 9%, 석유화학 8%, 방산 4%)를 바탕으로 exportMomentum을 도출하세요.
판단 기준:
- 총수출 3MA > +15% → 반도체 주도 가능성 높음 (hotSector)
- 총수출 3MA > +20% → 선박/조선 동반 호조 가능성 (shipyardBonus 후보)
- 연속 플러스 >= 3개월 → semiconductorGate2Relax = true
- 각 품목 yoyGrowth는 총수출 YoY에서 구성비 기반 추정

응답 형식 (JSON only):
{ "exportMomentum": { "hotSectors": [...], "products": [{"product":"반도체","sector":"IT/반도체","yoyGrowth":0,"isHot":false,"consecutiveGrowthMonths":0}, ...5개], "shipyardBonus": false, "semiconductorGate2Relax": false, "lastUpdated": "${requestedAtISO}" } }`.trim()
    : `현재 한국 날짜: ${todayDate}
ECOS 수출 데이터 수집 실패. 알려진 최근 한국 수출 동향을 바탕으로 exportMomentum을 추정하세요 (검색 없이).
응답 형식 (JSON only): { "exportMomentum": { "hotSectors": [], "products": [], "shipyardBonus": false, "semiconductorGate2Relax": false, "lastUpdated": "${requestedAtISO}" } }`;

  // ── Phase B 프롬프트: Search 1회, 3개 컴포넌트 ──
  const phaseBPrompt = `현재 한국 날짜: ${todayDate}

Google 검색으로 아래 3가지 지표를 조회하고 JSON으로 반환하세요.

━━━ 1. geoRisk: 지정학 리스크 스코어 ━━━
키워드: 한반도 안보, NATO 방산 예산, 원자력/SMR 정책, 한국 조선 수주
- score(0-10): 기본5, NATO 방산 증가+2, 원자력/SMR 기회+1, 조선 수주 호조+1, 한반도 긴장-2, 극도 불확실-3
- level: "OPPORTUNITY"|"NEUTRAL"|"RISK"
- affectedSectors, headlines(주요 뉴스 3개), toneBreakdown: { positive, neutral, negative }

━━━ 2. supplyChain: 공급망 선행지표 ━━━
- bdi: { current, mom3Change(%), trend("SURGING"|"RISING"|"FLAT"|"FALLING"|"COLLAPSING"), sectorImplication }
- semiBillings: { latestBillionUSD, yoyGrowth(%), bookToBill, implication }
- gcfi: { shanghaiEurope($/40ft), transPacific($/40ft), trend("RISING"|"FLAT"|"FALLING") }

━━━ 3. sectorOrders: 글로벌 수주 인텔리전스 ━━━
- globalDefense: { natoGdpAvg(%), usDefenseBudget(억달러), trend("EXPANDING"|"STABLE"|"CUTTING"), koreaExposure }
- lngOrders: { newOrdersYTD(척), qatarEnergy(현황), orderBookMonths, implication }
- smrContracts: { usNrcApprovals, totalGwCapacity(GW), koreaHyundai(현황), timing("TOO_EARLY"|"OPTIMAL"|"LATE") }

모든 lastUpdated: "${requestedAtISO}"
응답 형식 (JSON only): { "geoRisk": {...}, "supplyChain": {...}, "sectorOrders": {...} }`.trim();

  const cacheKey = `batch-sector-intel-${todayDate}`;

  return getCachedAIResponse<BatchSectorIntelResult>(cacheKey, async () => {
    const [phaseARes, phaseBRes] = await Promise.allSettled([
      withRetry(() => getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: phaseAPrompt,
        config: { temperature: 0.1, maxOutputTokens: 2048 },
      }), 2, 2000),
      withRetry(() => getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: phaseBPrompt,
        config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 6144 },
      }), 2, 2000),
    ]);

    if (phaseARes.status === 'rejected') console.error('[getBatchSectorIntel] Phase A 실패:', phaseARes.reason);
    if (phaseBRes.status === 'rejected') console.error('[getBatchSectorIntel] Phase B 실패:', phaseBRes.reason);

    const parsedA = (phaseARes.status === 'fulfilled' && phaseARes.value.text)
      ? safeJsonParse(phaseARes.value.text) as { exportMomentum?: ExportMomentumData } : null;
    const parsedB = (phaseBRes.status === 'fulfilled' && phaseBRes.value.text)
      ? safeJsonParse(phaseBRes.value.text) as Partial<BatchSectorIntelResult> : null;

    const fallbackExport: ExportMomentumData = { hotSectors: [], products: [], shipyardBonus: false, semiconductorGate2Relax: false, lastUpdated: requestedAtISO };

    const parsed: BatchSectorIntelResult = {
      exportMomentum: parsedA?.exportMomentum ?? fallbackExport,
      geoRisk: parsedB?.geoRisk ?? { score: 5, level: 'NEUTRAL', affectedSectors: ['방위산업', '조선', '원자력'], headlines: [], toneBreakdown: { positive: 33, neutral: 34, negative: 33 }, lastUpdated: requestedAtISO },
      supplyChain: parsedB?.supplyChain ?? {
        bdi: { current: 0, mom3Change: 0, trend: 'FLAT', sectorImplication: '데이터 조회 실패' },
        semiBillings: { latestBillionUSD: 0, yoyGrowth: 0, bookToBill: 1.0, implication: '데이터 조회 실패' },
        gcfi: { shanghaiEurope: 0, transPacific: 0, trend: 'FLAT' }, lastUpdated: requestedAtISO,
      },
      sectorOrders: parsedB?.sectorOrders ?? {
        globalDefense: { natoGdpAvg: 0, usDefenseBudget: 0, trend: 'STABLE', koreaExposure: '데이터 조회 실패' },
        lngOrders: { newOrdersYTD: 0, qatarEnergy: '데이터 조회 실패', orderBookMonths: 0, implication: '데이터 조회 실패' },
        smrContracts: { usNrcApprovals: 0, totalGwCapacity: 0, koreaHyundai: '데이터 조회 실패', timing: 'TOO_EARLY' }, lastUpdated: requestedAtISO,
      },
    };

    // 개별 캐시 저장
    const tsNow = Date.now();
    const yearMonth = requestedAt.toISOString().slice(0, 7);
    const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;

    if (parsed.exportMomentum) { const k = `export-momentum-${yearMonth}`; aiCache[k] = { data: parsed.exportMomentum, timestamp: tsNow }; lsSet(k, { data: parsed.exportMomentum, timestamp: tsNow }); }
    if (parsed.geoRisk)        { const k = `geo-risk-${weekKey}`;           aiCache[k] = { data: parsed.geoRisk,        timestamp: tsNow }; lsSet(k, { data: parsed.geoRisk,        timestamp: tsNow }); }
    if (parsed.supplyChain)    { const k = `supply-chain-intel-${weekKey}`; aiCache[k] = { data: parsed.supplyChain,    timestamp: tsNow }; lsSet(k, { data: parsed.supplyChain,    timestamp: tsNow }); }
    if (parsed.sectorOrders)   { const k = `sector-order-intel-${weekKey}`; aiCache[k] = { data: parsed.sectorOrders,   timestamp: tsNow }; lsSet(k, { data: parsed.sectorOrders,   timestamp: tsNow }); }

    return parsed;
  });
}

/**
 * Batch 3: 시장 상관관계 & 센티먼트 통합 호출.
 * globalCorrelation + fomcSentiment
 * 2개 개별 호출 → 1회로 통합.
 */
export async function getBatchMarketIntel(): Promise<BatchMarketIntelResult> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

다음 2가지 시장 분석을 한번에 수행하고 JSON으로 반환하세요.
Google 검색을 통해 최신 데이터를 기반으로 판단하세요.

━━━ 1. globalCorrelation: 글로벌 상관관계 매트릭스 ━━━
최근 30거래일 상관계수 추정:
- kospiSp500: KOSPI-S&P500 (정상 0.6~0.8, 디커플링 <0.3, 동조화 >0.9)
- kospiNikkei: KOSPI-닛케이225 (정상 0.5~0.7)
- kospiShanghai: KOSPI-상해종합 (정상 0.3~0.6)
- kospiDxy: KOSPI-달러인덱스 (보통 음의 상관 -0.3~-0.6)
- isDecoupling: kospiSp500 < 0.3
- isGlobalSync: kospiSp500 > 0.9

━━━ 2. fomcSentiment: FOMC 감성 분석 ━━━
최근 FOMC 의사록/성명서 기반:
- hawkDovishScore: -10(극비둘기) ~ +10(극매파)
- keyPhrases: 핵심 문구 배열 (예: "data dependent", "higher for longer")
- dotPlotShift: "MORE_CUTS"|"UNCHANGED"|"FEWER_CUTS"
- kospiImpact: "BULLISH"(비둘기≤-5)|"NEUTRAL"(-5~+5)|"BEARISH"(매파≥+5)
- rationale: 한국 증시 영향 근거 (한국어)

모든 lastUpdated는 "${requestedAtISO}"로 설정.

응답 형식 (JSON only):
{
  "globalCorrelation": { "kospiSp500": 0.72, "kospiNikkei": 0.58, "kospiShanghai": 0.41, "kospiDxy": -0.45, "isDecoupling": false, "isGlobalSync": false, "lastUpdated": "..." },
  "fomcSentiment": { "hawkDovishScore": 3, "keyPhrases": [...], "dotPlotShift": "FEWER_CUTS", "kospiImpact": "BEARISH", "rationale": "...", "lastUpdated": "..." }
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `batch-market-intel-${weekKey}`;

  return getCachedAIResponse<BatchMarketIntelResult>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text) as BatchMarketIntelResult;

      // 개별 캐시에도 저장
      const tsNow = Date.now();
      if (parsed.globalCorrelation) { const k = `global-correlation-${weekKey}`; aiCache[k] = { data: parsed.globalCorrelation, timestamp: tsNow }; lsSet(k, { data: parsed.globalCorrelation, timestamp: tsNow }); }
      if (parsed.fomcSentiment) { const k = `fomc-sentiment-${weekKey}`; aiCache[k] = { data: parsed.fomcSentiment, timestamp: tsNow }; lsSet(k, { data: parsed.fomcSentiment, timestamp: tsNow }); }

      return parsed;
    } catch (error) {
      console.error("Error in getBatchMarketIntel:", error);
      return {
        globalCorrelation: {
          kospiSp500: 0.7, kospiNikkei: 0.55, kospiShanghai: 0.4, kospiDxy: -0.45,
          isDecoupling: false, isGlobalSync: false, lastUpdated: requestedAtISO,
        },
        fomcSentiment: {
          hawkDovishScore: 0, keyPhrases: [], dotPlotShift: 'UNCHANGED',
          kospiImpact: 'NEUTRAL', rationale: 'FOMC 감성 분석 실패. 기본값 적용.', lastUpdated: requestedAtISO,
        },
      };
    }
  });
}

// ─── 아이디어 2: 경기 레짐 자동 분류기 (Economic Regime Classifier) ──────────

/**
 * Gemini + Google Search 기반으로 현재 한국 경기 사이클 레짐을 분류합니다.
 * RECOVERY → EXPANSION → SLOWDOWN → RECESSION 4단계 중 하나를 반환하며,
 * 현재 레짐에 부합하는 허용 섹터 화이트리스트를 함께 제공합니다.
 */
export async function getEconomicRegime(): Promise<EconomicRegimeData> {
  const todayDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const cacheKey = `economic-regime-${todayDate}`;
  // 배치 캐시에서 읽음 — 별도 Google Search 없음 (Search 1회 절약)
  return getCachedAIResponse<EconomicRegimeData>(cacheKey, async () => {
    const batch = await getBatchGlobalIntel();
    return batch.regime;
  });
}

// ─── 아이디어 4: Smart Money Radar (글로벌 ETF 선행 모니터) ──────────────────

/**
 * EWY·MTUM·EEMV·IYW·ITA 5개 ETF의 주간 자금흐름을 분석해
 * Smart Money Flow Score(0-10)를 산출합니다.
 * EWY + MTUM 동반 유입 감지 시 → Gate 2 통과 기준 선제 완화 신호를 반환합니다.
 */
export async function getSmartMoneyFlow(): Promise<SmartMoneyData> {
  const todayDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const cacheKey = `smart-money-${todayDate}`;
  // 배치 캐시에서 읽음 — 별도 Google Search 없음 (Search 1회 절약)
  return getCachedAIResponse<SmartMoneyData>(cacheKey, async () => {
    const batch = await getBatchGlobalIntel();
    return batch.smartMoney;
  });
}

// ─── 아이디어 5: 수출 선행지수 섹터 로테이션 엔진 ────────────────────────────

/**
 * 한국 주요 수출 품목(반도체·선박·자동차·석유화학·방산)의 YoY 증감률을 조회해
 * 수출 모멘텀 섹터를 분류하고 Gate 2 완화·스코어 가산 조건을 반환합니다.
 */
export async function getExportMomentum(): Promise<ExportMomentumData> {
  const requestedAt = new Date();
  const yearMonth = requestedAt.toISOString().slice(0, 7); // "2026-04"
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
    현재 날짜: ${requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}

    한국 산업통상자원부 또는 관세청의 최근 수출 데이터를 구글 검색으로 조회해줘.
    아래 5개 주요 수출 품목의 전년 동기 대비(YoY) 증감률을 확인해줘.

    품목: 반도체, 선박, 자동차, 석유화학, 방산(무기·방산 수출)

    분류 기준:
    - isHot = true: YoY 증가율 > 10% 또는 해당 품목 수출이 전체 수출 증가를 주도
    - shipyardBonus: 선박 수출 YoY ≥ +30%
    - semiconductorGate2Relax: 반도체 수출 3개월 연속 YoY 증가

    응답 형식 (JSON only):
    {
      "hotSectors": ["반도체", "조선"],
      "products": [
        { "product": "반도체", "sector": "반도체/IT", "yoyGrowth": 18.5, "isHot": true, "consecutiveGrowthMonths": 4 },
        { "product": "선박", "sector": "조선", "yoyGrowth": 32.1, "isHot": true },
        { "product": "자동차", "sector": "자동차/부품", "yoyGrowth": 5.2, "isHot": false },
        { "product": "석유화학", "sector": "석유화학", "yoyGrowth": -3.1, "isHot": false },
        { "product": "방산", "sector": "방위산업", "yoyGrowth": 25.0, "isHot": true }
      ],
      "shipyardBonus": true,
      "semiconductorGate2Relax": true,
      "lastUpdated": "${requestedAtISO}"
    }
  `;

  const cacheKey = `export-momentum-${yearMonth}`;

  return getCachedAIResponse<ExportMomentumData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as ExportMomentumData;
    } catch (error) {
      console.error("Error getting export momentum:", error);
      return {
        hotSectors: [],
        products: [],
        shipyardBonus: false,
        semiconductorGate2Relax: false,
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 아이디어 7: 지정학 리스크 스코어링 모듈 (Geopolitical Risk Engine) ──────

/**
 * Gemini Google Search로 지정학 키워드를 분석해
 * Geopolitical Opportunity Score(GOS 0-10)를 산출합니다.
 * GOS ≥ 7: 방산·조선·원자력 Gate 3 완화 / GOS ≤ 3: Kelly 30% 하향
 */
export async function getGeopoliticalRiskScore(): Promise<GeopoliticalRiskData> {
  const requestedAt = new Date();
  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
    현재 날짜: ${requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}

    아래 4가지 지정학 키워드에 대한 최신 뉴스 동향을 분석해줘:
    1. "한반도 안보 리스크" 또는 "북한 도발" 또는 "한미동맹"
    2. "NATO 방산 예산" 또는 "유럽 국방비 증액"
    3. "원자력 에너지 정책" 또는 "SMR 소형원전 수출"
    4. "한국 조선 수주 잔고" 또는 "LNG선 수주"

    각 키워드의 최신 뉴스 기사 톤을 분석해:
    - 긍정적 (방산·조선·원자력 섹터 수혜 예상)
    - 중립적
    - 부정적 (리스크 증가)

    GOS 점수 기준 (0-10):
    - 기본 5점
    - NATO/유럽 방산 예산 증가 뉴스: +2점
    - 원자력/SMR 수출 기회: +1점
    - 조선 수주 호조: +1점
    - 한반도 긴장 고조 (직접 충돌 위협): -2점
    - 지정학 불확실성 극도로 높음: -3점

    응답 형식 (JSON only):
    {
      "score": 7,
      "level": "OPPORTUNITY",
      "affectedSectors": ["방위산업", "조선", "원자력"],
      "headlines": [
        "NATO, 2025년 국방비 GDP 2% 이상 달성 회원국 18개국으로 증가",
        "한국 HD현대重, 유럽 LNG선 4척 추가 수주 — 수주잔고 역대 최대",
        "체코 원전 수주 확정 — 한국수력원자력 2조원 프로젝트 착수"
      ],
      "toneBreakdown": { "positive": 70, "neutral": 20, "negative": 10 },
      "lastUpdated": "${requestedAtISO}"
    }
  `;

  const cacheKey = `geo-risk-${weekKey}`;

  return getCachedAIResponse<GeopoliticalRiskData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as GeopoliticalRiskData;
    } catch (error) {
      console.error("Error getting geopolitical risk score:", error);
      return {
        score: 5,
        level: 'NEUTRAL',
        affectedSectors: ['방위산업', '조선', '원자력'],
        headlines: [],
        toneBreakdown: { positive: 33, neutral: 34, negative: 33 },
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 아이디어 9: 크레딧 스프레드 조기 경보 시스템 ────────────────────────────

export async function getCreditSpreads(): Promise<CreditSpreadData> {
  const requestedAt = new Date();
  const requestedAtISO = requestedAt.toISOString();
  // 주 1회 캐시 (월요일 기준 주차 키)
  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil((requestedAt.getDate() - requestedAt.getDay() + 1) / 7).toString().padStart(2, '0')}`;

  const prompt = `
    You are a fixed income market analyst. Search for the latest credit spread data and return a JSON object.

    Search for:
    1. "한국 AA- 회사채 스프레드" or "Korea AA- corporate bond spread basis points 2025"
    2. "ICE BofA US High Yield OAS spread 2025" or "US HY spread basis points"
    3. "JPMorgan EMBI+ spread emerging market bond spread 2025"

    Interpret the trend:
    - WIDENING: spreads increased more than 10bp in past month (credit stress)
    - NARROWING: spreads decreased more than 10bp in past month (liquidity expanding)
    - STABLE: within ±10bp range

    isCrisisAlert: true if krCorporateSpread >= 150bp
    isLiquidityExpanding: true if trend === 'NARROWING' AND krCorporateSpread < 100

    Return ONLY valid JSON (no markdown):
    {
      "krCorporateSpread": <number, bp>,
      "usHySpread": <number, bp>,
      "embiSpread": <number, bp>,
      "isCrisisAlert": <boolean>,
      "isLiquidityExpanding": <boolean>,
      "trend": "WIDENING" | "NARROWING" | "STABLE",
      "lastUpdated": "${requestedAtISO}"
    }

    Example realistic values (search for actual current data):
    {
      "krCorporateSpread": 68,
      "usHySpread": 320,
      "embiSpread": 380,
      "isCrisisAlert": false,
      "isLiquidityExpanding": false,
      "trend": "STABLE",
      "lastUpdated": "${requestedAtISO}"
    }
  `;

  const cacheKey = `credit-spread-${weekKey}`;

  return getCachedAIResponse<CreditSpreadData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as CreditSpreadData;
    } catch (error) {
      console.error("Error getting credit spreads:", error);
      return {
        krCorporateSpread: 70,
        usHySpread: 330,
        embiSpread: 390,
        isCrisisAlert: false,
        isLiquidityExpanding: false,
        trend: 'STABLE',
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 정량 스크리닝 엔진 (Quantitative Screening Engine) ──────────────────────
// 뉴스 의존 없이 순수 수치 데이터로 이상 신호 종목을 발굴합니다.
// Yahoo Finance OHLCV + KIS 수급 + DART 공시를 결합하여 AI가 모르는 종목도 포착.

/**
 * 정량 스크리닝: AI 검색 없이 수치 기반으로 이상 신호 종목을 발굴.
 * 1단계: 전종목 기본 필터 (시총, 거래대금, 관리종목 제외)
 * 2단계: 이상 신호 감지 (거래량 급증, 외국인/기관 매집, 신고가 근접, VCP 등)
 * 3단계: AI 정밀 분석 (뉴스가 아니라 "왜 수치가 변했는지" 분석)
 */
export async function runQuantitativeScreening(options?: {
  minMarketCap?: number;     // 최소 시총 (억원, 기본 1000)
  minTurnover?: number;      // 최소 거래대금 (억원, 기본 10)
  maxResults?: number;        // 최대 결과 수 (기본 30)
}): Promise<QuantScreenResult[]> {
  const todayDate = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  const minCap = options?.minMarketCap ?? 1000;
  const minTurnover = options?.minTurnover ?? 10;
  const maxResults = options?.maxResults ?? 30;

  const prompt = `
현재 한국 날짜: ${todayDate}

당신은 정량 스크리너입니다. 뉴스·테마·인기도와 무관하게, 순수 수치 이상 신호만으로 종목을 발굴해야 합니다.
Google 검색을 통해 아래 조건을 충족하는 종목을 최대 ${maxResults}개 찾아주세요.

[1단계: 기본 필터]
- 시가총액 > ${minCap}억원
- 일평균 거래대금(20일) > ${minTurnover}억원
- 관리종목/투자경고/적자기업 제외

[2단계: 이상 신호 감지 - 다음 중 2개 이상 충족 종목]
검색 키워드를 활용하여 아래 신호를 감지하라:
1. "거래량 급증 종목 코스피 코스닥 ${todayDate}" - 20일 평균 대비 300% 이상 거래량 급증
2. "외국인 기관 동시 순매수 종목 ${todayDate}" - 외국인+기관 3일 이상 연속 순매수 전환
3. "52주 신고가 근접 종목 한국" - 52주 고가 대비 95% 이상 도달
4. "볼린저밴드 수축 종목 한국" - VCP 패턴 (변동성 수축 3단계 이상)
5. "공매도 잔고 급감 종목 한국" - 공매도 비중 20일 전 대비 30% 이상 감소
6. "자사주 매입 결정 공시 ${todayDate}" - 최근 5일 이내 자사주 취득 공시
7. "대주주 임원 주식 매수 공시 한국" - 최근 10일 이내 내부자 매수
8. "대규모 수주 공시 한국 ${todayDate}" - 매출 대비 10% 이상 수주
9. "대규모 설비투자 유형자산 취득 공시 한국" - 대규모 CAPEX 공시

[핵심 원칙]
- 뉴스가 많이 나온 인기 종목은 오히려 감점 (newsFrequencyScore 낮게)
- 뉴스가 거의 없지만 수치적 이상 신호가 있는 종목을 최우선
- 대형주보다 중소형주에서 이상 신호가 더 의미 있음
- 이미 최근 1주일 30% 이상 급등한 종목은 제외

[뉴스 빈도 역지표 채점 기준]
- 최근 30일 뉴스 0~2건: newsFrequencyScore = 10 (Silent Phase → 최고 점수)
- 최근 30일 뉴스 3~5건: 8 (Early Phase)
- 최근 30일 뉴스 6~15건: 5 (Growing Attention)
- 최근 30일 뉴스 16~30건: 3 (Crowded)
- 최근 30일 뉴스 30건 이상: 1 (Over-hyped → 감점)

응답 형식 (JSON only, 배열):
[
  {
    "code": "005930",
    "name": "종목명",
    "marketCap": 5000,
    "price": 75000,
    "signals": [
      { "type": "VOLUME_SURGE", "strength": 8, "description": "20일 평균 대비 450% 거래량 급증" },
      { "type": "INSTITUTIONAL_ACCUMULATION", "strength": 7, "description": "기관 5일 연속 소량 순매수" }
    ],
    "totalSignalScore": 75,
    "newsFrequencyScore": 9,
    "silentAccumulationScore": 7,
    "volumeProfile": {
      "current": 1500000,
      "avg20d": 300000,
      "ratio": 5.0,
      "trend": "SURGING"
    },
    "pricePosition": {
      "distanceFrom52wHigh": -3.2,
      "distanceFrom52wLow": 45.5,
      "aboveMA200": true,
      "aboveMA60": true
    },
    "institutionalFlow": {
      "foreignNet5d": 25000,
      "institutionNet5d": 15000,
      "foreignConsecutive": 3,
      "isQuietAccumulation": true
    },
    "source": "QUANT_SCREEN"
  }
]
  `.trim();

  const cacheKey = `quant-screening-${todayDate}`;

  return getCachedAIResponse<QuantScreenResult[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            maxOutputTokens: 8000,
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as QuantScreenResult[];
    } catch (error) {
      console.error("Error in quantitative screening:", error);
      return [];
    }
  });
}

// ─── DART 공시 Pre-News 스크리너 ────────────────────────────────────────────
// 뉴스가 되기 전에 DART 공시에서 투자 단서를 선행 포착합니다.
// 공시 → 뉴스 → 주가 반영의 1~3일 시간차를 활용.

/**
 * DART 공시 자동 스캔: 최근 주요 공시 중 아직 뉴스화되지 않은 투자 신호를 포착.
 * 수주/설비투자/자사주/내부자매수/특허 등 핵심 공시를 자동 감지.
 */
export async function scanDartDisclosures(options?: {
  daysBack?: number;          // 최근 N일 공시 스캔 (기본 5)
  minSignificance?: number;   // 최소 중요도 (기본 5)
  maxResults?: number;         // 최대 결과 수 (기본 20)
}): Promise<DartScreenerResult[]> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const daysBack = options?.daysBack ?? 5;
  const minSig = options?.minSignificance ?? 5;
  const maxResults = options?.maxResults ?? 20;

  // DART API로 직접 공시 목록 수집 (Search 대체)
  const bgn = new Date(requestedAt.getTime() - daysBack * 86400_000);
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  let dartListText = '';
  try {
    const dartRes = await fetch(`/api/dart/list?bgn_de=${fmtDate(bgn)}&end_de=${fmtDate(requestedAt)}&pblntf_ty=B001`);
    if (dartRes.ok) {
      const dartData = await dartRes.json();
      const items: any[] = dartData.list ?? [];
      // 핵심 필드만 추출해서 AI에 전달
      const compact = items.slice(0, 60).map((it: any) =>
        `[${it.rcept_dt}] ${it.corp_name}(${it.stock_code ?? '?'}) — ${it.report_nm}`
      ).join('\n');
      dartListText = compact || '(공시 목록 없음)';
    }
  } catch { /* fallback to empty */ }

  const prompt = `
현재 한국 날짜: ${todayDate}

당신은 DART 공시 분석 전문가입니다. 아래는 DART API에서 직접 수집한 최근 ${daysBack}일 이내 주요사항보고서(B001) 목록입니다.
Google 검색 없이 이 목록만으로 분석하세요.

[DART API 실데이터 — 주요사항보고서 목록]
${dartListText || '(DART API 수집 실패 — AI 지식 기반으로 추정)'}

위 공시 중 주가에 중요한 영향을 줄 수 있는 공시를 골라 아래 기준으로 채점하세요.

[중요도 채점 기준]
- 대규모 수주 (매출 대비 20%+): 10점 / 단일판매·공급계약체결: 8점
- 유형자산 취득 (설비투자, 매출 대비 10%+): 8점
- 자기주식 취득 결정 (발행주식 1%+): 8점
- 자기주식 소각 결정: 9점
- 최대주주 변경 (경영권 인수): 8점
- 타법인 주식 및 출자증권 취득결정 (M&A/신사업): 7점
- CB 전환가 하향 조정: 6점

[Pre-News 점수 기준 (0-10)]
- 공시 후 48시간 이내: preNewsScore = 9~10
- 공시 후 3~5일: 5~7
- 공시 후 5일 초과: 2

종목별로 그룹화하여, 최대 ${maxResults}개 종목에 대해 중요도 ${minSig} 이상 공시만 포함.

응답 형식 (JSON only, 배열):
[
  {
    "code": "329180",
    "name": "종목명",
    "disclosures": [
      {
        "type": "LARGE_ORDER",
        "title": "단일판매·공급계약체결(자율공시) - 1,200억원 규모",
        "date": "2026-04-05",
        "significance": 9,
        "revenueImpact": 25.3,
        "description": "연매출 대비 25% 규모의 대형 수주. 수주잔고 역대 최대 갱신.",
        "dartUrl": ""
      }
    ],
    "totalScore": 85,
    "preNewsScore": 9,
    "daysSinceDisclosure": 1,
    "isActionable": true,
    "lastUpdated": "${requestedAtISO}"
  }
]
  `.trim();

  const cacheKey = `dart-screener-${todayDate}`;

  return getCachedAIResponse<DartScreenerResult[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            // googleSearch 제거: DART API 실데이터 직접 주입
            maxOutputTokens: 8000,
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as DartScreenerResult[];
    } catch (error) {
      console.error("Error in DART disclosure screening:", error);
      return [];
    }
  });
}

// ─── 조용한 매집 감지기 (Silent Accumulation Detector) ───────────────────────
// 주도주가 되기 전 단계의 특징적 패턴을 수치로 포착합니다.
// VWAP/거래량/기관수급/공매도/내부자 매수 등 복합 신호를 종합.

/**
 * 특정 종목 리스트에 대해 조용한 매집 패턴을 분석합니다.
 * 정량 스크리닝 결과 또는 관심 종목에 대해 실행.
 */
export async function detectSilentAccumulation(
  stockCodes: { code: string; name: string }[],
): Promise<SilentAccumulationResult[]> {
  if (stockCodes.length === 0) return [];

  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  // KIS 수급 데이터 병렬 수집 → Search 0회
  const kisResults = await Promise.allSettled(
    stockCodes.map(s => Promise.all([
      fetchKisSupply(s.code),
      fetchKisShortSelling(s.code),
    ]))
  );

  // 종목별 KIS 데이터 블록 생성
  const kisDataBlocks = stockCodes.map((s, i) => {
    const res = kisResults[i];
    if (res.status !== 'fulfilled') return `${s.name}(${s.code}): KIS 조회 실패`;
    const [supply, short] = res.value;
    const lines: string[] = [`▸ ${s.name}(${s.code})`];
    if (supply) {
      lines.push(`  기관 5일 순매수 합계: ${supply.institutionNet.toLocaleString()}주`);
      lines.push(`  외인 5일 순매수 합계: ${supply.foreignNet.toLocaleString()}주`);
      lines.push(`  기관 일별 순매수: [${(supply.institutionalDailyAmounts ?? []).join(', ')}]`);
      lines.push(`  외인+기관 동반매수: ${supply.isPassiveAndActive ? 'YES' : 'NO'}`);
    } else {
      lines.push('  KIS 수급 데이터 없음');
    }
    if (short) {
      lines.push(`  공매도 비율: ${(short as any).currentRatio?.toFixed(2) ?? '?'}%`);
      lines.push(`  공매도 추세: ${(short as any).trend ?? '?'}`);
    }
    return lines.join('\n');
  }).join('\n\n');

  const prompt = `
현재 한국 날짜: ${todayDate}

다음 종목들에 대해 "조용한 매집" 패턴을 분석해주세요. Google 검색 없이 아래 KIS 실데이터로 분석하세요.

[KIS API 실데이터 — 수급 및 공매도]
${kisDataBlocks}

위 데이터를 기반으로 각 종목의 매집 신호를 평가하세요:

[신호 1: 기관 소량 분할 매수 (INSTITUTIONAL_QUIET_BUY)]
- 기관 5일 순매수 합계 > 0 이고, 일별 순매수가 대부분 양수(연속 소량 매수)
- 가중치: 외인+기관 동반매수(YES)이면 강도 +2

[신호 2: 공매도 잔고 감소 (SHORT_DECREASE)]
- 공매도 추세가 DECREASING이면 감지

[신호 3: 외인 선행 매수 (VWAP_ABOVE_CLOSE 대리)]
- 외인 5일 순매수 합계 > 0 이고 기관도 순매수이면 Dark Pool 가능성

[신호 4~7: AI 지식 기반 판단]
- INSIDER_BUY, BUYBACK_ACTIVE: 해당 종목의 최근 DART 공시 지식으로 추정
- PRICE_FLOOR_RISING: 기관 연속 매수 패턴과 공매도 감소 조합으로 판단
- CALL_OI_SURGE: 섹터 ETF 옵션 동향 지식으로 추정

[종합 점수 계산]
- 각 신호 0-10점, 총합을 100점 만점으로 정규화
- 3개 이상 신호 감지: HIGH 확신 / 2개: MEDIUM / 1개 이하: LOW

[매집 단계 판정]
- EARLY(1-2개), MID(3-4개), LATE(5개+), NONE(0개)

응답 형식 (JSON only, 배열):
[
  {
    "code": "005930",
    "name": "종목명",
    "signals": [
      { "type": "INSTITUTIONAL_QUIET_BUY", "strength": 7, "description": "기관 7일 연속 소량 순매수 (일 평균 3,000주)", "daysDetected": 7 },
      { "type": "SHORT_DECREASE", "strength": 6, "description": "공매도 잔고 20일 전 대비 -42% 감소", "daysDetected": 20 }
    ],
    "compositeScore": 65,
    "confidenceLevel": "MEDIUM",
    "estimatedAccumulationDays": 15,
    "priceFloorTrend": "RISING",
    "volumeTrend": "DRYING",
    "accumulationPhase": "MID",
    "lastUpdated": "${requestedAtISO}"
  }
]
  `.trim();

  const cacheKey = `silent-accum-${stockCodes.map(s => s.code).sort().join('-')}-${todayDate}`;

  return getCachedAIResponse<SilentAccumulationResult[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            // googleSearch 제거: KIS 수급 실데이터 직접 주입
            maxOutputTokens: 8000,
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as SilentAccumulationResult[];
    } catch (error) {
      console.error("Error detecting silent accumulation:", error);
      return [];
    }
  });
}

// ─── 정량 스크리닝 통합 파이프라인 ───────────────────────────────────────────
// QUANT_SCREEN 모드: 정량 스크리닝 → DART 공시 → 조용한 매집 → AI 정밀 분석

async function runQuantScreenPipeline(filters?: StockFilters): Promise<RecommendationResponse | null> {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  try {
    // 1단계: 정량 스크리닝 + DART 공시 병렬 실행
    console.log('[QUANT_SCREEN] 1단계: 정량 스크리닝 + DART 공시 병렬 스캔...');
    const [quantResults, dartResults] = await Promise.all([
      runQuantitativeScreening({
        minMarketCap: filters?.minMarketCap ?? 1000,
        maxResults: 30,
      }),
      scanDartDisclosures({ daysBack: 5, minSignificance: 5, maxResults: 20 }),
    ]);

    // 2단계: 두 소스에서 종목 통합 및 중복 제거
    const stockMap = new Map<string, {
      code: string; name: string;
      quantScore: number; dartScore: number;
      newsFreqScore: number; signals: string[];
    }>();

    for (const q of quantResults) {
      stockMap.set(q.code, {
        code: q.code, name: q.name,
        quantScore: q.totalSignalScore,
        dartScore: 0,
        newsFreqScore: q.newsFrequencyScore,
        signals: q.signals.map(s => s.description),
      });
    }

    for (const d of dartResults) {
      const existing = stockMap.get(d.code);
      if (existing) {
        existing.dartScore = d.totalScore;
        existing.signals.push(...d.disclosures.map(disc => `[공시] ${disc.title}`));
      } else {
        stockMap.set(d.code, {
          code: d.code, name: d.name,
          quantScore: 0, dartScore: d.totalScore,
          newsFreqScore: 8, // DART에서만 발견 → 뉴스 적은 편
          signals: d.disclosures.map(disc => `[공시] ${disc.title}`),
        });
      }
    }

    // 3단계: 종합 점수 계산 및 상위 10개 선별
    const candidates = Array.from(stockMap.values())
      .map(s => ({
        ...s,
        combinedScore: s.quantScore * 0.4 + s.dartScore * 0.3 + s.newsFreqScore * 3, // 뉴스 적을수록 보너스
      }))
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, 10);

    if (candidates.length === 0) {
      return {
        marketContext: {
          kospi: { index: 0, change: 0, changePercent: 0, status: 'NEUTRAL', analysis: '정량 스크리닝 결과 없음' },
          kosdaq: { index: 0, change: 0, changePercent: 0, status: 'NEUTRAL', analysis: '' },
        },
        recommendations: [],
      };
    }

    // 4단계: 조용한 매집 감지 (상위 후보에 대해)
    console.log(`[QUANT_SCREEN] 4단계: 상위 ${candidates.length}개 종목 조용한 매집 분석...`);
    const accumResults = await detectSilentAccumulation(
      candidates.map(c => ({ code: c.code, name: c.name }))
    );
    const accumMap = new Map(accumResults.map(a => [a.code, a]));

    // 5단계: AI 정밀 분석 — 수치가 변한 이유 분석
    console.log('[QUANT_SCREEN] 5단계: AI 정밀 분석...');
    const candidateList = candidates.map(c => {
      const accum = accumMap.get(c.code);
      return `${c.name}(${c.code}): 정량점수=${c.quantScore}, 공시점수=${c.dartScore}, 뉴스빈도역점수=${c.newsFreqScore}, 매집단계=${accum?.accumulationPhase ?? 'N/A'}, 신호=[${c.signals.slice(0, 3).join('; ')}]`;
    }).join('\n');

    const analysisPrompt = `
현재 한국 시각: ${now}

당신은 정량 스크리닝 결과를 바탕으로 최종 분석을 수행합니다.
아래 종목들은 뉴스가 아닌 순수 수치 이상 신호와 DART 공시로 발굴된 종목입니다.

[후보 종목]
${candidateList}

각 종목에 대해:
1. Google 검색으로 현재가, 시가총액, 기본 재무 데이터를 확인
2. 수치 변동의 근본 원인을 분석 (뉴스가 아닌 비즈니스 변화 원인)
3. 27개 체크리스트 항목을 최대한 평가
4. 기존 getStockRecommendations와 동일한 JSON 형식으로 응답

[핵심 차별점]
- 이 종목들은 뉴스 인기도가 아닌 수치 이상 신호로 발굴됨
- "왜 거래량이 변했는가", "왜 기관이 매집하는가", "공시의 실질적 임팩트는 무엇인가"를 분석
- 뉴스가 아직 없는 종목일수록 더 높은 잠재력을 가진 것으로 평가

응답은 기존 recommendations JSON 형식과 동일하게 작성하되,
각 종목의 dataSourceType을 "QUANT_SCREEN"으로 설정하라.
최대 5개까지만 최종 추천하라.

응답 형식: 기존 getStockRecommendations와 동일한 JSON
    `.trim();

    const response = await withRetry(async () => {
      return await getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: analysisPrompt,
        config: {
          tools: [{ googleSearch: {} }],
          maxOutputTokens: 12000,
          temperature: 0.1,
        },
      });
    }, 2, 2000);

    const text = response.text;
    if (!text) throw new Error("No response from AI for quant screen analysis");
    const parsed = safeJsonParse(text);

    if (parsed && !parsed.recommendations) {
      parsed.recommendations = [];
    }

    // Enrich with real data
    if (parsed && parsed.recommendations.length > 0) {
      console.log(`[QUANT_SCREEN] Enriching ${parsed.recommendations.length} recommendations...`);
      const enriched = [];
      for (const stock of parsed.recommendations) {
        try {
          // 매집 데이터 주입
          const accum = accumMap.get(stock.code);
          if (accum) {
            stock.anomalyDetection = {
              type: accum.compositeScore > 50 ? 'SMART_MONEY_ACCUMULATION' : 'NONE',
              score: accum.compositeScore,
              description: `매집단계: ${accum.accumulationPhase}, 확신도: ${accum.confidenceLevel}, 추정 매집기간: ${accum.estimatedAccumulationDays}일`,
            };
          }
          stock.dataSourceType = 'QUANT_SCREEN' as any;
          const enrichedStock = await enrichStockWithRealData(stock);
          enriched.push(enrichedStock);
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
          console.error(`[QUANT_SCREEN] Failed to enrich ${stock.name}:`, err);
          enriched.push(stock);
        }
      }
      parsed.recommendations = enriched;
    }

    return parsed;
  } catch (error) {
    console.error("[QUANT_SCREEN] Pipeline error:", error);
    throw error;
  }
}

// ─── 확장 레짐 분류기 (Extended Regime Classifier) ───────────────────────────
// 기존 4단계에 UNCERTAIN/CRISIS/RANGE_BOUND를 추가하여 7단계로 확장.
// 글로벌 소스 확장 및 상관관계 분석 포함.

/**
 * 확장 경기 레짐 분류: 기존 getEconomicRegime + 불확실성 메트릭 추가.
 * 글로벌 소스를 폭넓게 참조하여 한국 시장 특수 상황을 감지합니다.
 */
export async function getExtendedEconomicRegime(): Promise<ExtendedRegimeData> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 한국 날짜: ${todayDate}

아래 7가지 경기 사이클 중 현재 한국 경제가 어디에 해당하는지 분류해줘.
구글 검색을 통해 최신 실제 데이터를 기반으로 판단해야 해.

분류 기준 (확장 7단계):
- RECOVERY (회복기): GDP 성장 반등, 수출 증가 시작, 금리 인하 또는 동결, OECD CLI ≥ 100 상승 전환
- EXPANSION (확장기): GDP 성장 가속, 수출 호조, 금리 동결 또는 소폭 인상, CLI 상승 지속
- SLOWDOWN (둔화기): GDP 성장 둔화, 수출 증가율 감소, 금리 인상 또는 동결, CLI 하락
- RECESSION (침체기): GDP 역성장 또는 제로, 수출 급감, CLI 급락, 신용 위기 징후
- UNCERTAIN (불확실): 지표 혼조, 매크로 신호 상충, 방향성 불명확, 주도 섹터 부재
- CRISIS (위기): VKOSPI > 35, VIX > 30, 외부 충격(전쟁/금융위기), 신용스프레드 급등
- RANGE_BOUND (박스권): KOSPI 60일 변동성 < 5%, 뚜렷한 주도 섹터 없음, 외국인 매수/매도 교차

조회할 데이터 (기존 + 확장):
[기존]
1. 한국 최근 수출 증가율 (전년 동월 대비, 3개월 이동평균)
2. 한국은행 기준금리 현재 수준 및 방향
3. OECD 경기선행지수(CLI) 한국 최신
4. 한국 최근 분기 GDP 성장률

[확장 - 글로벌 소스]
5. VKOSPI 현재값 및 20일 이동평균
6. VIX 현재값
7. KOSPI 60일 변동성 (표준편차 기반)
8. 최근 5일 주도 섹터 수 (KOSPI 업종별 상승률 상위 3개 섹터가 명확한지)
9. 외국인 최근 5일 순매수 패턴 (일관된 매수/매도 vs 교차)
10. KOSPI-S&P500 30일 상관계수 (정상: 0.6-0.8, 디커플링: <0.3, 동조화: >0.9)
11. CME FedWatch 금리 전망 (다음 FOMC 금리 동결/인하 확률)
12. 중국 PMI 최신값 (한국 수출 선행지표)
13. 대만 TSMC 월간 매출 추이 (반도체 사이클 선행)
14. 일본 BOJ 정책 최신 동향 (엔캐리 리스크)
15. 미국 ISM 제조업 PMI 최신값
16. 원/달러 환율 현재값

응답 형식 (JSON only):
{
  "regime": "EXPANSION",
  "confidence": 78,
  "rationale": "수출 YoY +12.3%, CLI 101.2 상승 기조...",
  "allowedSectors": ["반도체", "조선", "방산", "바이오", "AI인프라", "자동차"],
  "avoidSectors": ["내수소비재", "항공", "음식료"],
  "keyIndicators": {
    "exportGrowth": "+12.3% YoY",
    "bokRateDirection": "동결 (3.50%)",
    "oeciCli": "101.2",
    "gdpGrowth": "+2.1% QoQ"
  },
  "lastUpdated": "${requestedAtISO}",
  "uncertaintyMetrics": {
    "regimeClarity": 75,
    "signalConflict": 25,
    "kospi60dVolatility": 12.5,
    "leadingSectorCount": 3,
    "foreignFlowDirection": "CONSISTENT_BUY",
    "correlationBreakdown": false
  },
  "systemAction": {
    "mode": "NORMAL",
    "cashRatio": 20,
    "gateAdjustment": { "gate1Threshold": 5, "gate2Required": 9, "gate3Required": 7 },
    "message": "정상 시장. 기본 Gate 기준 적용."
  }
}
  `.trim();

  const cacheKey = `extended-regime-${todayDate}`;

  return getCachedAIResponse<ExtendedRegimeData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as ExtendedRegimeData;
    } catch (error) {
      console.error("Error getting extended economic regime:", error);
      return {
        regime: 'EXPANSION',
        confidence: 50,
        rationale: "데이터 조회 실패. 기본값(확장기)으로 설정됨.",
        allowedSectors: ["반도체", "조선", "방산"],
        avoidSectors: [],
        keyIndicators: {
          exportGrowth: "N/A",
          bokRateDirection: "N/A",
          oeciCli: "N/A",
          gdpGrowth: "N/A",
        },
        lastUpdated: requestedAtISO,
        uncertaintyMetrics: {
          regimeClarity: 50,
          signalConflict: 50,
          kospi60dVolatility: 0,
          leadingSectorCount: 0,
          foreignFlowDirection: 'ALTERNATING',
          correlationBreakdown: false,
        },
        systemAction: {
          mode: 'DEFENSIVE',
          cashRatio: 50,
          gateAdjustment: { gate1Threshold: 6, gate2Required: 10, gate3Required: 8 },
          message: '데이터 수집 실패. 방어적 모드로 전환.',
        },
      };
    }
  });
}

// ─── 거시 환경 자동 수집 (Gate 0 입력) ────────────────────────────────────────
export async function fetchMacroEnvironment(): Promise<MacroEnvironment> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const cacheKey = `macro-environment-${todayDate}`;

  return getCachedAIResponse<MacroEnvironment>(cacheKey, async () => {
    const prompt = `
현재 한국 날짜: ${todayDate}

아래 12개 거시 지표의 최신 실제 값을 당신의 학습 데이터 기반으로 추정하여 JSON 하나만 반환해줘.
(마크다운, 설명 없이 JSON만)

수집 대상:
1. 한국은행 기준금리 방향 (최근 결정): "HIKING" | "HOLDING" | "CUTTING"
2. 미국 10년 국채 금리 (%, 최신)
3. 한미 금리 스프레드 (한국 기준금리 - 미국 기준금리, 음수 허용)
4. 한국 M2 통화량 증가율 YoY (%, 최신)
5. 한국 은행 여신(대출) 증가율 YoY (%, 최신)
6. 한국 명목 GDP 성장률 YoY (%, 최신 분기)
7. OECD 경기선행지수 한국 (최신, 100 기준)
8. 한국 수출 증가율 3개월 이동평균 YoY (%, 최신)
9. VKOSPI 현재값
10. 삼성전자 IRI 또는 프로그램 매매 비율 대용값 (0.5~1.5 범위; 중립=1.0)
11. VIX 현재값
12. 원달러 환율 현재값

응답 형식 (JSON only, 추정값 사용 가능):
{
  "bokRateDirection": "HOLDING",
  "us10yYield": 4.35,
  "krUsSpread": -1.25,
  "m2GrowthYoY": 6.2,
  "bankLendingGrowth": 5.1,
  "nominalGdpGrowth": 3.8,
  "oeciCliKorea": 100.4,
  "exportGrowth3mAvg": 11.5,
  "vkospi": 18.2,
  "samsungIri": 0.92,
  "vix": 16.8,
  "usdKrw": 1385.0
}
    `.trim();

    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error('No response from AI');
      return safeJsonParse(text) as MacroEnvironment;
    } catch (_) {
      // 수집 실패 시 보수적 중립 기본값 반환
      return {
        bokRateDirection: 'HOLDING',
        us10yYield: 4.3,
        krUsSpread: -1.25,
        m2GrowthYoY: 6.0,
        bankLendingGrowth: 5.0,
        nominalGdpGrowth: 3.5,
        oeciCliKorea: 100.0,
        exportGrowth3mAvg: 8.0,
        vkospi: 18.0,
        samsungIri: 1.0,
        vix: 18.0,
        usdKrw: 1380.0,
      };
    }
  });
}

// ─── H: 섹터-테마 역추적 엔진 (Theme → Korea Value Chain Reverse Tracking) ──

/**
 * 글로벌 메가트렌드에서 아직 시장이 연결짓지 못한 한국 숨은 수혜주를 역추적.
 * "종목 → 뉴스 검색" 방식을 뒤집어 "테마 → 관련 종목 역추적".
 * DART 사업보고서의 주요 제품/매출 구성을 분석하여 밸류체인을 매핑합니다.
 */
export async function trackThemeToKoreaValueChain(options?: {
  customThemes?: string[];     // 사용자 지정 테마 (없으면 AI가 자동 감지)
  maxThemes?: number;          // 최대 테마 수 (기본 5)
}): Promise<ThemeReverseTrackResult[]> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();
  const maxThemes = options?.maxThemes ?? 5;

  const themeSection = options?.customThemes?.length
    ? `[사용자 지정 테마]\n${options.customThemes.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : `[1단계: 글로벌 메가트렌드 자동 감지]
아래 키워드로 Google 검색하여 최근 2주 이내 급부상하는 글로벌 테마 ${maxThemes}개를 감지하라:
- "global megatrend 2026 emerging technology"
- "US Congress bill passed technology energy defense"
- "EU regulation new policy 2026"
- "China industrial policy subsidy 2026"
- "breakthrough technology commercialization 2026"
- "GLP-1 obesity drug market expansion"
- "SMR small modular reactor contract"
- "low earth orbit satellite constellation"
- "AI infrastructure data center power"
- "solid state battery commercialization"
- "humanoid robot mass production"
- "space economy commercial launch"`;

  const prompt = `
현재 한국 날짜: ${todayDate}

당신은 글로벌 테마 → 한국 밸류체인 역추적 전문가입니다.
핵심 목적: 글로벌 트렌드의 한국 수혜주 중 아직 시장이 연결짓지 못한 '숨은 수혜주'를 발굴.

${themeSection}

[2단계: 한국 밸류체인 역추적]
감지된 각 테마에 대해:
1. Google 검색으로 해당 테마의 글로벌 밸류체인 구조를 파악
2. "DART 사업보고서 [키워드]" 또는 "[키워드] 한국 관련 기업 부품 소재"로 검색
3. 한국 상장기업 중 해당 밸류체인에 속하는 기업을 최대 5개 발굴
4. 각 기업의 시장 인지도를 판별:
   - HIDDEN: 아직 시장이 이 테마와 연결짓지 못함 (뉴스 거의 없음) → 최우선 추천
   - EMERGING: 일부 리포트에서 언급되기 시작 → 초기 진입 가능
   - KNOWN: 이미 시장에서 테마주로 인식 → 이미 반영됨, 후순위

[3단계: 투자 타이밍 판정]
- TOO_EARLY: 글로벌 테마 자체가 아직 불확실 (정책 미확정, 기술 미검증)
- OPTIMAL: 글로벌 정책/기술 확정 + 한국 수혜주 아직 미반영 → 최적 진입
- LATE: 한국에서도 이미 테마주로 인식, 주가 선반영 진행 중
- MISSED: 주가 이미 대폭 상승, 진입 시점 지남

응답 형식 (JSON only, 배열):
[
  {
    "theme": "소형모듈원자로(SMR)",
    "globalTrend": {
      "keyword": "Small Modular Reactor commercialization",
      "source": "미국 에너지부 SMR 상용화 지원법 통과",
      "momentum": "ACCELERATING",
      "globalMarketSize": "$120B by 2035"
    },
    "koreaValueChain": [
      { "company": "두산에너빌리티", "code": "034020", "role": "원전 주기기 제조", "revenueExposure": 35, "marketAttention": "KNOWN", "competitiveEdge": "한국 유일 원전 주기기 EPC" },
      { "company": "비에이치아이", "code": "083650", "role": "열교환기·압력용기 부품", "revenueExposure": 20, "marketAttention": "HIDDEN", "competitiveEdge": "SMR 핵심 부품 납품 이력" },
      { "company": "우진", "code": "105840", "role": "원전 계측기기", "revenueExposure": 40, "marketAttention": "HIDDEN", "competitiveEdge": "국내 유일 원전 계측 전문" }
    ],
    "hiddenGems": [
      { "company": "비에이치아이", "code": "083650", "role": "열교환기·압력용기 부품", "revenueExposure": 20, "marketAttention": "HIDDEN", "competitiveEdge": "SMR 핵심 부품 납품 이력" }
    ],
    "totalCompanies": 3,
    "avgMarketAttention": 33,
    "investmentTiming": "OPTIMAL",
    "lastUpdated": "${requestedAtISO}"
  }
]
  `.trim();

  const cacheKey = `theme-reverse-track-${todayDate}`;

  return getCachedAIResponse<ThemeReverseTrackResult[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            maxOutputTokens: 10000,
            temperature: 0.2,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as ThemeReverseTrackResult[];
    } catch (error) {
      console.error("Error in theme reverse tracking:", error);
      return [];
    }
  });
}

// ─── C: 글로벌 상관관계 매트릭스 (Global Correlation Matrix) ─────────────────

/**
 * KOSPI와 주요 글로벌 지수·자산 간 30일 상관계수를 산출.
 * 디커플링(<0.3) 또는 동조화(>0.9) 감지 시 레짐 판단에 반영됩니다.
 */
export async function getGlobalCorrelationMatrix(): Promise<GlobalCorrelationMatrix> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

다음 지수 쌍의 최근 30거래일 상관계수(correlation coefficient)를 Google 검색으로 추정해줘.
각 지수의 최근 30일 일일 수익률 패턴을 비교하여 상관계수를 산출하라.

계산 대상:
1. KOSPI - S&P500: 정상 범위 0.6~0.8, 디커플링 <0.3, 동조화 >0.9
2. KOSPI - 닛케이225: 정상 범위 0.5~0.7
3. KOSPI - 상해종합: 정상 범위 0.3~0.6
4. KOSPI - 달러인덱스(DXY): 보통 음의 상관 -0.3~-0.6

검색 키워드:
- "KOSPI S&P 500 correlation ${todayDate}"
- "KOSPI 코스피 S&P500 상관계수"
- "코스피 나스닥 동조화 디커플링 ${todayDate}"
- "달러인덱스 DXY 코스피 역상관"
- "코스피 닛케이 상해종합 상관관계"

판별 기준:
- isDecoupling: KOSPI-S&P500 상관계수 < 0.3 (한국 특수 요인 발생)
- isGlobalSync: KOSPI-S&P500 상관계수 > 0.9 (외부 충격 전이 모드)

응답 형식 (JSON only):
{
  "kospiSp500": 0.72,
  "kospiNikkei": 0.58,
  "kospiShanghai": 0.41,
  "kospiDxy": -0.45,
  "isDecoupling": false,
  "isGlobalSync": false,
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `global-correlation-${weekKey}`;

  return getCachedAIResponse<GlobalCorrelationMatrix>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as GlobalCorrelationMatrix;
    } catch (error) {
      console.error("Error getting global correlation matrix:", error);
      return {
        kospiSp500: 0.7,
        kospiNikkei: 0.55,
        kospiShanghai: 0.4,
        kospiDxy: -0.45,
        isDecoupling: false,
        isGlobalSync: false,
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── D: 해외 뉴스 멀티소스 집계 (Global Multi-Source Intelligence) ───────────

/**
 * Fed Watch, 중국 PMI, TSMC 매출, BOJ 정책, 미국 ISM, FRED 데이터를
 * 단일 함수로 집계하여 한국 시장 선행지표로 활용합니다.
 */
export async function getGlobalMultiSourceData(): Promise<GlobalMultiSourceData> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

아래 6개 글로벌 데이터 소스의 최신값을 추정하여 JSON으로 반환해줘.
이 데이터는 한국 증시의 선행지표로 활용됩니다.

[1. CME FedWatch - 미국 금리 전망]
검색: "CME FedWatch tool next FOMC meeting probability ${todayDate}"
- 다음 FOMC 회의 일자
- 금리 동결/인하/인상 확률 (%)

[2. 중국 PMI]
검색: "China PMI manufacturing services latest ${todayDate}"
- 제조업 PMI (50 기준: 위=확장, 아래=수축)
- 서비스업 PMI
- 한국 수출의 25%가 중국 → 중국 PMI는 한국 수출 선행지표

[3. 대만 TSMC 월간 매출]
검색: "TSMC monthly revenue latest ${todayDate}"
- 최근 월 매출 (억 대만달러)
- 전년동월비 성장률 (%)
- 한국 반도체 섹터 가장 강력한 선행지표

[4. 일본 BOJ 정책]
검색: "Bank of Japan BOJ interest rate policy latest ${todayDate}"
- 현재 기준금리
- 금리 방향 (인상/동결/인하)
- 엔캐리 트레이드 청산 리스크 판단

[5. 미국 ISM 제조업/서비스업]
검색: "ISM manufacturing PMI services PMI latest ${todayDate}"
- ISM 제조업 PMI (50 기준)
- ISM 서비스업 PMI
- 신규 주문 지수

[6. FRED 핵심 데이터]
검색: "US CPI unemployment rate retail sales latest"
- 미국 CPI (% YoY)
- 미국 실업률 (%)
- 미국 소매판매 (% MoM)

응답 형식 (JSON only):
{
  "fedWatch": {
    "nextMeetingDate": "2026-05-07",
    "holdProbability": 65,
    "cutProbability": 30,
    "hikeProbability": 5
  },
  "chinaPmi": {
    "manufacturing": 50.8,
    "services": 52.3,
    "trend": "EXPANDING"
  },
  "tsmcRevenue": {
    "monthlyRevenueTWD": 2360,
    "yoyGrowth": 35.2,
    "trend": "ACCELERATING",
    "implication": "AI 수요 급증으로 반도체 슈퍼사이클 진행 중. 한국 반도체 섹터 수혜 지속."
  },
  "bojPolicy": {
    "currentRate": 0.5,
    "direction": "HIKING",
    "yenCarryRisk": "MEDIUM",
    "implication": "BOJ 추가 인상 시 엔캐리 청산으로 한국 외국인 자금 유출 위험."
  },
  "usIsm": {
    "manufacturing": 49.2,
    "services": 53.8,
    "newOrders": 51.5,
    "trend": "FLAT"
  },
  "fredData": {
    "usCpi": 2.8,
    "usUnemployment": 3.9,
    "usRetailSales": 0.4
  },
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const cacheKey = `global-multi-source-${todayDate}`;

  return getCachedAIResponse<GlobalMultiSourceData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as GlobalMultiSourceData;
    } catch (error) {
      console.error("Error getting global multi-source data:", error);
      return {
        fedWatch: { nextMeetingDate: 'N/A', holdProbability: 50, cutProbability: 25, hikeProbability: 25 },
        chinaPmi: { manufacturing: 50, services: 50, trend: 'FLAT' },
        tsmcRevenue: { monthlyRevenueTWD: 0, yoyGrowth: 0, trend: 'STABLE', implication: '데이터 수집 실패' },
        bojPolicy: { currentRate: 0, direction: 'HOLDING', yenCarryRisk: 'LOW', implication: '데이터 수집 실패' },
        usIsm: { manufacturing: 50, services: 50, newOrders: 50, trend: 'FLAT' },
        fredData: { usCpi: 0, usUnemployment: 0, usRetailSales: 0 },
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── I: 뉴스 빈도 역지표 (Contrarian News Frequency Score) ───────────────────

/**
 * 특정 종목 리스트에 대해 뉴스 빈도를 조회하고 역지표 점수를 산출.
 * 뉴스가 적을수록 높은 점수 → AI 주목도 편향을 역이용.
 */
export async function getNewsFrequencyScores(
  stocks: { code: string; name: string }[]
): Promise<NewsFrequencyScore[]> {
  if (stocks.length === 0) return [];

  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];

  const stockList = stocks.map(s => `${s.name}(${s.code})`).join(', ');

  const prompt = `
현재 한국 날짜: ${todayDate}

다음 종목들의 최근 30일간 뉴스 빈도를 추정해주세요: ${stockList}

각 종목에 대해:
1. "[종목명] 뉴스 최근" 검색
2. 검색 결과 수와 최근 30일 기사 건수를 추정
3. 아래 기준으로 역지표 점수를 산출

[뉴스 빈도 역지표 채점]
- 0~2건 → score: 10, phase: "SILENT" (Silent Phase — 최고 점수. 시장 미인지.)
- 3~5건 → score: 8, phase: "EARLY" (Early Phase — 초기 관심. 최적 진입 구간.)
- 6~15건 → score: 5, phase: "GROWING" (Growing Attention — 관심 증가 중.)
- 16~30건 → score: 3, phase: "CROWDED" (Crowded — 이미 시장 관심.)
- 30건+ → score: 1, phase: "OVERHYPED" (Over-hyped — 뉴스 과잉. 주가 선반영 가능성.)

[투자 시사점 작성 규칙]
- SILENT: "시장 미인지 종목. 수치적 이상 신호 발생 시 최우선 분석 대상."
- EARLY: "초기 관심 단계. 뉴스가 본격화되기 전 선제 진입 가능 구간."
- GROWING: "관심 증가 중. 이미 일부 주가 반영 시작. 신중한 진입 필요."
- CROWDED: "시장 관심 과다. 추가 상승 여력 제한적. 차익실현 고려."
- OVERHYPED: "뉴스 과잉. 주가 선반영 완료 가능성. 신규 진입 비추천."

응답 형식 (JSON only, 배열):
[
  { "code": "083650", "name": "비에이치아이", "newsCount30d": 1, "score": 10, "phase": "SILENT", "implication": "시장 미인지 종목. 수치적 이상 신호 발생 시 최우선 분석 대상." }
]
  `.trim();

  const cacheKey = `news-freq-${stocks.map(s => s.code).sort().join('-')}-${todayDate}`;

  return getCachedAIResponse<NewsFrequencyScore[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as NewsFrequencyScore[];
    } catch (error) {
      console.error("Error getting news frequency scores:", error);
      return stocks.map(s => ({
        code: s.code,
        name: s.name,
        newsCount30d: -1,
        score: 5,
        phase: 'GROWING' as const,
        implication: '뉴스 빈도 조회 실패. 기본값 적용.',
      }));
    }
  });
}

// ─── 레이어 I: 공급망 물동량 인텔리전스 (Supply Chain Intelligence) ──────────────

export async function getSupplyChainIntelligence(): Promise<SupplyChainIntelligence> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

아래 3개 공급망 선행지표의 최신값을 추정하여 JSON으로 반환해줘.
한국 조선·반도체·해운 섹터의 선행지표로 활용됩니다.

[1. Baltic Dry Index (BDI) — 벌크 해운 운임 지수]
검색: "Baltic Dry Index today ${todayDate}"
- 현재 BDI 지수
- 3개월 전 대비 변화율 (%)
- 추세 판단: SURGING(+20%이상)/RISING(+5~20%)/FLAT(-5~+5%)/FALLING(-5~-20%)/COLLAPSING(-20%이하)
- 한국 조선/해운 섹터 시사점 (한국어 1줄)

[2. SEMI North America Billings — 반도체 장비 수주]
검색: "SEMI North America semiconductor equipment billings latest ${todayDate}"
검색: "SEMI book-to-bill ratio latest"
- 최근 월 반도체 장비 매출 (십억 달러)
- 전년동월비 성장률 (%)
- Book-to-Bill 비율 (수주/매출, 1.0 이상 = 수요 초과)
- 한국 반도체 시사점 (한국어 1줄)

[3. Global Container Freight Index — 컨테이너 운임]
검색: "Shanghai containerized freight index SCFI latest ${todayDate}"
검색: "Drewry World Container Index"
- 상하이-유럽 운임 ($/40ft)
- 태평양 횡단 운임 ($/40ft)
- 추세: RISING/FLAT/FALLING

응답 형식 (JSON only):
{
  "bdi": { "current": 1850, "mom3Change": 15.2, "trend": "RISING", "sectorImplication": "BDI 3개월 15% 상승 → 벌크선 발주 증가 기대" },
  "semiBillings": { "latestBillionUSD": 3.2, "yoyGrowth": 12.5, "bookToBill": 1.15, "implication": "Book-to-Bill 1.15 → 반도체 업사이클 지속" },
  "gcfi": { "shanghaiEurope": 2800, "transPacific": 3200, "trend": "RISING" },
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `supply-chain-intel-${weekKey}`;

  return getCachedAIResponse<SupplyChainIntelligence>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as SupplyChainIntelligence;
    } catch (error) {
      console.error("Error getting supply chain intelligence:", error);
      return {
        bdi: { current: 0, mom3Change: 0, trend: 'FLAT', sectorImplication: 'BDI 데이터 조회 실패' },
        semiBillings: { latestBillionUSD: 0, yoyGrowth: 0, bookToBill: 1.0, implication: 'SEMI 데이터 조회 실패' },
        gcfi: { shanghaiEurope: 0, transPacific: 0, trend: 'FLAT' },
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 레이어 J: 섹터별 글로벌 수주 인텔리전스 (Sector Order Intelligence) ────────

export async function getSectorOrderIntelligence(): Promise<SectorOrderIntelligence> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

한국 증시 주도주 3대 섹터(조선·방산·원자력)의 글로벌 수주 데이터를 추정하여 JSON으로 반환해줘.

[1. 글로벌 방산 예산 트렌드]
검색: "NATO defense spending GDP percentage ${todayDate}"
검색: "US defense budget FY2025 FY2026"
검색: "Korea K2 tank K9 howitzer export contract ${todayDate}"
- NATO 평균 GDP 대비 국방비 (%)
- 미국 국방예산 (억달러)
- 추세: EXPANDING/STABLE/CUTTING
- 한국 방산 수출 파이프라인 현황 (한국어 1줄)

[2. LNG선 발주 동향]
검색: "LNG carrier newbuilding orders ${todayDate}"
검색: "QatarEnergy LNG ship orders"
검색: "global LNG orderbook months"
- 당해년도 LNG선 신규 발주 척수
- 카타르 에너지 발주 상황 (한국어 1줄)
- 수주잔고 개월수
- 한국 조선 섹터 시사점 (한국어 1줄)

[3. SMR(소형모듈원자로) 글로벌 계약]
검색: "SMR small modular reactor NRC approval ${todayDate}"
검색: "SMR global contract GW capacity"
검색: "Korea Hyundai Engineering SMR"
- 미국 NRC 승인 기수
- 계약 총 용량 (GW)
- 한국 현대엔지니어링 등 참여 현황 (한국어 1줄)
- 투자 타이밍: TOO_EARLY/OPTIMAL/LATE

응답 형식 (JSON only):
{
  "globalDefense": { "natoGdpAvg": 2.1, "usDefenseBudget": 8860, "trend": "EXPANDING", "koreaExposure": "K2전차 폴란드 1000대 + K9자주포 다국적 수출 파이프라인 확대" },
  "lngOrders": { "newOrdersYTD": 45, "qatarEnergy": "카타르 NFE 확장 프로젝트 LNG선 발주 지속", "orderBookMonths": 48, "implication": "수주잔고 4년치 → 한국 조선 3사 매출 가시성 최고" },
  "smrContracts": { "usNrcApprovals": 1, "totalGwCapacity": 12.5, "koreaHyundai": "현대엔지니어링 i-SMR 설계 인가 추진 중", "timing": "TOO_EARLY" },
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `sector-order-intel-${weekKey}`;

  return getCachedAIResponse<SectorOrderIntelligence>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as SectorOrderIntelligence;
    } catch (error) {
      console.error("Error getting sector order intelligence:", error);
      return {
        globalDefense: { natoGdpAvg: 0, usDefenseBudget: 0, trend: 'STABLE', koreaExposure: '데이터 조회 실패' },
        lngOrders: { newOrdersYTD: 0, qatarEnergy: '데이터 조회 실패', orderBookMonths: 0, implication: '데이터 조회 실패' },
        smrContracts: { usNrcApprovals: 0, totalGwCapacity: 0, koreaHyundai: '데이터 조회 실패', timing: 'TOO_EARLY' },
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 레이어 K: 금융시스템 스트레스 인덱스 (Financial Stress Index) ───────────────

export async function getFinancialStressIndex(): Promise<FinancialStressIndex> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

금융시스템 스트레스 조기경보 지표 3개를 추정하여 JSON으로 반환해줘.
이 지표는 한국 증시 Gate 0 (매수 중단) 판단의 핵심 입력입니다.

[1. TED Spread — 은행간 신용리스크]
검색: "TED spread today ${todayDate}"
검색: "3-month LIBOR minus T-Bill spread"
- 현재 bp (정상: 10~50bp, 위험: 100bp+)
- 알림 수준: NORMAL(~50bp)/ELEVATED(50~100bp)/CRISIS(100bp+)

[2. US High Yield Spread — 기업 크레딧]
검색: "US high yield bond spread OAS today ${todayDate}"
검색: "ICE BofA US High Yield Index OAS"
- 현재 bp (정상: 300~400bp, 위험: 600bp+)
- 추세: TIGHTENING/STABLE/WIDENING

[3. MOVE Index — 채권시장 변동성 (채권판 VIX)]
검색: "MOVE index today ${todayDate}"
검색: "ICE BofA MOVE index"
- 현재값 (정상: 80~100, 위험: 150+)
- 알림 수준: NORMAL(~100)/ELEVATED(100~150)/EXTREME(150+)

종합 FSI 계산법:
- compositeScore = (tedSpread가 CRISIS?40:tedSpread가 ELEVATED?20:0) + (usHySpread>600?40:usHySpread>500?20:0) + (moveIndex>150?20:moveIndex>120?10:0)
- systemAction: compositeScore>=60→CRISIS, >=40→DEFENSIVE, >=20→CAUTION, else NORMAL

응답 형식 (JSON only):
{
  "tedSpread": { "bps": 25, "alert": "NORMAL" },
  "usHySpread": { "bps": 350, "trend": "STABLE" },
  "moveIndex": { "current": 95, "alert": "NORMAL" },
  "compositeScore": 0,
  "systemAction": "NORMAL",
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `financial-stress-index-${weekKey}`;

  return getCachedAIResponse<FinancialStressIndex>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as FinancialStressIndex;
    } catch (error) {
      console.error("Error getting financial stress index:", error);
      return {
        tedSpread: { bps: 0, alert: 'NORMAL' },
        usHySpread: { bps: 0, trend: 'STABLE' },
        moveIndex: { current: 0, alert: 'NORMAL' },
        compositeScore: 0,
        systemAction: 'NORMAL',
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 레이어 L: FOMC 문서 감성 분석 (FOMC Sentiment Analysis) ────────────────────

export async function getFomcSentimentAnalysis(): Promise<FomcSentimentAnalysis> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

최근 FOMC 의사록/성명서/기자회견 텍스트를 분석하여 매파/비둘기파 스코어를 산출해줘.
이 분석은 한국 증시에 대한 미국 통화정책 영향을 정량화합니다.

[1. 매파/비둘기파 스코어]
검색: "FOMC statement minutes latest ${todayDate}"
검색: "Fed hawkish dovish analysis latest"
- 점수: -10(극비둘기) ~ +10(극매파)
- 핵심 문구 추출: "higher for longer", "data dependent", "gradual", "patient" 등

[2. 점도표(Dot Plot) 변화 방향]
검색: "FOMC dot plot median rate projection latest ${todayDate}"
- 이전 점도표 대비 변화: MORE_CUTS(인하 더 많음)/UNCHANGED/FEWER_CUTS(인하 축소)

[3. 한국 증시 임팩트 판단]
- BULLISH: 비둘기파(점수 -5 이하) → 달러 약세 → 외국인 유입
- NEUTRAL: 중립(-5 ~ +5) → 영향 제한적
- BEARISH: 매파(점수 +5 이상) → 달러 강세 → 외국인 유출
- 한국 증시 영향 근거 (한국어 1줄)

응답 형식 (JSON only):
{
  "hawkDovishScore": 3,
  "keyPhrases": ["data dependent", "gradual approach", "labor market strong"],
  "dotPlotShift": "FEWER_CUTS",
  "kospiImpact": "BEARISH",
  "rationale": "매파적 전환 → 달러 강세 → 외국인 자금 유출 압력",
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `fomc-sentiment-${weekKey}`;

  return getCachedAIResponse<FomcSentimentAnalysis>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as FomcSentimentAnalysis;
    } catch (error) {
      console.error("Error getting FOMC sentiment analysis:", error);
      return {
        hawkDovishScore: 0,
        keyPhrases: [],
        dotPlotShift: 'UNCHANGED',
        kospiImpact: 'NEUTRAL',
        rationale: 'FOMC 감성 분석 실패. 기본값 적용.',
        lastUpdated: requestedAtISO,
      };
    }
  });
}
