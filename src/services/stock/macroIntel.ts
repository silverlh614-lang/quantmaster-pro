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
          config: { temperature: 0.1 },
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
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error('No response from AI');
      return safeJsonParse(text) as MacroEnvironment;
    } catch (_) {
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
