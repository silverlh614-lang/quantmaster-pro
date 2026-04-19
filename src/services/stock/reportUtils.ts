import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, withRetry, safeJsonParse, getCachedAIResponse } from './aiClient';
import { buildReportBody, compressBodyForToneUp } from '../reports/templateReporter';
import type { StockRecommendation, MarketContext } from './types';

/**
 * (Idea 6) 압축 요약을 받아 톤만 다듬는 가벼운 Gemini 호출.
 * 본문 수치/통계는 결정적 템플릿이 이미 생성하므로 환각 위험 없음.
 * maxOutputTokens 1024 — 자연어 마무리 한 단락만 생성.
 */
export async function aiToneUp(draft: string): Promise<string> {
  if (!draft || draft.trim().length === 0) return draft;
  const prompt =
    `다음은 한국 주식 일일 리포트의 핵심 통계 요약입니다.\n` +
    `이 내용을 그대로 보존하면서, 마지막에 1~2문장의 투자자 행동 가이드를 자연어로 덧붙이세요.\n` +
    `숫자/종목명/통계는 절대 변경 금지. 추가 분석 금지. 톤만 따뜻하고 전문적으로.\n\n` +
    `[원본 요약]\n${draft}\n\n` +
    `[출력] 위 요약 + 마지막 가이드 1~2문장`;

  try {
    const response = await withRetry(async () => {
      return await getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: prompt,
        config: { maxOutputTokens: 1024, temperature: 0.3 },
      });
    }, 1, 1500);
    return response.text || draft;
  } catch (e) {
    // 톤업은 nice-to-have — 실패 시 원본 그대로 반환 (graceful degradation)
    console.warn('[reportUtils] aiToneUp 실패, 원본 본문 반환:', e instanceof Error ? e.message : e);
    return draft;
  }
}

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

/**
 * (Idea 6) 결정적 템플릿 본문 + AI 톤업 마무리.
 * 종전: 600~800자 본문 전체를 Gemini가 작성 (수치 환각 위험 + maxOutputTokens 2048).
 * 신:   templateReporter.buildReportBody() 가 100% 결정적으로 본문 생성 →
 *       compressBodyForToneUp() 로 500자 압축 → aiToneUp() 만 1024토큰으로 호출.
 *
 * 이점: AI 호출 실패해도 본문은 정상 (graceful degradation).
 *       수치/종목/체크리스트는 코드가 작성 → 환각 0.
 */
export async function generateReportSummary(
  recommendations: StockRecommendation[],
  marketContext: MarketContext | null,
): Promise<string> {
  const cacheKey = `report-summary-${new Date().toISOString().split('T')[0]}-${recommendations.length}`;
  return getCachedAIResponse(cacheKey, async () => {
    const body  = buildReportBody(recommendations, marketContext);
    const draft = compressBodyForToneUp(body, 500);
    const tail  = await aiToneUp(draft);
    // 본문은 결정적, 마지막에 톤업이 추가한 가이드 1~2문장만 덧붙임.
    if (tail && tail !== draft) {
      // aiToneUp이 '원본 + 가이드' 형태로 돌려주는 경우 → 그대로 사용 (마크다운 헤더 보존을 위해 본문 우선).
      // draft가 압축본이므로 풀 body를 다시 앞에 붙이고, tail에서 draft 부분을 제거한 가이드만 사용.
      const guideOnly = tail.replace(draft, '').trim();
      return guideOnly.length > 0 ? `${body}\n\n---\n${guideOnly}` : body;
    }
    return body;
  });
}
