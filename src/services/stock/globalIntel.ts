import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, withRetry, safeJsonParse, getCachedAIResponse } from './aiClient';
import type {
  ThemeReverseTrackResult,
  GlobalCorrelationMatrix,
  GlobalMultiSourceData,
  NewsFrequencyScore,
  SupplyChainIntelligence,
  SectorOrderIntelligence,
  FinancialStressIndex,
  FomcSentimentAnalysis,
} from '../../types/quant';

// ─── H: 섹터-테마 역추적 엔진 (Theme → Korea Value Chain Reverse Tracking) ──

export async function trackThemeToKoreaValueChain(options?: {
  customThemes?: string[];
  maxThemes?: number;
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
      { "company": "비에이치아이", "code": "083650", "role": "열교환기·압력용기 부품", "revenueExposure": 20, "marketAttention": "HIDDEN", "competitiveEdge": "SMR 핵심 부품 납품 이력" }
    ],
    "hiddenGems": [
      { "company": "비에이치아이", "code": "083650", "role": "열교환기·압력용기 부품", "revenueExposure": 20, "marketAttention": "HIDDEN", "competitiveEdge": "SMR 핵심 부품 납품 이력" }
    ],
    "totalCompanies": 2,
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
          config: { maxOutputTokens: 10000, temperature: 0.2 },
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
          config: { temperature: 0.1 },
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
  "fedWatch": { "nextMeetingDate": "2026-05-07", "holdProbability": 65, "cutProbability": 30, "hikeProbability": 5 },
  "chinaPmi": { "manufacturing": 50.8, "services": 52.3, "trend": "EXPANDING" },
  "tsmcRevenue": { "monthlyRevenueTWD": 2360, "yoyGrowth": 35.2, "trend": "ACCELERATING", "implication": "AI 수요 급증으로 반도체 슈퍼사이클 진행 중." },
  "bojPolicy": { "currentRate": 0.5, "direction": "HIKING", "yenCarryRisk": "MEDIUM", "implication": "BOJ 추가 인상 시 엔캐리 청산으로 외국인 자금 유출 위험." },
  "usIsm": { "manufacturing": 49.2, "services": 53.8, "newOrders": 51.5, "trend": "FLAT" },
  "fredData": { "usCpi": 2.8, "usUnemployment": 3.9, "usRetailSales": 0.4 },
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
          config: { temperature: 0.1 },
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
- 0~2건 → score: 10, phase: "SILENT"
- 3~5건 → score: 8, phase: "EARLY"
- 6~15건 → score: 5, phase: "GROWING"
- 16~30건 → score: 3, phase: "CROWDED"
- 30건+ → score: 1, phase: "OVERHYPED"

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
          config: { temperature: 0.1 },
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
- 최근 월 반도체 장비 매출 (십억 달러)
- 전년동월비 성장률 (%)
- Book-to-Bill 비율 (수주/매출, 1.0 이상 = 수요 초과)
- 한국 반도체 시사점 (한국어 1줄)

[3. Global Container Freight Index — 컨테이너 운임]
검색: "Shanghai containerized freight index SCFI latest ${todayDate}"
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
검색: "Korea K2 tank K9 howitzer export contract ${todayDate}"
- NATO 평균 GDP 대비 국방비 (%)
- 미국 국방예산 (억달러)
- 추세: EXPANDING/STABLE/CUTTING

[2. LNG선 발주 동향]
검색: "LNG carrier newbuilding orders ${todayDate}"
- 당해년도 LNG선 신규 발주 척수
- 수주잔고 개월수

[3. SMR(소형모듈원자로) 글로벌 계약]
검색: "SMR small modular reactor NRC approval ${todayDate}"
- 미국 NRC 승인 기수
- 계약 총 용량 (GW)
- 투자 타이밍: TOO_EARLY/OPTIMAL/LATE

응답 형식 (JSON only):
{
  "globalDefense": { "natoGdpAvg": 2.1, "usDefenseBudget": 8860, "trend": "EXPANDING", "koreaExposure": "K2전차 폴란드 수출 파이프라인 확대" },
  "lngOrders": { "newOrdersYTD": 45, "qatarEnergy": "카타르 NFE 확장 프로젝트 발주 지속", "orderBookMonths": 48, "implication": "수주잔고 4년치 → 조선 3사 매출 가시성 최고" },
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
