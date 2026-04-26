// @responsibility stock bearScreenerRecommendations 서비스 모듈
/**
 * bearScreenerRecommendations.ts — Bear Regime 전용 하락 수혜주 AI 스크리너
 *
 * mode === 'BEAR_SCREEN' 일 때 호출되는 AI 프롬프트, 호출, Enrichment 로직을 담당합니다.
 */

import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, withRetry, safeJsonParse, getCachedAIResponse } from './aiClient';
import { enrichStockWithRealData } from './enrichment';
import type { StockFilters, RecommendationResponse } from './types';

export async function getBearScreenerRecommendations(filters?: StockFilters): Promise<RecommendationResponse | null> {
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

      [Bear Screener 전용 BUY 조건 (ADR-0005 서버 Kelly 캡 정렬)]
      Bear Screener에서는 다음 조건으로 BUY를 판단한다. 일반 27조건과 다르지만,
      레짐별 Kelly 캡(regimePlaybook: R5_CAUTION 선택적 진입 · R6_DEFENSE CONFIRMED_STRONG_BUY 한정)
      과 충돌하지 않도록 STRONG_BUY 기준을 엄격히 유지한다.
      - STRONG_BUY: 해당 카테고리 조건 5개 이상 충족 + 배당 수익률 5% 이상 또는 ROE 25% 이상
        + 기관 순매수 5거래일 연속 확인 + RRR ≥ 3.0 + 공매도 잔고 감소 추세.
        (R6_DEFENSE 레짐 즉 "현재 Regime이 R6_DEFENSE" 로 판단되면 STRONG_BUY 부여 금지 —
         CONFIRMED_STRONG_BUY 한정 진입 정책에 따라 일반 STRONG_BUY 는 사용하지 않는다.)
      - BUY: 해당 카테고리 조건 3개 이상 충족 + 실적 안정성 확인 + RRR ≥ 2.0.
      - HOLD: 조건 2개 이하 충족 또는 펀더멘털 불명확.
      주의: 일목균형표 ABOVE_CLOUD 조건은 Bear Screener에서 필수가 아님 (방어주는 눌린 상태일 수 있음).

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
            "type": "BUY",
            "targetPrice": 0, "targetPrice2": 0, "entryPrice": 0, "stopLoss": 0,
            "gate": 2, "patterns": [], "hotness": 6,
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
            "riskFactors": ["..."]
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
