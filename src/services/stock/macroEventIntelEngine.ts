import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, withRetry, safeJsonParse, getCachedAIResponse } from './aiClient';
import type {
  FinancialStressIndex,
  FomcSentimentAnalysis,
} from '../../types/quant';

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
- 현재 bp (정상: 10~50bp, 위험: 100bp+)
- 알림 수준: NORMAL(~50bp)/ELEVATED(50~100bp)/CRISIS(100bp+)

[2. US High Yield Spread — 기업 크레딧]
검색: "US high yield bond spread OAS today ${todayDate}"
- 현재 bp (정상: 300~400bp, 위험: 600bp+)
- 추세: TIGHTENING/STABLE/WIDENING

[3. MOVE Index — 채권시장 변동성]
검색: "MOVE index today ${todayDate}"
- 현재값 (정상: 80~100, 위험: 150+)
- 알림 수준: NORMAL(~100)/ELEVATED(100~150)/EXTREME(150+)

종합 FSI 계산법:
- compositeScore = (tedSpread가 CRISIS?40:ELEVATED?20:0) + (usHySpread>600?40:>500?20:0) + (moveIndex>150?20:>120?10:0)
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
- 점수: -10(극비둘기) ~ +10(극매파)
- 핵심 문구 추출: "higher for longer", "data dependent", "gradual", "patient" 등

[2. 점도표(Dot Plot) 변화 방향]
검색: "FOMC dot plot median rate projection latest ${todayDate}"
- 이전 점도표 대비 변화: MORE_CUTS/UNCHANGED/FEWER_CUTS

[3. 한국 증시 임팩트 판단]
- BULLISH: 비둘기파(점수 -5 이하) → 달러 약세 → 외국인 유입
- NEUTRAL: 중립(-5 ~ +5)
- BEARISH: 매파(점수 +5 이상) → 달러 강세 → 외국인 유출

응답 형식 (JSON only):
{
  "hawkDovishScore": 3,
  "keyPhrases": ["data dependent", "gradual approach"],
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
