/**
 * momentumRecommendations.ts — MOMENTUM / EARLY_DETECT 모드 AI 추천 로직
 *
 * getStockRecommendations() 에서 mode가 MOMENTUM 또는 EARLY_DETECT인 경우에
 * 사용되는 프롬프트 빌딩, AI 호출, Enrichment 로직을 담당합니다.
 */

import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, lsGet, withRetry, safeJsonParse, getCachedAIResponse } from './aiClient';
import { enrichStockWithRealData } from './enrichment';
import { fetchMarketIndicators } from './marketOverview';
import { debugLog } from '../../utils/debug';
import type { StockFilters, RecommendationResponse } from './types';

export async function getMomentumRecommendations(filters?: StockFilters): Promise<RecommendationResponse | null> {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const mode = filters?.mode || 'MOMENTUM';

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

  const smallMidCapSearchQueries = [
    `코스닥 중소형주 급등 후보 ${todayDate}`,
    `코스닥 소형주 거래량 급증 종목 한국`,
    `코스피 중형주 기관 매집 종목 한국`,
    `시가총액 1000억~5000억 성장주 한국`,
    `중소형주 52주 신고가 근접 종목 코스닥`,
    `코스닥 테마 주도주 후발주 한국`,
    `중소형 바이오 실적 개선 종목`,
    `코스닥 반도체 장비 소재 중소형주`,
    `중소형 방산 수혜주 한국 ${todayDate}`
  ];

  const searchQueries =
    mode === 'EARLY_DETECT'    ? earlyDetectSearchQueries :
    mode === 'SMALL_MID_CAP'  ? smallMidCapSearchQueries :
    momentumSearchQueries;

  const modePrompt = mode === 'EARLY_DETECT' ? `
      [선행 신호 우선 탐색 - 급등 전 종목 포착 모드]
      다음 조건을 모두 또는 대부분 충족하는 종목을 최우선으로 선정하라:
      1. 주가 상승률: 최근 1개월 기준 KOSPI/KOSDAQ 대비 아웃퍼폼하되, 단기(5일) 상승률은 3% 미만인 종목 (이미 급등한 종목 제외)
      2. 거래량 조건: 최근 3~5일 거래량이 20일 평균의 50% 이하로 마른 상태 (매도 물량 소진 신호, VCP 패턴)
      3. 기술적 위치: 52주 신고가 대비 -5% 이내 근접, 볼린저밴드 폭(BBWidth)이 최근 3개월 내 최저 수준, 주가가 주요 이평선(20일, 60일) 위에서 횡보 중
      4. 수급 조건: 기관이 최근 3~7일간 조용히 소량 순매수 중, 외국인 매수는 아직 본격화되지 않은 상태
      5. 섹터 조건: 해당 섹터 대장주가 이미 신고가를 경신했으나, 해당 종목은 아직 대장주 대비 상승률이 30% 이상 뒤처진 상태

      위 조건을 충족할수록 높은 confidenceScore를 부여하고, 이미 단기 급등(5일 기준 +15% 이상)한 종목은 추천에서 제외하라.
  ` : mode === 'SMALL_MID_CAP' ? `
      [중소형주 주도주 포착 모드 - 시가총액 1,000억~3조원 범위 확장]
      대형주 위주의 주도주 탐색을 중소형주까지 확대한다. 다음 조건에 집중하라:
      1. 시가총액: 코스피/코스닥 중형주 (1,000억~3조원) 또는 소형주 (300억~1,000억원) 우선
         - 대형주(시총 3조 이상)는 기본 MOMENTUM 모드에서 다루므로 이 모드에서는 비중을 줄인다.
      2. 주도 테마 후발주: 현재 대형주 주도 테마(반도체, 방산, 조선, 바이오 등)에서 아직 급등하지 않은 중소형 연관 종목
         - 대장주가 이미 신고가 경신 → 해당 섹터 중소형주 중 아직 상승률이 30% 이상 뒤처진 종목
      3. 코스닥 집중: 코스닥 시장의 중소형 성장주를 우선 탐색한다.
         - 영업이익 턴어라운드, 신사업 진입, 정부 정책 수혜 등 실체적 성장 촉매 보유 종목
      4. 수급 이상 신호: 시총 대비 이례적으로 많은 거래량 발생(거래량 20일 평균 대비 200% 이상)
      5. 기술적 조건: 장기 하락 후 첫 상승 구간 진입(골든크로스 발생 이내 10거래일)
      6. 중소형주 특성상 변동성이 크므로 손절선을 타이트하게(-5~-7%) 설정하라.

      [중요] 코스닥 상장 종목, 코스피 중소형주를 반드시 포함시켜라. 삼성전자, SK하이닉스 등 초대형주는 이 모드에서 제외하라.
      위 조건을 충족할수록 높은 confidenceScore를 부여하고, 이미 단기 급등(5일 기준 +20% 이상)한 종목은 추천에서 제외하라.
  ` : `
      [모멘텀 추종 - 현재 주도주 포착 모드]
      현재 시장에서 가장 강력한 상승 모멘텀을 가진 주도주를 선정하라.
      기관과 외국인의 동반 대량 매수가 확인되고, 신고가를 경신하며 추세가 강화되는 종목을 우선한다.
  `;

  const prompt = `
      [절대 원칙: 실시간성 보장 및 과거 데이터 배제]
      현재 한국 시각은 ${now}입니다. (오늘 날짜: ${todayDate})
      추천 모드: ${mode === 'EARLY_DETECT' ? '미리 볼 종목 (Early Detect)' : mode === 'SMALL_MID_CAP' ? '중소형주 주도주 (Small/Mid-Cap)' : '지금 살 종목 (Momentum)'}

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
         - ${mode === 'EARLY_DETECT' ? 'EARLY_DETECT 모드에서는 거래량 마름과 횡보 후 돌파 직전 신호를 가장 높게 평가하라.' : mode === 'SMALL_MID_CAP' ? 'SMALL_MID_CAP 모드에서는 코스닥 중소형주의 거래량 급증과 섹터 후발주 특성을 가장 높게 평가하라.' : 'MOMENTUM 모드에서는 강력한 수급과 추세 강도를 가장 높게 평가하라.'}
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
          "disclosureSentiment": { "score": 0, "summary": "..." },
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
            temperature: 0.1,
          },
        });
      }, 2, 2000);

      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      const parsed = safeJsonParse(text);

      if (parsed && !parsed.recommendations) {
        parsed.recommendations = [];
      }

      if (parsed && parsed.recommendations.length > 0) {
        debugLog(`Enriching ${parsed.recommendations.length} recommendations with real data (sequentially)`);
        const enrichedRecommendations = [];
        for (const stock of parsed.recommendations) {
          try {
            const enriched = await enrichStockWithRealData(stock);
            enrichedRecommendations.push(enriched);
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
      console.error("Error in getMomentumRecommendations:", error);
      throw error;
    }
  });
}
