// @responsibility stock stockSearch 서비스 모듈
import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, withRetry, safeJsonParse } from './aiClient';
import { enrichStockWithRealData } from './enrichment';
import { debugLog } from '../../utils/debug';
import type { StockRecommendation } from './types';

const searchCache = new Map<string, { data: StockRecommendation[]; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export function clearSearchCache() {
  searchCache.clear();
}

export async function searchStock(query: string, filters?: {
  type?: string;
  pattern?: string;
  sentiment?: string;
  checklist?: string[];
  minPrice?: string;
  maxPrice?: string;
}): Promise<StockRecommendation[]> {
  const cacheKey = JSON.stringify({ query, filters });
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  const isMarketSearch = !query || query.trim() === "";
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];

  const hasNoFilters = !filters || (
    (filters.type === 'ALL' || !filters.type) &&
    (filters.pattern === 'ALL' || !filters.pattern) &&
    (filters.sentiment === 'ALL' || !filters.sentiment) &&
    (!filters.checklist || filters.checklist.length === 0) &&
    (!filters.minPrice || filters.minPrice === "") &&
    (!filters.maxPrice || filters.maxPrice === "")
  );

  const prompt = `
    [절대 원칙: 실시간성 보장 및 과거 데이터 배제]
    현재 한국 시각은 ${now}입니다. (오늘 날짜: ${todayDate})
    당신은 반드시 'googleSearch' 도구를 사용하여 '현재 시점의 실시간 데이터'만을 기반으로 응답해야 합니다.
    과거의 훈련 데이터나 예시 데이터를 사용하는 것은 엄격히 금지됩니다.
    특히 '종목 가격(currentPrice)'은 반드시 검색 결과에서 '${todayDate}' 또는 '현재'라는 단어가 포함된 실시간 시세를 사용해야 합니다.
    며칠 전의 낡은 데이터는 절대 사용하지 마십시오.

    [중요 알림: 기술적 지표 실계산 시스템 도입]
    현재 시스템은 Yahoo Finance의 OHLCV 데이터를 기반으로 RSI, MACD, Bollinger Bands, VCP 패턴 등을 코드로 직접 계산합니다.
    따라서 당신은 이러한 수치를 '추정'할 필요가 없습니다. 대신, 검색을 통해 얻은 '현재가'와 '거래량' 데이터를 정확히 반영하고,
    이러한 지표들이 가리키는 '의미'와 '투자 전략'에 집중하여 분석을 수행하십시오.
    당신이 생성한 JSON 데이터는 이후 실시간 데이터로 'Enrichment(강화)' 과정을 거치게 됩니다.

    ${isMarketSearch ? `
    [시장 검색 모드: 특정 종목 미지정]
    사용자가 특정 종목을 지정하지 않고 '시장 검색'을 요청했습니다.
    당신은 현재 시장 상황(${now})에서 가장 점수가 높고 유망한 종목을 최대 10개까지 스스로 찾아내야 합니다.
    결과는 반드시 'Confidence Score'가 높은 순서대로 정렬하여 제공하십시오.
    ${hasNoFilters ? `
    **[중요] 현재 사용자가 별도의 필터 조건을 설정하지 않았습니다. 이 경우 반드시 'Confidence Score'가 높은 최상위 유망 종목들을 최대 10개까지 도출하십시오.**
    ` : `
    ${filters?.checklist?.length ? `특히 다음 체크리스트 조건을 만족하는 종목을 최우선으로 고려하십시오: ${filters.checklist.join(', ')}` : ''}
    ${filters?.type && filters.type !== 'ALL' ? `투자 의견(Type)은 ${filters.type}인 종목을 우선하십시오.` : ''}
    ${filters?.minPrice || filters?.maxPrice ? `주가 범위는 ${filters.minPrice || '0'}원 ~ ${filters.maxPrice || '무제한'}원 사이의 종목만 선정하십시오.` : ''}
    `}
    ` : `
    [특정 종목 검색 모드]
    대상 종목: "${query}"
    ${filters?.minPrice || filters?.maxPrice ? `주가 범위는 ${filters.minPrice || '0'}원 ~ ${filters.maxPrice || '무제한'}원 사이인지 확인하십시오.` : ''}
    `}

    [필수 검색 단계 - 실시간 데이터 확보]
    ${isMarketSearch ? `
    1. "오늘의 한국 증시 주도주", "현재 급등주", "기관/외인 대량 매수 종목"을 검색하여 유망 종목 후보를 선정하라.
    2. 선정된 후보들에 대해 실시간 주가, 시가총액, 최신 뉴스, 재무 지표를 검색하여 정밀 분석하라.
    3. **[시가총액 교차 검증 필수]** 모든 종목의 가격은 반드시 시가총액과 대조하여 자릿수 오류가 없는지 확인하라.
    4. **[차트 패턴 분석]** 각 종목의 최근 주가 흐름을 분석하여 헤드 앤 숄더, 역 헤드 앤 숄더, 쌍바닥, 쌍봉, 컵 앤 핸들 등 주요 기술적 패턴을 식별하라.
    ` : `
    1. "${todayDate} ${query} 현재가", "${todayDate} ${query} 실시간 주가", "KRX ${query} 주가"를 검색하여 ${now} 기준의 정확한 가격을 확인하라.
    2. **[초정밀 검증]** 검색 결과 스니펫에서 '1분 전', '5분 전', '방금 전' 또는 오늘 날짜(${todayDate})가 명시된 가격만 채택하라.
    3. **[시가총액 교차 검증 필수]** 해당 종목의 시가총액을 검색하여 [현재가 * 발행주식수 = 시가총액] 공식이 맞는지 확인하고 자릿수 오류를 방지하라.
    4. "${query} 최신 뉴스", "${query} 공시"를 검색하여 현재의 모멘텀을 분석하라.
    5. **[DART corpCode 확보]** 해당 종목의 'DART 고유번호(corpCode, 8자리)'를 반드시 검색하여 'corpCode' 필드에 포함하라.
    6. **[차트 패턴 분석]** ${query}의 최근 3개월~1년 주가 차트를 분석하여 헤드 앤 숄더, 역 헤드 앤 숄더, 쌍바닥, 쌍봉, 컵 앤 핸들, 플래그, 패넌트 등 주요 기술적 패턴을 식별하라.
    5. **[뉴스 데이터 확보]** 각 종목에 대해 가장 최근의 뉴스 기사 5개를 찾아 'latestNews' 필드에 [헤드라인, 날짜, URL] 형식으로 포함하라. 반드시 실제 접근 가능한 기사 URL을 제공해야 하며, 허위 URL이나 플레이스홀더를 사용하지 마라.
    `}
    6. **[판단 기준 - STRONG_BUY, BUY, STRONG_SELL, SELL]**
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
    6. **[엄격한 평가 원칙]** 단순히 '좋아 보인다'는 이유로 BUY를 주지 마라. 위 기준을 '보수적'으로 적용하여 데이터가 확실할 때만 긍정적 의견을 제시하라.
    7. 모든 수치는 ${now} 기준의 최신 데이터여야 하며, 'priceUpdatedAt' 필드에 해당 가격이 확인된 시각(예: 14:30)을 반드시 기록하라.

    ${isMarketSearch ? '현재 시점에서 가장 유망한 종목 최대 10개' : `"${query}" 종목`}에 대해 현재 시점(${now})의 실시간 데이터를 기반으로 '초고도화된 AI 투자 분석 엔진'을 사용하여 가장 정밀한 분석을 수행해줘.
    ${isMarketSearch ? '각 종목이' : '이 종목이'} 현재 시점에서 얼마나 '확실한' 투자 기회인지 확신도(Confidence Score)와 함께 분석하라.

    응답은 반드시 다음 JSON 배열 형식으로만 해줘 (예: [{...}, {...}]):
    [
      {
        "name": "종목명", "code": "종목코드", "corpCode": "00123456", "reason": "...", "type": "STRONG_BUY/BUY/STRONG_SELL/SELL",
      "targetPrice": 0, "targetPrice2": 0, "entryPrice": 0, "entryPrice2": 0, "stopLoss": 0,
      "patterns": ["..."], "hotness": 9, "roeType": "...",
      "isLeadingSector": true, "isSectorTopPick": true, "momentumRank": 1, "confidenceScore": 85,
      "supplyQuality": { "passive": true, "active": true }, "peakPrice": 0, "currentPrice": 0, "priceUpdatedAt": "...",
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
      "catalystSummary": "촉매제 분석 통과 이유를 20자 이내로 요약",
      "visualReport": { "financial": 1, "technical": 1, "supply": 1, "summary": "..." },
      "elliottWaveStatus": { "wave": "WAVE_3", "description": "..." },
      "analystRatings": { "strongBuy": 0, "buy": 0, "strongSell": 0, "sell": 0, "consensus": "...", "targetPriceAvg": 0, "targetPriceHigh": 0, "targetPriceLow": 0, "sources": ["..."] },
      "newsSentiment": { "score": 0, "status": "POSITIVE", "summary": "..." },
      "chartPattern": { "name": "쌍바닥", "type": "REVERSAL_BULLISH", "description": "전형적인 바닥 확인 패턴", "reliability": 90 },
      "latestNews": [{ "headline": "뉴스 제목", "date": "2026-03-28", "url": "https://..." }],
      "roeAnalysis": { "drivers": ["..."], "historicalTrend": "...", "strategy": "...", "metrics": { "netProfitMargin": 0, "assetTurnover": 0, "equityMultiplier": 0 } },
      "strategicInsight": { "cyclePosition": "NEW_LEADER", "earningsQuality": "...", "policyContext": "..." },
      "marketCap": 0, "marketCapCategory": "LARGE", "correlationGroup": "...",
      "aiConvictionScore": { "totalScore": 0, "factors": [{ "name": "...", "score": 0, "weight": 0 }], "marketPhase": "BULL", "description": "..." },
      "sectorAnalysis": { "sectorName": "...", "currentTrends": ["..."], "leadingStocks": [{ "name": "...", "code": "...", "marketCap": "..." }], "catalysts": ["..."], "riskFactors": ["..."] },
      "dataSource": "...",
      "riskFactors": ["..."]
      }
    ]
  `;

  try {
    const parsed = await withRetry(async () => {
      const response = await getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: prompt,
        config: {
          maxOutputTokens: 8192,
          temperature: 0.1,
        },
      });
      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      return safeJsonParse(text);
    }, 2, 2000);

    const results = Array.isArray(parsed) ? parsed : [parsed];

    debugLog(`Enriching ${results.length} search results with real data (sequentially)`);
    const enrichedResults = [];
    for (const stock of results) {
      try {
        const enriched = await enrichStockWithRealData(stock);
        enrichedResults.push(enriched);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`Failed to enrich ${stock.name}:`, err);
        enrichedResults.push(stock);
      }
    }

    searchCache.set(cacheKey, { data: enrichedResults, timestamp: Date.now() });
    return enrichedResults;
  } catch (error) {
    console.error("Error searching stock:", error);
    throw error;
  }
}
