import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, withRetry, safeJsonParse, getCachedAIResponse } from './aiClient';
import type { StockRecommendation, MarketContext } from './types';

export async function parsePortfolioFile(content: string): Promise<{ name: string; code: string; weight: number }[]> {
  const prompt = `
    다음은 사용자가 업로드한 포트폴리오 관련 텍스트 파일의 내용이야:
    "${content}"

    이 텍스트에서 주식 종목명(또는 코드)과 해당 종목의 비중(%)을 추출해서 JSON 배열 형식으로 반환해줘.
    비중이 명시되지 않았다면 균등 배분(Total 100%)을 가정해서 계산해줘.
    종목 코드를 모른다면 빈 문자열로 두지 말고, 검색을 통해 정확한 종목 코드를 찾아내라.

    응답 형식:
    [
      { "name": "삼성전자", "code": "005930", "weight": 20 },
      { "name": "SK하이닉스", "code": "000660", "weight": 30 },
      ...
    ]
  `;

  try {
    const parsed = await withRetry(async () => {
      const response = await getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: prompt,
        config: {
          maxOutputTokens: 1024,
          temperature: 0,
        },
      });
      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      return safeJsonParse(text);
    }, 2, 2000);

    return parsed;
  } catch (error) {
    console.error("Error parsing portfolio file:", error);
    throw error;
  }
}

export async function generateReportSummary(recommendations: StockRecommendation[], marketContext: MarketContext | null): Promise<string> {
  const cacheKey = `report-summary-...-${new Date().toISOString().split('T')[0]}`;
  return getCachedAIResponse(cacheKey, async () => {
    const prompt = `
      다음은 'QuantMaster Pro' 애플리케이션에서 분석한 주식 시장 상황과 추천 종목 정보야.
      이 내용을 바탕으로 투자 결정에 직접적인 도움을 줄 수 있는 'AI 핵심 요약 리포트'를 작성해줘.

      [시장 상황]
      ${marketContext ? `
      - 코스피: ${marketContext.kospi.index} (${marketContext.kospi.changePercent}%) - ${marketContext.kospi.status}
      - 코스닥: ${marketContext.kosdaq.index} (${marketContext.kosdaq.changePercent}%) - ${marketContext.kosdaq.status}
      - 삼성 IRI: ${marketContext.iri}pt, VKOSPI: ${marketContext.vkospi}%
      - 종합 의견: ${marketContext.overallSentiment}
      ` : '정보 없음'}

      [추천 종목 및 27단계 마스터 체크리스트 분석]
      ${recommendations.map(r => {
        const passedCount = Object.values(r.checklist || {}).filter(Boolean).length;
        const keyItems = Object.entries(r.checklist || {})
          .filter(([_, passed]) => passed)
          .map(([key, _]) => key)
          .slice(0, 5)
          .join(', ');

        return `
      - ${r.name} (${r.code}): ${r.type.replace('_', ' ')} 의견, 목표가 ${r.targetPrice?.toLocaleString() || '0'}원.
        * 체크리스트 통과: ${passedCount}/27 (주요 통과 항목: ${keyItems})
        * 분석 사유: ${r.reason}
        * 섹터 분석 (${r.sectorAnalysis?.sectorName || 'N/A'}): 트렌드(${r.sectorAnalysis?.currentTrends?.join(', ') || 'N/A'}), 촉매제(${r.sectorAnalysis?.catalysts?.join(', ') || 'N/A'}), 리스크(${r.sectorAnalysis?.riskFactors?.join(', ') || 'N/A'})
        * 리스크 요인: ${r.riskFactors?.join(', ') || 'N/A'}
        `;
      }).join('\n')}

      작성 가이드라인:
      1. 친절하고 전문적인 어조로 작성하되, 투자자에게 실질적인 통찰을 제공하라.
      2. 현재 시장 상황(Risk-On/Off 여부 등)과 추천 종목들의 강점이 어떻게 맞물리는지 분석하여 첫 단락에 요약하라.
      3. '27단계 마스터 체크리스트'의 통과 비중과 주요 항목(예: ROE 유형, 수급, 기술적 돌파 등)이 해당 종목의 신뢰도에 미치는 영향을 구체적으로 언급하라.
      4. 각 종목별로 투자자가 가장 주의 깊게 봐야 할 '결정적 한 방(Key Insight)'을 제시하라.
      5. 시장 리스크와 개별 종목 리스크를 결합하여 최종적인 투자 판단 가이드를 제공하라.
      6. 전체 길이는 600~800자 내외로 상세하게 작성하고, 마크다운 형식을 적극 활용하라.
    `;

    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            maxOutputTokens: 2048,
            temperature: 0,
          },
        });
      }, 2, 2000);

      return response.text || "요약을 생성할 수 없습니다.";
    } catch (error: any) {
      const errObj = error?.error || error;
      const message = errObj?.message || error?.message || "";
      if (message.includes('429') || message.includes('quota') || message.includes('RESOURCE_EXHAUSTED')) {
        console.warn("Report summary generation hit rate limit.");
      } else {
        console.error("Error generating report summary:", error);
      }
      throw error;
    }
  });
}
