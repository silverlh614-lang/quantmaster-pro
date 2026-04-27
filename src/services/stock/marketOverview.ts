// @responsibility stock marketOverview 서비스 모듈
import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, lsGet, withRetry, safeJsonParse, getCachedAIResponse } from './aiClient';
import { fetchHistoricalData } from './historicalData';
import {
  applyPrefilledOverlay,
  fetchPrefilledMarketData,
  type PrefilledMarketData,
} from './marketOverviewIndicators';
import type { MarketDataPoint, MarketOverview } from './types';

/** Yahoo Finance 시장 지표 조회 (서버 프록시 경유, CORS 없음) */
export async function fetchMarketIndicators(): Promise<{
  vix: number | null; us10yYield: number | null;
  usShortRate: number | null; samsungIri: number | null;
  vkospi: number | null;
  vkospiDayChange: number | null;   // VKOSPI 당일 변화율 (%)
  vkospi5dTrend: number | null;     // VKOSPI 5일 추세 (%)
  kospi:  { price: number; change: number; changePct: number } | null;
  kosdaq: { price: number; change: number; changePct: number } | null;
  ewyReturn:  number | null;
  mtumReturn: number | null;
}> {
  try {
    const res = await fetch('/api/market-indicators');
    if (!res.ok) throw new Error(`market-indicators ${res.status}`);
    return await res.json();
  } catch {
    return { vix: null, us10yYield: null, usShortRate: null, samsungIri: null,
             vkospi: null, vkospiDayChange: null, vkospi5dTrend: null,
             kospi: null, kosdaq: null, ewyReturn: null, mtumReturn: null };
  }
}

export async function syncMarketOverviewIndices(overview: MarketOverview): Promise<MarketOverview> {
  const indexPatterns: { pattern: RegExp; symbol: string }[] = [
    { pattern: /kospi|코스피/i, symbol: '^KS11' },
    { pattern: /kosdaq|코스닥/i, symbol: '^KQ11' },
    { pattern: /s\s*&?\s*p\s*500|spx/i, symbol: '^GSPC' },
    { pattern: /nasdaq|나스닥/i, symbol: '^IXIC' },
    { pattern: /dow\s*jones|다우/i, symbol: '^DJI' },
    { pattern: /nikkei|닛케이/i, symbol: '^N225' },
    { pattern: /csi\s*300/i, symbol: '000300.SS' },
  ];

  const updatedIndices = await Promise.all(
    (overview.indices || []).map(async (idx) => {
      const matched = indexPatterns.find(p => p.pattern.test(idx.name));
      const symbol = matched?.symbol ?? null;

      if (symbol) {
        try {
          const data = await fetchHistoricalData(symbol, '1d');
          if (data?.meta?.regularMarketPrice) {
            const price = data.meta.regularMarketPrice;
            const prevClose = data.meta.regularMarketPreviousClose || data.meta.previousClose;
            if (prevClose && prevClose > 0) {
              const change = Number((price - prevClose).toFixed(2));
              const changePercent = Number(((change / prevClose) * 100).toFixed(2));
              return { ...idx, value: price, change, changePercent };
            }
            return { ...idx, value: price };
          }
        } catch (e) {
          console.error(`Failed to sync index ${idx.name}`, e);
        }
      }
      return idx;
    })
  );

  return {
    ...overview,
    indices: updatedIndices,
    lastUpdated: new Date().toISOString()
  };
}

