// @responsibility stock macroIntel 서비스 모듈
import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, withRetry, safeJsonParse, getCachedAIResponse } from './aiClient';
import { getBatchGlobalIntel } from './batchIntel';
import type {
  EconomicRegimeData,
  SmartMoneyData,
  ExportMomentumData,
  GeopoliticalRiskData,
  CreditSpreadData,
  MacroEnvironment,
  ExtendedRegimeData,
} from '../../types/quant';

// ─── 아이디어 2: 경기 레짐 자동 분류기 (Economic Regime Classifier) ──────────

export async function getEconomicRegime(): Promise<EconomicRegimeData> {
  const todayDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const cacheKey = `economic-regime-${todayDate}`;
  return getCachedAIResponse<EconomicRegimeData>(cacheKey, async () => {
    const batch = await getBatchGlobalIntel();
    return batch.regime;
  });
}

// ─── 아이디어 4: Smart Money Radar (글로벌 ETF 선행 모니터) ──────────────────

export async function getSmartMoneyFlow(): Promise<SmartMoneyData> {
  const todayDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const cacheKey = `smart-money-${todayDate}`;
  return getCachedAIResponse<SmartMoneyData>(cacheKey, async () => {
    const batch = await getBatchGlobalIntel();
    return batch.smartMoney;
  });
}

// ─── 아이디어 5: 수출 선행지수 섹터 로테이션 엔진 ────────────────────────────

export async function getExportMomentum(): Promise<ExportMomentumData> {
  const requestedAt = new Date();
  const yearMonth = requestedAt.toISOString().slice(0, 7);
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

// ─── 확장 레짐 분류기 (Extended Regime Classifier) ───────────────────────────
// ─── 거시 환경 자동 수집 (Gate 0 입력) ────────────────────────────────────────
