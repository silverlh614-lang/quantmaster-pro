import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, withRetry, safeJsonParse, getCachedAIResponse } from './aiClient';
import { fetchAiUniverseSnapshot } from '../../api/aiUniverseClient';
import type {
  QuantScreenResult,
  DartScreenerResult,
  SilentAccumulationResult,
} from '../../types/quant';
import type { UniverseConfig } from './types';

// ─── 유니버스 → 프롬프트 문자열 헬퍼 ────────────────────────────────────────

function buildUniversePrompt(universe?: UniverseConfig): string {
  if (!universe) return '';

  const parts: string[] = [];
  const marketLabel =
    universe.market === 'J' ? '코스피(KOSPI)' :
    universe.market === 'Q' ? '코스닥(KOSDAQ)' : '코스피+코스닥 전체';

  if (universe.preset === 'KOSPI200') {
    parts.push('- 탐색 범위를 KOSPI 200 구성종목으로 한정하라');
  } else if (universe.preset === 'KOSDAQ150') {
    parts.push('- 탐색 범위를 KOSDAQ 150 구성종목으로 한정하라');
  } else {
    parts.push(`- 탐색 범위: ${marketLabel} 상장 종목`);
  }

  if (universe.filters.minMarketCapBillion) {
    parts.push(`- 시가총액 ${universe.filters.minMarketCapBillion.toLocaleString()}억원 이상`);
  }
  if (universe.filters.volumeTopPercent) {
    parts.push(`- 거래량 상위 ${universe.filters.volumeTopPercent}% 이내 종목만`);
  }
  if (universe.filters.foreignOwned) {
    parts.push('- 외국인 투자 가능 종목(외국인 편입 종목)만');
  }

  return parts.length > 0
    ? `\n[Gate-0: 유니버스 제한]\n${parts.join('\n')}\n위 유니버스 조건을 반드시 먼저 적용하라.\n`
    : '';
}

// ─── 정량 스크리너 (Quantitative Screener) ───────────────────────────────────

export async function runQuantitativeScreening(options?: {
  minMarketCap?: number;     // 최소 시총 (억원, 기본 1000)
  minTurnover?: number;      // 최소 거래대금 (억원, 기본 10)
  maxResults?: number;        // 최대 결과 수 (기본 30)
  universe?: UniverseConfig;  // Gate-0 유니버스 설정
}): Promise<QuantScreenResult[]> {
  const todayDate = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  const minCap = options?.minMarketCap ?? 1000;
  const minTurnover = options?.minTurnover ?? 10;
  const maxResults = options?.maxResults ?? 30;
  const universePrompt = buildUniversePrompt(options?.universe);

  const prompt = `
현재 한국 날짜: ${todayDate}

당신은 정량 스크리너입니다. 뉴스·테마·인기도와 무관하게, 순수 수치 이상 신호만으로 종목을 발굴해야 합니다.
Google 검색을 통해 아래 조건을 충족하는 종목을 최대 ${maxResults}개 찾아주세요.
${universePrompt}
[1단계: 기본 필터]
- 시가총액 > ${minCap}억원
- 일평균 거래대금(20일) > ${minTurnover}억원
- 관리종목/투자경고/적자기업 제외

[2단계: 이상 신호 감지 - 다음 중 2개 이상 충족 종목]
검색 키워드를 활용하여 아래 신호를 감지하라:
1. "거래량 급증 종목 코스피 코스닥 ${todayDate}" - 20일 평균 대비 300% 이상 거래량 급증
2. "외국인 기관 동시 순매수 종목 ${todayDate}" - 외국인+기관 3일 이상 연속 순매수 전환
3. "52주 신고가 근접 종목 한국" - 52주 고가 대비 95% 이상 도달
4. "볼린저밴드 수축 종목 한국" - VCP 패턴 (변동성 수축 3단계 이상)
5. "공매도 잔고 급감 종목 한국" - 공매도 비중 20일 전 대비 30% 이상 감소
6. "자사주 매입 결정 공시 ${todayDate}" - 최근 5일 이내 자사주 취득 공시
7. "대주주 임원 주식 매수 공시 한국" - 최근 10일 이내 내부자 매수
8. "대규모 수주 공시 한국 ${todayDate}" - 매출 대비 10% 이상 수주
9. "대규모 설비투자 유형자산 취득 공시 한국" - 대규모 CAPEX 공시

[핵심 원칙]
- 뉴스가 많이 나온 인기 종목은 오히려 감점 (newsFrequencyScore 낮게)
- 뉴스가 거의 없지만 수치적 이상 신호가 있는 종목을 최우선
- 대형주보다 중소형주에서 이상 신호가 더 의미 있음
- 이미 최근 1주일 30% 이상 급등한 종목은 제외

[뉴스 빈도 역지표 채점 기준]
- 최근 30일 뉴스 0~2건: newsFrequencyScore = 10 (Silent Phase → 최고 점수)
- 최근 30일 뉴스 3~5건: 8 (Early Phase)
- 최근 30일 뉴스 6~15건: 5 (Growing Attention)
- 최근 30일 뉴스 16~30건: 3 (Crowded)
- 최근 30일 뉴스 30건 이상: 1 (Over-hyped → 감점)

응답 형식 (JSON only, 배열):
[
  {
    "code": "005930",
    "name": "종목명",
    "marketCap": 5000,
    "price": 75000,
    "signals": [
      { "type": "VOLUME_SURGE", "strength": 8, "description": "20일 평균 대비 450% 거래량 급증" },
      { "type": "INSTITUTIONAL_ACCUMULATION", "strength": 7, "description": "기관 5일 연속 소량 순매수" }
    ],
    "totalSignalScore": 75,
    "newsFrequencyScore": 9,
    "silentAccumulationScore": 7,
    "volumeProfile": {
      "current": 1500000,
      "avg20d": 300000,
      "ratio": 5.0,
      "trend": "SURGING"
    },
    "pricePosition": {
      "distanceFrom52wHigh": -3.2,
      "distanceFrom52wLow": 45.5,
      "aboveMA200": true,
      "aboveMA60": true
    },
    "institutionalFlow": {
      "foreignNet5d": 25000,
      "institutionNet5d": 15000,
      "foreignConsecutive": 3,
      "isQuietAccumulation": true
    },
    "source": "QUANT_SCREEN"
  }
]
  `.trim();

  const cacheKey = `quant-screening-${todayDate}`;

  return getCachedAIResponse<QuantScreenResult[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            maxOutputTokens: 8000,
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as QuantScreenResult[];
    } catch (error) {
      console.error("Error in quantitative screening:", error);
      return [];
    }
  });
}

