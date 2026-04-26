// @responsibility stock backtestService 서비스 모듈
import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, withRetry, safeJsonParse, getCachedAIResponse } from './aiClient';
import { safePctChange } from '../../utils/safePctChange';
import type {
  BacktestResult,
  BacktestPosition,
  BacktestPortfolioState,
  BacktestDailyLog,
} from '../../types/portfolio';
import type {
  AdvancedAnalysisResult,
  WalkForwardAnalysis,
} from './types';
import type { RegimeLevel, StockProfileType } from '../../types/quant';
import { REGIME_CONFIGS } from '../quant/regimeEngine';
import { PROFIT_TARGETS } from '../quant/sellEngine';
import { fetchHistoricalData } from './historicalData';

export async function backtestPortfolio(
  portfolio: { name: string; code: string; weight: number }[],
  initialEquity: number = 100000000,
  years: number = 1,
  regime: RegimeLevel = 'R2_BULL',
  profileType: StockProfileType = 'B',
): Promise<BacktestResult> {
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - years * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    const [historicalResults, benchmarkData] = await (async () => {
      const results = [];
      for (const p of portfolio) {
        results.push(await fetchHistoricalData(p.code, `${years + 1}y`));
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      const benchmark = await fetchHistoricalData('^KS11', `${years + 1}y`);
      return [results, benchmark];
    })();

    const allDatesSet = new Set<string>();
    const priceMap: Record<string, Record<string, number>> = {};
    const openPriceMap: Record<string, Record<string, number>> = {};
    const highPriceMap: Record<string, Record<string, number>> = {};
    const lowPriceMap: Record<string, Record<string, number>> = {};

    historicalResults.forEach((data, idx) => {
      if (data && data.timestamp) {
        const symbol = portfolio[idx].code;
        data.timestamp.forEach((ts: number, i: number) => {
          const date = new Date(ts * 1000).toISOString().split('T')[0];
          if (date >= startDate && date <= endDate) {
            allDatesSet.add(date);
            if (!priceMap[date]) priceMap[date] = {};
            if (!openPriceMap[date]) openPriceMap[date] = {};
            if (!highPriceMap[date]) highPriceMap[date] = {};
            if (!lowPriceMap[date]) lowPriceMap[date] = {};

            const close = data.indicators.quote[0].close[i];
            const open = data.indicators.quote[0].open[i];
            const high = data.indicators.quote[0].high[i];
            const low = data.indicators.quote[0].low[i];

            if (close !== null) priceMap[date][symbol] = close;
            if (open !== null) openPriceMap[date][symbol] = open;
            if (high !== null) highPriceMap[date][symbol] = high;
            if (low !== null) lowPriceMap[date][symbol] = low;
          }
        });
      }
    });

    const benchmarkPriceMap: Record<string, number> = {};
    if (benchmarkData && benchmarkData.timestamp) {
      const quotes = benchmarkData.indicators.quote[0].close;
      benchmarkData.timestamp.forEach((ts: number, i: number) => {
        const date = new Date(ts * 1000).toISOString().split('T')[0];
        const val = quotes[i];
        if (val !== null) benchmarkPriceMap[date] = val;
      });
    }

    const sortedDates = Array.from(allDatesSet).sort();
    if (sortedDates.length === 0) throw new Error("No historical data found for the selected period.");

    let state: BacktestPortfolioState = {
      cash: initialEquity,
      positions: [],
      equity: initialEquity,
      initialEquity
    };

    const dailyLogs: BacktestDailyLog[] = [];
    let peak = initialEquity;
    let mdd = 0;

    const BUY_COST_RATIO  = 1.00115;
    const SELL_COST_RATIO = 0.99655;

    // ── 레짐·프로파일 설정 연결 ──────────────────────────────────────────────
    const profileKey    = `profile${profileType}` as keyof typeof REGIME_CONFIGS[typeof regime]['stopLoss'];
    const stopLossRate  = REGIME_CONFIGS[regime].stopLoss[profileKey]; // e.g., -0.10
    const limitTranches = PROFIT_TARGETS[regime].filter(t => t.type === 'LIMIT' && t.trigger !== null);
    const trailPct      = PROFIT_TARGETS[regime].find(t => t.type === 'TRAILING')?.trailPct ?? 0.10;

    /** 포지션 생성 헬퍼 — 레짐 config 기반 손절·익절 설정 주입 */
    const makePosition = (
      code: string, name: string,
      entryPrice: number, quantity: number,
      date: string, currentPrice: number,
    ): BacktestPosition => ({
      stockCode:  code,
      stockName:  name,
      entryPrice,
      quantity,
      originalQuantity: quantity,
      entryDate:  date,
      stopLoss:   entryPrice * (1 + stopLossRate),   // e.g., *0.90 for -10%
      takeProfit: Infinity,                            // 단일 목표가 미사용 (profitTranches 대체)
      currentPrice,
      unrealizedReturn: 0,
      profitTranches: limitTranches.map(t => ({
        price:  entryPrice * (1 + t.trigger!),
        ratio:  t.ratio,
        taken:  false,
      })),
      trailingHighWaterMark: entryPrice,
      trailPct,
      trailingEnabled: false,
    });

    const closedTrades: { profit: number; isWin: boolean }[] = [];

    const firstDate = sortedDates[0];
    portfolio.forEach(p => {
      const openPrice = openPriceMap[firstDate]?.[p.code] || priceMap[firstDate]?.[p.code];
      if (openPrice) {
        const targetValue  = initialEquity * (p.weight / 100);
        const realBuyPrice = openPrice * BUY_COST_RATIO;
        const quantity     = Math.floor(targetValue / realBuyPrice);
        const cost         = quantity * realBuyPrice;

        if (quantity > 0 && state.cash >= cost) {
          state.positions.push(makePosition(p.code, p.name, realBuyPrice, quantity, firstDate, openPrice));
          state.cash -= cost;
        }
      }
    });

    sortedDates.forEach((date, dateIdx) => {
      if (dateIdx > 0 && dateIdx % 20 === 0) {
        const prevDate = sortedDates[dateIdx - 1];
        const currentEquity = state.equity;

        const targetPositions = portfolio.map(p => {
          const targetValue = currentEquity * (p.weight / 100);
          const openPrice = openPriceMap[date]?.[p.code] || priceMap[prevDate]?.[p.code];
          return { ...p, targetValue, openPrice };
        });

        const nextPositions: BacktestPosition[] = [];
        state.positions.forEach(pos => {
          const target = targetPositions.find(tp => tp.code === pos.stockCode);
          const openPrice = openPriceMap[date]?.[pos.stockCode] || pos.currentPrice;

          if (!target) {
            state.cash += pos.quantity * openPrice * SELL_COST_RATIO;
          } else {
            const currentVal = pos.quantity * openPrice;
            if (currentVal > target.targetValue * 1.1) {
              const excessVal = currentVal - target.targetValue;
              const sellQty = Math.floor(excessVal / (openPrice * SELL_COST_RATIO));
              if (sellQty > 0) {
                state.cash += sellQty * openPrice * SELL_COST_RATIO;
                nextPositions.push({ ...pos, quantity: pos.quantity - sellQty });
              } else {
                nextPositions.push(pos);
              }
            } else {
              nextPositions.push(pos);
            }
          }
        });
        state.positions = nextPositions;

        targetPositions.forEach(target => {
          const existingPos = state.positions.find(p => p.stockCode === target.code);
          const openPrice = target.openPrice;
          if (!openPrice) return;

          const currentVal = existingPos ? existingPos.quantity * openPrice : 0;
          if (currentVal < target.targetValue * 0.9) {
            const deficitVal = target.targetValue - currentVal;
            const buyQty = Math.floor(deficitVal / (openPrice * BUY_COST_RATIO));
            if (buyQty > 0 && state.cash >= buyQty * openPrice * BUY_COST_RATIO) {
              state.cash -= buyQty * openPrice * BUY_COST_RATIO;
              if (existingPos) {
                const prevQty  = existingPos.quantity;
                const newEntry = (existingPos.entryPrice * prevQty + openPrice * buyQty) / (prevQty + buyQty);
                existingPos.entryPrice        = newEntry;
                existingPos.quantity         += buyQty;
                existingPos.originalQuantity += buyQty;
                existingPos.stopLoss          = newEntry * (1 + stopLossRate);
              } else {
                const buyPrice = openPrice * BUY_COST_RATIO;
                state.positions.push(makePosition(target.code, target.name, buyPrice, buyQty, date, openPrice));
              }
            }
          }
        });
      }

      let positionsValue = 0;
      state.positions.forEach((pos: BacktestPosition) => {
        const closePrice = priceMap[date][pos.stockCode] || pos.currentPrice;
        pos.currentPrice = closePrice;
        pos.unrealizedReturn = (closePrice - pos.entryPrice) / pos.entryPrice;
        positionsValue += pos.quantity * closePrice;
      });

      state.equity = state.cash + positionsValue;

      if (state.equity > peak) peak = state.equity;
      const currentDD = (peak - state.equity) / peak;
      if (currentDD > mdd) mdd = currentDD;

      const benchmarkVal = benchmarkPriceMap[date] || 1;
      const firstBenchmark = benchmarkPriceMap[sortedDates[0]] || 1;

      dailyLogs.push({
        date,
        equity: state.equity,
        cash: state.cash,
        positionsValue,
        drawdown: currentDD * 100,
        returns: safePctChange(state.equity, initialEquity, { label: 'backtest.returns' }) ?? 0,
        benchmarkValue: (benchmarkVal / firstBenchmark) * 100
      });

      // 트레일링 고점 갱신 (종가 기준, 매도 루프 전에 실행)
      state.positions.forEach(pos => {
        if (pos.currentPrice > pos.trailingHighWaterMark) {
          pos.trailingHighWaterMark = pos.currentPrice;
        }
      });

      const remainingPositions: BacktestPosition[] = [];
      state.positions.forEach((pos: BacktestPosition) => {
        const lowPrice  = lowPriceMap[date]?.[pos.stockCode]  || pos.currentPrice;
        const highPrice = highPriceMap[date]?.[pos.stockCode] || pos.currentPrice;

        // L1: 하드 손절 (일중 저가 기준 — 최우선)
        if (lowPrice <= pos.stopLoss) {
          const exitPrice = pos.stopLoss * SELL_COST_RATIO;
          state.cash += pos.quantity * exitPrice;
          closedTrades.push({ profit: (exitPrice - pos.entryPrice) * pos.quantity, isWin: false });
          return; // 전량 청산
        }

        // L3: 분할 익절 (일중 고가 기준, originalQuantity 비율 적용)
        for (const tranche of pos.profitTranches) {
          if (tranche.taken || highPrice < tranche.price) continue;
          const targetQty = Math.round(pos.originalQuantity * tranche.ratio);
          const sellQty   = Math.min(targetQty, pos.quantity);
          if (sellQty <= 0) continue;
          const exitPrice = tranche.price * SELL_COST_RATIO;
          state.cash += sellQty * exitPrice;
          closedTrades.push({ profit: (exitPrice - pos.entryPrice) * sellQty, isWin: true });
          pos.quantity -= sellQty;
          tranche.taken = true;
        }

        // 모든 LIMIT 트랜치 완료 → 트레일링 활성화
        if (!pos.trailingEnabled && pos.profitTranches.length > 0 && pos.profitTranches.every(t => t.taken)) {
          pos.trailingEnabled = true;
        }

        // L3: 트레일링 스톱 (일중 저가 기준)
        if (pos.trailingEnabled && pos.quantity > 0) {
          const trailTrigger = pos.trailingHighWaterMark * (1 - pos.trailPct);
          if (lowPrice <= trailTrigger) {
            const exitPrice = trailTrigger * SELL_COST_RATIO;
            state.cash += pos.quantity * exitPrice;
            closedTrades.push({ profit: (exitPrice - pos.entryPrice) * pos.quantity, isWin: exitPrice > pos.entryPrice });
            return; // 잔여 전량 청산
          }
        }

        if (pos.quantity > 0) remainingPositions.push(pos);
      });
      state.positions = remainingPositions;
    });

    const finalEquity = state.equity;
    // ADR-0028: backtest 결과는 ±수백% 도 가능 — sanity bound override 1000%.
    const totalReturn = safePctChange(finalEquity, initialEquity, {
      label: 'backtest.totalReturn',
      sanityBoundPct: 1000,
    }) ?? 0;
    const durationYears = sortedDates.length / 252;
    const cagr = (Math.pow(finalEquity / initialEquity, 1 / durationYears) - 1) * 100;

    const dailyReturns = dailyLogs.map((log, i) => {
      if (i === 0) return 0;
      return (log.equity - dailyLogs[i-1].equity) / dailyLogs[i-1].equity;
    });
    const avgDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const stdDevDailyReturn = Math.sqrt(dailyReturns.reduce((a, b) => a + Math.pow(b - avgDailyReturn, 2), 0) / dailyReturns.length) || 0.0001;
    const sharpe = (avgDailyReturn / stdDevDailyReturn) * Math.sqrt(252);

    const wins = closedTrades.filter(t => t.isWin).length;
    const losses = closedTrades.filter(t => !t.isWin).length;
    const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;

    const totalWinAmount = closedTrades.filter(t => t.isWin).reduce((sum, t) => sum + t.profit, 0);
    const totalLossAmount = Math.abs(closedTrades.filter(t => !t.isWin).reduce((sum, t) => sum + t.profit, 0));
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? 10 : 0;

    const portfolioStr = portfolio.map(p => `${p.name}(${p.code}): ${p.weight}%`).join(', ');
    const aiPrompt = `
      [퀀트 백테스트 심층 분석]
      포트폴리오: ${portfolioStr}
      초기 자산: ${initialEquity.toLocaleString()}원
      최종 자산: ${finalEquity.toLocaleString()}원
      누적 수익률: ${totalReturn.toFixed(2)}%
      CAGR (연평균 수익률): ${cagr.toFixed(2)}%
      MDD (최대 낙폭): ${(mdd * 100).toFixed(2)}%
      샤프 지수: ${sharpe.toFixed(2)}
      승률: ${winRate.toFixed(2)}%
      Profit Factor: ${profitFactor.toFixed(2)}

      위 실제 시뮬레이션 데이터를 바탕으로 '퀀트 펀드 매니저'의 관점에서 분석을 수행해줘.
      1. 이 전략의 리스크 대비 수익성(Risk-Adjusted Return)을 평가하라.
      2. 하락장에서의 방어력과 상승장에서의 탄력성을 분석하라.
      3. 수수료와 슬리피지를 고려했을 때 실전 매매 가능 여부를 판별하라.
      4. 포트폴리오 최적화(비중 조절, 종목 교체)를 위한 구체적인 액션 플랜을 제시하라.

      응답은 반드시 다음 JSON 형식으로만 해줘:
      {
        "aiAnalysis": "...",
        "optimizationSuggestions": [{ "stock": "...", "action": "...", "currentWeight": 0, "recommendedWeight": 0, "reason": "..." }],
        "newThemeSuggestions": [{ "theme": "...", "stocks": ["..."], "reason": "..." }],
        "riskyStocks": [{ "stock": "...", "reason": "...", "riskLevel": "..." }],
        "riskMetrics": { "beta": 1.0, "alpha": 0.0, "treynorRatio": 0.0 }
      }
    `;

    const response = await withRetry(async () => {
      return await getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: aiPrompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0,
        }
      });
    }, 2, 2000);
    const text = response.text;
    const aiParsed = safeJsonParse(text);

    let maxStreak = 0, curStreak = 0;
    closedTrades.forEach(t => {
      curStreak = t.isWin ? 0 : curStreak + 1;
      maxStreak = Math.max(maxStreak, curStreak);
    });

    return {
      dailyLogs,
      finalEquity,
      totalReturn,
      cagr,
      mdd: mdd * 100,
      sharpe,
      winRate,
      profitFactor,
      avgWin: totalWinAmount / (wins || 1),
      avgLoss: totalLossAmount / (losses || 1),
      maxConsecutiveLoss: maxStreak,
      trades: closedTrades.length,
      cumulativeReturn: totalReturn,
      annualizedReturn: cagr,
      sharpeRatio: sharpe,
      maxDrawdown: mdd * 100,
      volatility: stdDevDailyReturn * Math.sqrt(252) * 100,
      performanceData: dailyLogs.map(log => ({
        date: log.date,
        value: (log.equity / initialEquity) * 100,
        benchmark: log.benchmarkValue
      })),
      aiAnalysis: aiParsed.aiAnalysis || "분석 완료",
      optimizationSuggestions: aiParsed.optimizationSuggestions || [],
      newThemeSuggestions: aiParsed.newThemeSuggestions || [],
      riskyStocks: aiParsed.riskyStocks || [],
      riskMetrics: aiParsed.riskMetrics || { beta: 1.0, alpha: 0, treynorRatio: 0 }
    };

  } catch (error) {
    console.error("Error in advanced backtesting:", error);
    throw error;
  }
}