export async function getMarketOverview(): Promise<MarketOverview | null> {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];

  // ADR-0064: 가격성 데이터(지수/환율/원자재) 는 Yahoo 직접 fetch 로 사전 수집한다.
  // AI 는 더 이상 이 카테고리를 추정하지 않는다 — normalize 에서 overlay 로 강제 덮어쓴다.
  const [yahooCached, prefilledRes] = await Promise.allSettled([
    fetchMarketIndicators(),
    fetchPrefilledMarketData(),
  ]);
  const yahoo = yahooCached.status === 'fulfilled' ? yahooCached.value : null;
  const prefilled: PrefilledMarketData = prefilledRes.status === 'fulfilled'
    ? prefilledRes.value
    : { indices: [], exchangeRates: [], commodities: [], failedSymbols: [], fetchedAt: new Date().toISOString() };
  const macroCached = lsGet(`macro-environment-${todayDate}`)?.data as Record<string, unknown> | undefined;

  // KOSPI/KOSDAQ 는 fetchMarketIndicators 결과를 indices 에 합친다 (Yahoo intraday 신선도 우수).
  const kospiKosdaqIndices: MarketDataPoint[] = [];
  if (yahoo?.kospi) {
    kospiKosdaqIndices.push({
      name: 'KOSPI', value: yahoo.kospi.price, change: yahoo.kospi.change, changePercent: yahoo.kospi.changePct,
    });
  }
  if (yahoo?.kosdaq) {
    kospiKosdaqIndices.push({
      name: 'KOSDAQ', value: yahoo.kosdaq.price, change: yahoo.kosdaq.change, changePercent: yahoo.kosdaq.changePct,
    });
  }

  // USD/KRW 는 macroCached(ECOS) 우선 — JPY/EUR/KRW 는 prefilled 에서 옴.
  const fxOverlay: MarketDataPoint[] = [];
  if (typeof macroCached?.usdKrw === 'number' && macroCached.usdKrw > 0) {
    fxOverlay.push({
      name: 'USD/KRW', value: macroCached.usdKrw as number, change: 0, changePercent: 0,
    });
  }
  fxOverlay.push(...prefilled.exchangeRates);

  const preLines: string[] = [];
  if (yahoo?.kospi)      preLines.push(`- KOSPI: ${yahoo.kospi.price.toFixed(2)} (변동: ${yahoo.kospi.change >= 0 ? '+' : ''}${yahoo.kospi.change.toFixed(2)}, ${yahoo.kospi.changePct >= 0 ? '+' : ''}${yahoo.kospi.changePct.toFixed(2)}%)`);
  if (yahoo?.kosdaq)     preLines.push(`- KOSDAQ: ${yahoo.kosdaq.price.toFixed(2)} (변동: ${yahoo.kosdaq.change >= 0 ? '+' : ''}${yahoo.kosdaq.change.toFixed(2)}, ${yahoo.kosdaq.changePct >= 0 ? '+' : ''}${yahoo.kosdaq.changePct.toFixed(2)}%)`);
  for (const idx of prefilled.indices) {
    const sign = idx.change >= 0 ? '+' : '';
    preLines.push(`- ${idx.name}: ${idx.value.toFixed(2)} (변동: ${sign}${idx.change.toFixed(2)}, ${sign}${idx.changePercent.toFixed(2)}%)`);
  }
  if (yahoo?.vkospi)     preLines.push(`- VKOSPI: ${yahoo.vkospi.toFixed(2)}`);
  if (yahoo?.vix)        preLines.push(`- VIX: ${yahoo.vix.toFixed(2)}`);
  if (yahoo?.us10yYield) preLines.push(`- 미국 10년물 금리: ${yahoo.us10yYield.toFixed(2)}%`);
  if (macroCached?.usdKrw) preLines.push(`- USD/KRW: ${(macroCached.usdKrw as number).toFixed(0)}원`);
  for (const fx of prefilled.exchangeRates) {
    preLines.push(`- ${fx.name}: ${fx.value.toFixed(2)}`);
  }
  for (const c of prefilled.commodities) {
    const sign = c.change >= 0 ? '+' : '';
    preLines.push(`- ${c.name}: ${c.value.toFixed(2)} (변동: ${sign}${c.change.toFixed(2)}, ${sign}${c.changePercent.toFixed(2)}%)`);
  }
  if (yahoo?.ewyReturn != null)
    preLines.push(`- EWY(한국 ETF) 5일 수익률: ${yahoo.ewyReturn >= 0 ? '+' : ''}${yahoo.ewyReturn.toFixed(2)}%`);
  if (yahoo?.mtumReturn != null)
    preLines.push(`- MTUM(모멘텀 ETF) 5일 수익률: ${yahoo.mtumReturn >= 0 ? '+' : ''}${yahoo.mtumReturn.toFixed(2)}%`);
  const preFilledSection = preLines.length > 0
    ? `\n[사전 수집 실데이터 — 아래 값은 Yahoo 직접 fetch 로 확보됨. 이 수치를 그대로 JSON에 반영하라. AI 가 임의로 다른 값을 추정하면 안 된다.]\n${preLines.join('\n')}\n`
    : '';

  const prompt = `
    현재 한국 시각은 ${now}입니다. (오늘 날짜: ${todayDate})
    현재 글로벌 및 국내 주식 시장 상황을 종합적으로 분석해서 시각화에 적합한 JSON 데이터로 제공해줘.
${preFilledSection}
    다음 항목들을 포함해야 해:
    1. 주요 지수(indices): 위 사전 수집값을 그대로 indices 배열에 사용하라. AI 가 임의로 추가 지수를 추정하지 마라. (지수 이름은 반드시 영문 대문자로 통일할 것)
    2. 환율(exchangeRates): 위 사전 수집값(USD/KRW, JPY/KRW, EUR/KRW) 을 그대로 사용하라. AI 가 임의로 다른 환율을 추정하지 마라.
    3. 원자재(commodities): 위 사전 수집값(금, WTI 원유) 을 그대로 사용하라.
    4. 금리: 미국 10년물은 위 사전 수집값 사용. 한국 3년물 등은 최신 지식 기반으로 채워라.
    5. 거시경제 지표: 실업률(Unemployment Rate), 인플레이션(CPI/PCE), 중앙은행 기준금리 결정(Fed/BOK Interest Rate Decisions) 등
    6. SNS 시장 감성 (Sentiment): X(트위터), 네이버 종토방, 텔레그램 등 주요 커뮤니티의 현재 분위기를 분석하여 수치화 (0~100점).
       - trendingKeywords 필드에 현재 커뮤니티에서 가장 많이 언급되는 실시간 트렌드 키워드 5~10개를 배열로 제공 (예: "AI", "반도체", "방산", "SMR", "SK하이닉스")
    7. **[신규 퀀트 지표]**:
       - Sector Rotation: 현재 자금이 유입되고 있는 섹터와 유출되고 있는 섹터 분석
       - Euphoria Detector: 시장의 과열 여부를 판단하는 신호 (0~100, 100: 극도 과열)
       - Regime Shift Detector: 현재 시장의 장세 변화 감지 (BULL, BEAR, SIDEWAYS, TRANSITION)
       - Global ETF Monitoring: 주요 글로벌 ETF(SPY, QQQ, SOXX, KODEX 200 등)의 자금 흐름
       - Market Phase: 현재 시장의 단계 (Accumulation, Markup, Distribution, Markdown)
       - Active Strategy: 현재 장세에 가장 적합한 투자 전략 제안
    8. **[AI 동적 가중치 전략 (Dynamic Weighting)]**:
       - 현재 시장 상황(변동성, 금리, 환율, 섹터 순환 등)을 고려하여, 퀀트 엔진의 각 조건(Condition ID 1~27)에 적용할 최적의 가중치 배수(multiplier)를 산출해줘.
       - 결과는 "dynamicWeights": { "1": 1.2, "2": 0.8, ... } 형식으로 제공.
    9. **[매크로 이벤트 달력 (Upcoming Events)]**:
       - FOMC 금리 결정, 한국은행 기준금리 발표, 주요 대형주(삼성전자, SK하이닉스, 현대차 등) 실적 발표일 등 향후 2주 이내의 주요 이벤트를 찾아줘.
       - 각 이벤트에 대해 'strategyAdjustment' 필드에 구체적인 대응 전략을 포함해줘.
       - D-Day(dDay)를 계산하여 포함해줘. (오늘 날짜 기준)
    10. 시장 요약: 현재 시장의 핵심 이슈와 흐름을 3~4문장으로 요약

    응답 형식 (JSON):
    {
      "indices": [...],
      "exchangeRates": [...],
      "commodities": [...],
      "interestRates": [...],
      "macroIndicators": [...],
      "snsSentiment": { "score": 65, "status": "NEUTRAL", "summary": "...", "trendingKeywords": ["AI", "반도체", "방산", "SMR", "SK하이닉스"] },
      "sectorRotation": [
        { "sector": "반도체", "momentum": 85, "flow": "INFLOW" },
        { "sector": "이차전지", "momentum": 40, "flow": "OUTFLOW" }
      ],
      "euphoriaSignals": { "score": 45, "status": "NEUTRAL", "implication": "..." },
      "regimeShiftDetector": { "current": "BULL", "probability": 85, "signal": "BUY" },
      "globalEtfMonitoring": [
        { "name": "SPY", "flow": "INFLOW", "change": 1.2 },
        { "name": "QQQ", "flow": "INFLOW", "change": 1.5 }
      ],
      "marketPhase": "Markup",
      "activeStrategy": "추세 추종 및 주도주 집중 매수",
      "dynamicWeights": {
        "1": 1.2, "2": 1.5, "3": 1.0, "4": 1.1, "5": 1.3,
        "7": 1.0, "10": 0.9, "23": 1.0, "24": 1.4, "25": 1.2
      },
      "upcomingEvents": [...],
      "summary": "현재 시장은 ...",
      "lastUpdated": "${new Date().toISOString()}"
    }
  `;

  const hour = new Date().getHours();
  const cacheKey = `market-overview-${todayDate}-${Math.floor(hour / 6)}`;

  // ADR-0064: 캐시 miss 시점의 prefill 결과가 normalize 의 overlay 입력으로 들어간다.
  // 캐시 hit 시엔 이전 fetch 시점의 normalize 결과(이미 overlay 된 값) 가 그대로 재사용
  // 되어 6시간 캐시 윈도우 안에서 가격성 데이터는 동결. PR-β SWR 캐시 정책 도입 후엔
  // 짧은 fresh 윈도우(예: 60초) 내에서만 동결되고 stale 갱신마다 prefill 재실행.
  const indicesOverlay = [...kospiKosdaqIndices, ...prefilled.indices];

  return getCachedAIResponse(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      const raw = safeJsonParse(text) as Record<string, any>;
      return normalizeMarketOverview(raw, {
        indices: indicesOverlay,
        exchangeRates: fxOverlay,
        commodities: prefilled.commodities,
      });
    } catch (error) {
      console.error("Error getting market overview:", error);
      throw error;
    }
  });
}