// ─── DART 공시 Pre-News 스크리너 ────────────────────────────────────────────

export async function scanDartDisclosures(options?: {
  daysBack?: number;          // 최근 N일 공시 스캔 (기본 5)
  minSignificance?: number;   // 최소 중요도 (기본 5)
  maxResults?: number;         // 최대 결과 수 (기본 20)
}): Promise<DartScreenerResult[]> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const daysBack = options?.daysBack ?? 5;
  const minSig = options?.minSignificance ?? 5;
  const maxResults = options?.maxResults ?? 20;

  // DART API로 직접 공시 목록 수집 (Search 대체)
  const bgn = new Date(requestedAt.getTime() - daysBack * 86400_000);
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  let dartListText = '';
  try {
    const dartRes = await fetch(`/api/dart/list?bgn_de=${fmtDate(bgn)}&end_de=${fmtDate(requestedAt)}&pblntf_ty=B001`);
    if (dartRes.ok) {
      const dartData = await dartRes.json();
      const items: any[] = dartData.list ?? [];
      const compact = items.slice(0, 60).map((it: any) =>
        `[${it.rcept_dt}] ${it.corp_name}(${it.stock_code ?? '?'}) — ${it.report_nm}`
      ).join('\n');
      dartListText = compact || '(공시 목록 없음)';
    }
  } catch { /* fallback to empty */ }

  const prompt = `
현재 한국 날짜: ${todayDate}

당신은 DART 공시 분석 전문가입니다. 아래는 DART API에서 직접 수집한 최근 ${daysBack}일 이내 주요사항보고서(B001) 목록입니다.
Google 검색 없이 이 목록만으로 분석하세요.

[DART API 실데이터 — 주요사항보고서 목록]
${dartListText || '(DART API 수집 실패 — AI 지식 기반으로 추정)'}

위 공시 중 주가에 중요한 영향을 줄 수 있는 공시를 골라 아래 기준으로 채점하세요.

[중요도 채점 기준]
- 대규모 수주 (매출 대비 20%+): 10점 / 단일판매·공급계약체결: 8점
- 유형자산 취득 (설비투자, 매출 대비 10%+): 8점
- 자기주식 취득 결정 (발행주식 1%+): 8점
- 자기주식 소각 결정: 9점
- 최대주주 변경 (경영권 인수): 8점
- 타법인 주식 및 출자증권 취득결정 (M&A/신사업): 7점
- CB 전환가 하향 조정: 6점

[Pre-News 점수 기준 (0-10)]
- 공시 후 48시간 이내: preNewsScore = 9~10
- 공시 후 3~5일: 5~7
- 공시 후 5일 초과: 2

종목별로 그룹화하여, 최대 ${maxResults}개 종목에 대해 중요도 ${minSig} 이상 공시만 포함.

응답 형식 (JSON only, 배열):
[
  {
    "code": "329180",
    "name": "종목명",
    "disclosures": [
      {
        "type": "LARGE_ORDER",
        "title": "단일판매·공급계약체결(자율공시) - 1,200억원 규모",
        "date": "2026-04-05",
        "significance": 9,
        "revenueImpact": 25.3,
        "description": "연매출 대비 25% 규모의 대형 수주. 수주잔고 역대 최대 갱신.",
        "dartUrl": ""
      }
    ],
    "totalScore": 85,
    "preNewsScore": 9,
    "daysSinceDisclosure": 1,
    "isActionable": true,
    "lastUpdated": "${requestedAtISO}"
  }
]
  `.trim();

  const cacheKey = `dart-screener-${todayDate}`;

  return getCachedAIResponse<DartScreenerResult[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            maxOutputTokens: 8000,
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as DartScreenerResult[];
    } catch (error) {
      console.error("Error in DART disclosure screening:", error);
      return [];
    }
  });
}

