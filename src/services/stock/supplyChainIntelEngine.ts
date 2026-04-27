// @responsibility stock supplyChainIntelEngine 서비스 모듈
import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, withRetry, safeJsonParse, getCachedAIResponse } from './aiClient';
import type {
  NewsFrequencyScore,
  SupplyChainIntelligence,
  SectorOrderIntelligence,
} from '../../types/quant';

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
