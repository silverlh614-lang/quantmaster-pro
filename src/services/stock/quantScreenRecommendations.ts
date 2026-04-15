/**
 * quantScreenRecommendations.ts — QUANT_SCREEN 정량 파이프라인
 *
 * mode === 'QUANT_SCREEN' 일 때 호출되는 정량 스크리닝 통합 파이프라인입니다.
 * 정량 스크리닝 → DART 공시 → 조용한 매집 → AI 정밀 분석 순으로 실행됩니다.
 */

import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, withRetry, safeJsonParse } from './aiClient';
import { enrichStockWithRealData } from './enrichment';
import { runQuantitativeScreening, scanDartDisclosures, detectSilentAccumulation } from './quantScreener';
import { debugLog } from '../../utils/debug';
import type { StockFilters, RecommendationResponse } from './types';

export async function runQuantScreenPipeline(filters?: StockFilters): Promise<RecommendationResponse | null> {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const universe = filters?.universe;

  try {
    debugLog('[QUANT_SCREEN] 1단계: 정량 스크리닝 + DART 공시 병렬 스캔');
    const [quantResults, dartResults] = await Promise.all([
      runQuantitativeScreening({
        minMarketCap: universe?.filters?.minMarketCapBillion ?? filters?.minMarketCap ?? 1000,
        maxResults: 30,
        universe,
      }),
      scanDartDisclosures({ daysBack: 5, minSignificance: 5, maxResults: 20 }),
    ]);

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
          newsFreqScore: 8,
          signals: d.disclosures.map(disc => `[공시] ${disc.title}`),
        });
      }
    }

    const candidates = Array.from(stockMap.values())
      .map(s => ({
        ...s,
        combinedScore: s.quantScore * 0.4 + s.dartScore * 0.3 + s.newsFreqScore * 3,
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

    debugLog(`[QUANT_SCREEN] 4단계: 상위 ${candidates.length}개 종목 조용한 매집 분석`);
    const accumResults = await detectSilentAccumulation(
      candidates.map(c => ({ code: c.code, name: c.name }))
    );
    const accumMap = new Map(accumResults.map(a => [a.code, a]));

    debugLog('[QUANT_SCREEN] 5단계: AI 정밀 분석');
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

    if (parsed && parsed.recommendations.length > 0) {
      debugLog(`[QUANT_SCREEN] Enriching ${parsed.recommendations.length} recommendations`);
      const enriched = [];
      for (const stock of parsed.recommendations) {
        try {
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