// ─── 조용한 매집 감지기 (Silent Accumulation Detector) ───────────────────────

export async function detectSilentAccumulation(
  stockCodes: { code: string; name: string }[],
): Promise<SilentAccumulationResult[]> {
  if (stockCodes.length === 0) return [];

  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  // PR-25-C (ADR-0011): KIS 수급·공매도 호출 제거. Naver 모바일 snapshot 의 정적
  // `foreignerOwnRatio` + PER/PBR/시총 만 주입하고, 일별 순매수 추세·공매도 변화는
  // AI 프롬프트 자체 판단으로 위임한다 (PR-13 프롬프트 정렬 유지).
  const snapshotResults = await Promise.allSettled(
    stockCodes.map(s => fetchAiUniverseSnapshot(s.code)),
  );

  const kisDataBlocks = stockCodes.map((s, i) => {
    const res = snapshotResults[i];
    const lines: string[] = [`▸ ${s.name}(${s.code})`];
    if (res.status === 'fulfilled' && res.value && res.value.found) {
      const snap = res.value;
      lines.push(`  외인 지분율: ${snap.foreignerOwnRatio.toFixed(2)}%`);
      if (snap.per > 0) lines.push(`  PER: ${snap.per.toFixed(2)}`);
      if (snap.pbr > 0) lines.push(`  PBR: ${snap.pbr.toFixed(2)}`);
      if (snap.marketCapDisplay) lines.push(`  시총: ${snap.marketCapDisplay}`);
      lines.push('  (일별 순매수·공매도 추세는 AI 자체 판단 영역)');
    } else {
      lines.push('  스냅샷 조회 실패 — AI 자체 판단 필요');
    }
    return lines.join('\n');
  }).join('\n\n');

  const prompt = `
현재 한국 날짜: ${todayDate}

다음 종목들에 대해 "조용한 매집" 패턴을 분석해주세요. Google 검색 없이 아래 KIS 실데이터로 분석하세요.

[KIS API 실데이터 — 수급 및 공매도]
${kisDataBlocks}

위 데이터를 기반으로 각 종목의 매집 신호를 평가하세요:

[신호 1: 기관 소량 분할 매수 (INSTITUTIONAL_QUIET_BUY)]
- 기관 5일 순매수 합계 > 0 이고, 일별 순매수가 대부분 양수(연속 소량 매수)
- 가중치: 외인+기관 동반매수(YES)이면 강도 +2

[신호 2: 공매도 잔고 감소 (SHORT_DECREASE)]
- 공매도 추세가 DECREASING이면 감지

[신호 3: 외인 선행 매수 (VWAP_ABOVE_CLOSE 대리)]
- 외인 5일 순매수 합계 > 0 이고 기관도 순매수이면 Dark Pool 가능성

[신호 4~7: AI 지식 기반 판단]
- INSIDER_BUY, BUYBACK_ACTIVE: 해당 종목의 최근 DART 공시 지식으로 추정
- PRICE_FLOOR_RISING: 기관 연속 매수 패턴과 공매도 감소 조합으로 판단
- CALL_OI_SURGE: 섹터 ETF 옵션 동향 지식으로 추정

[종합 점수 계산]
- 각 신호 0-10점, 총합을 100점 만점으로 정규화
- 3개 이상 신호 감지: HIGH 확신 / 2개: MEDIUM / 1개 이하: LOW

[매집 단계 판정]
- EARLY(1-2개), MID(3-4개), LATE(5개+), NONE(0개)

응답 형식 (JSON only, 배열):
[
  {
    "code": "005930",
    "name": "종목명",
    "signals": [
      { "type": "INSTITUTIONAL_QUIET_BUY", "strength": 7, "description": "기관 7일 연속 소량 순매수 (일 평균 3,000주)", "daysDetected": 7 },
      { "type": "SHORT_DECREASE", "strength": 6, "description": "공매도 잔고 20일 전 대비 -42% 감소", "daysDetected": 20 }
    ],
    "compositeScore": 65,
    "confidenceLevel": "MEDIUM",
    "estimatedAccumulationDays": 15,
    "priceFloorTrend": "RISING",
    "volumeTrend": "DRYING",
    "accumulationPhase": "MID",
    "lastUpdated": "${requestedAtISO}"
  }
]
  `.trim();

  const cacheKey = `silent-accum-${stockCodes.map(s => s.code).sort().join('-')}-${todayDate}`;

  return getCachedAIResponse<SilentAccumulationResult[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            maxOutputTokens: 8000,
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as SilentAccumulationResult[];
    } catch (error) {
      console.error("Error detecting silent accumulation:", error);
      return [];
    }
  });
}