/** Normalize the AI response to match the MarketOverview interface. */
export function normalizeMarketOverview(
  raw: Record<string, any>,
  prefillOverlay?: { indices: MarketDataPoint[]; exchangeRates: MarketDataPoint[]; commodities: MarketDataPoint[] },
): MarketOverview {
  // sectorRotation: AI returns flat array, but type expects { topSectors: [...] }
  let sectorRotation = raw.sectorRotation;
  if (Array.isArray(sectorRotation)) {
    sectorRotation = {
      topSectors: sectorRotation.map((s: any, i: number) => ({
        name: s.sector || s.name || '',
        rank: s.rank ?? i + 1,
        strength: s.momentum ?? s.strength ?? 0,
        isLeading: s.isLeading ?? (s.flow === 'INFLOW'),
        sectorLeaderNewHigh: s.sectorLeaderNewHigh ?? false,
        flow: s.flow,
      })),
    };
  }

  // regimeShiftDetector: AI returns { current, probability, signal }
  // but type expects { currentRegime, shiftProbability, leadingIndicator }
  const rsd = raw.regimeShiftDetector;
  const regimeShiftDetector = rsd
    ? {
        currentRegime: rsd.currentRegime || rsd.current || 'Stable',
        shiftProbability: rsd.shiftProbability ?? (typeof rsd.probability === 'number' ? rsd.probability / 100 : 0),
        leadingIndicator: rsd.leadingIndicator || rsd.signal || '',
        isShiftDetected: rsd.isShiftDetected ?? false,
      }
    : undefined;

  // ADR-0064: prefill overlay — Yahoo 직접 fetch 로 확보한 가격성 데이터(지수/환율/원자재)
  // 가 ≥1 항목 있으면 AI 응답을 무시하고 prefill 결과로 덮어쓴다. AI hallucination 차단.
  // prefill 카테고리가 빈 배열(모든 심볼 fetch 실패) 이면 AI 응답 fallback 유지.
  const overlayed = prefillOverlay
    ? applyPrefilledOverlay(
        { indices: raw.indices, exchangeRates: raw.exchangeRates, commodities: raw.commodities },
        {
          indices: prefillOverlay.indices,
          exchangeRates: prefillOverlay.exchangeRates,
          commodities: prefillOverlay.commodities,
          failedSymbols: [],
          fetchedAt: new Date().toISOString(),
        },
      )
    : null;

  return {
    ...raw,
    ...(overlayed ?? {}),
    sectorRotation,
    regimeShiftDetector,
  } as MarketOverview;
}