export async function runAdvancedAnalysis(type: 'BACKTEST' | 'WALK_FORWARD' | 'PAPER_TRADING', period?: string): Promise<AdvancedAnalysisResult> {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  let prompt = "";
  if (type === 'BACKTEST') {
    prompt = `
      [과거 데이터 백테스팅 (Back-Testing) 분석 요청]
      현재 시각: ${now}
      대상 기간: ${period || "2022년 금리 인상기 vs 2024년 상반기 순환매 장세"}

      [분석 요구사항]
      1. 27가지 마스터 체크리스트 조건 중 해당 기간 동안 '수익률 기여도가 가장 높았던 항목' 3개와 '오히려 노이즈가 되었던 항목' 2개를 선정하라.
      2. 장세 판단 엔진이 가중치를 변경했을 때, 실제 하락장에서의 방어력 향상 수치를 시뮬레이션하라.
      3. 전체 수익률, 승률, MDD, 샤프 지수를 산출하라.
      4. 'googleSearch'를 사용하여 해당 기간의 실제 시장 상황(KOSPI, 금리, 환율 등)을 참고하여 분석의 신뢰도를 높여라.

      응답은 반드시 다음 JSON 형식으로만 해줘:
      {
        "type": "BACKTEST",
        "period": "${period || '2022-2024 분석'}",
        "metrics": {
          "totalReturn": 15.5,
          "winRate": 62.5,
          "maxDrawdown": -8.4,
          "sharpeRatio": 1.45
        },
        "performanceData": [
          { "date": "2022-01", "value": 100, "benchmark": 100 },
          { "date": "2022-06", "value": 90, "benchmark": 85 },
          { "date": "2022-12", "value": 85, "benchmark": 75 }
        ],
        "topContributors": [
          { "name": "항목명", "weight": 45, "impact": "POSITIVE" }
        ],
        "noiseItems": ["항목1", "항목2"],
        "description": "AI 기반 백테스팅 결과 요약 및 인사이트..."
      }
    `;
  } else if (type === 'WALK_FORWARD') {
    prompt = `
      [전진 분석 (Walk-Forward Analysis) 분석 요청]
      현재 시각: ${now}
      방법: 2025년 최적화 로직을 2026년 최근 3개월 데이터에 대입

      [분석 요구사항]
      1. 'googleSearch'를 사용하여 2025년과 2026년 초(현재까지)의 한국 시장 트렌드를 검색하라.
      2. 과최적화(Over-fitting) 여부를 판별하라.
      3. 최신 트렌드에서 주도주 포착 정확도를 산출하라.
      4. Robustness Score(강건성 점수)를 100점 만점으로 계산하라.

      응답은 반드시 다음 JSON 형식으로만 해줘:
      {
        "type": "WALK_FORWARD",
        "period": "2025 -> 2026 Q1",
        "metrics": {
          "accuracy": 78.5,
          "robustnessScore": 85
        },
        "performanceData": [
          { "date": "2025-Q1", "value": 100, "benchmark": 100 },
          { "date": "2025-Q4", "value": 120, "benchmark": 110 },
          { "date": "2026-Q1", "value": 125, "benchmark": 112 }
        ],
        "description": "전진 분석 결과 및 과최적화 판별 보고서..."
      }
    `;
  } else {
    prompt = `
      [페이퍼 트레이딩 (Paper Trading) & 로그 분석 요청]
      현재 시각: ${now}

      [분석 요구사항]
      1. 'googleSearch'를 사용하여 '오늘' 또는 '최근 2일'간의 한국 증시 주도주를 검색하라.
      2. 최근 2일간의 가상 '마스터 픽' Top 3 종목을 생성하라.
      3. 각 종목의 [진입가 / 손절가 / 목표가]를 설정하라. (현재가 기준)
      4. 27번(촉매) 분석이 실제 주가 폭발의 '트리거'가 되었는지, 아니면 재료 소멸로 작동했는지 AI 피드백 루프를 생성하라.

      응답은 반드시 다음 JSON 형식으로만 해줘:
      {
        "type": "PAPER_TRADING",
        "period": "최근 2일",
        "metrics": {},
        "description": "페이퍼 트레이딩 성과 요약",
        "paperTradeLogs": [
          {
            "date": "2026-03-26",
            "picks": [
              {
                "name": "종목명",
                "code": "000000",
                "entryPrice": 50000,
                "stopLoss": 48000,
                "targetPrice": 55000,
                "currentPrice": 52000,
                "status": "PROFIT",
                "catalyst": "촉매 분석 내용...",
                "pnl": 4.0
              }
            ],
            "aiFeedback": "AI 피드백 루프 내용..."
          }
        ]
      }
    `;
  }

  try {
    const parsed = await withRetry(async () => {
      const response = await getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          toolConfig: { includeServerSideToolInvocations: true },
          maxOutputTokens: 2048,
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

    if (parsed) {
      if (!parsed.performanceData) parsed.performanceData = [];
      if (!parsed.paperTradeLogs) parsed.paperTradeLogs = [];
      if (!parsed.metrics) parsed.metrics = {};
    }

    return parsed;
  } catch (error) {
    console.error("Error running advanced analysis:", error);
    throw error;
  }
}

export async function performWalkForwardAnalysis(): Promise<WalkForwardAnalysis | null> {
  const prompt = `
    QuantMaster Pro의 'Walk-Forward Analysis' 기능을 실행해줘.

    분석 조건:
    1. In-Sample (훈련): 2025년 전체 데이터 기반 최적화 로직
    2. Out-of-Sample (검증): 2026년 최근 3개월 (1월~3월) 실전 데이터

    분석 항목:
    - 과최적화(Overfitting) 여부 판별 (IS vs OOS 성과 차이 분석)
    - 최신 트렌드 적응력 검증:
      * AI & 반도체 (AI 인프라, HBM, 온디바이스 AI 등 핵심 기술 테마)
      * 밸류업 (기업 가치 제고 프로그램 및 저PBR 테마)
    - Robustness Score 산출 (0~100점)

    응답 형식 (JSON):
    {
      "period": "2025 (IS) vs 2026 Q1 (OOS)",
      "robustnessScore": 88,
      "overfittingRisk": "LOW",
      "trendAdaptability": {
        "aiSemiconductor": 92,
        "valueUp": 85,
        "overall": 89
      },
      "metrics": {
        "sharpeRatio": { "inSample": 2.4, "outOfSample": 2.1 },
        "maxDrawdown": { "inSample": -8.5, "outOfSample": -9.2 },
        "winRate": { "inSample": 68, "outOfSample": 65 }
      },
      "insights": [
        "2025년의 고성장주 중심 로직이 2026년 초 밸류업 장세에서도 견고한 방어력을 보임",
        "AI & 반도체 섹터로의 자금 유입을 정확히 포착하여 OOS 수익률 기여도 높음"
      ],
      "recommendations": [
        "현재 로직의 Robustness가 높으므로 유지하되, 저PBR 종목 필터링 가중치를 5% 상향 조정 권장",
        "AI 테마 내에서 실질적인 매출 발생 기업 위주로 포트폴리오 압축 필요"
      ]
    }
  `;

  const cacheKey = `walk-forward-analysis-${new Date().toISOString().split('T')[0]}`;

  return getCachedAIResponse(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: 0,
          }
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      return safeJsonParse(text);
    } catch (error) {
      console.error("Error performing Walk-Forward Analysis:", error);
      throw error;
    }
  });
}
