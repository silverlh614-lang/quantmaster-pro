import { useEffect } from 'react';
import { toast } from 'sonner';
import { useRecommendationStore, useTradeStore, useSettingsStore, useRecommendationSnapshotStore } from '../stores';
import { useAttributionStore } from '../stores/useAttributionStore';
import { useGlobalIntelStore } from '../stores/useGlobalIntelStore';
import { computeConditionPerformance } from '../components/trading/TradeJournal';
import { saveEvolutionWeights } from '../services/quant/evolutionEngine';
import { runAttributionAnalysis, pushAttributionToServer } from '../services/autoTrading';
import { classifyLossReason } from '../services/quant/lossReasonClassifier';
import type { StockRecommendation } from '../services/stockService';
import type { TradeRecord, ConditionId, PreMortemItem } from '../types/quant';

// Gate 2 조건 ID 목록 (gate2PassCount 계산용)
const GATE2_IDS = [4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 21, 24];

/** 손절 종료 시 반실패 패턴 DB에 스냅샷을 저장한다 */
async function pushFailurePatternToServer(
  trade: TradeRecord,
  returnPct: number,
  vkospi?: number | null,
  rsPercentile?: number | null,
): Promise<void> {
  const conditionScores = trade.conditionScores ?? {};
  // Gate 2 통과 조건 수: conditionScores에서 직접 계산
  const gate2PassCount = GATE2_IDS.filter(id => (conditionScores[id as ConditionId] ?? 0) >= 5).length;

  try {
    await fetch('/api/failure-patterns/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `fp_${trade.id}`,
        stockCode: trade.stockCode,
        stockName: trade.stockName,
        entryDate: trade.buyDate,
        exitDate: new Date().toISOString(),
        returnPct,
        conditionScores,
        gate1Score: trade.gate1Score,
        gate2Score: trade.gate2Score,
        gate3Score: trade.gate3Score,
        finalScore: trade.finalScore,
        gate2PassCount,
        rsPercentile: rsPercentile ?? null,
        vkospi: vkospi ?? null,
        sector: trade.sector ?? null,
        savedAt: new Date().toISOString(),
      }),
    });
  } catch {
    // 네트워크 오류 무시 — 백그라운드 작업
  }
}

export function useTradeOps() {
  const { watchlist, setWatchlist } = useRecommendationStore();
  const { tradeRecords, setTradeRecords } = useTradeStore();
  const { subscribedSectors, setSubscribedSectors } = useSettingsStore();

  const toggleWatchlist = (stock: StockRecommendation) => {
    setWatchlist((prev: StockRecommendation[]) => {
      const current = prev || [];
      const exists = current.find(s => s.code === stock.code);
      if (exists) return current.filter(s => s.code !== stock.code);
      return [...current, { ...stock, watchedPrice: stock.currentPrice, watchedAt: new Date().toLocaleDateString('ko-KR') }];
    });
  };

  const recordTrade = (
    stock: StockRecommendation,
    buyPrice: number,
    quantity: number,
    positionSize: number,
    followedSystem: boolean,
    conditionScores: Record<ConditionId, number>,
    gateScores: { g1: number; g2: number; g3: number; final: number },
    preMortems?: PreMortemItem[],
    conditionSources?: Record<ConditionId, 'COMPUTED' | 'AI'>,
    evaluationSnapshot?: TradeRecord['evaluationSnapshot'],
  ) => {
    const tradeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // ADR-0019 (PR-B): RecommendationSnapshot 양방향 추적 — PENDING snapshot 이
    // 있으면 OPEN 으로 승격 + tradeId 연결. snapshot 이 없는 수동 매수도 허용.
    const snapStore = useRecommendationSnapshotStore.getState();
    snapStore.markOpen(stock.code, tradeId);
    const linkedSnapshot = useRecommendationSnapshotStore
      .getState()
      .snapshots.find(s => s.tradeId === tradeId);

    const newTrade: TradeRecord = {
      id: tradeId,
      stockCode: stock.code, stockName: stock.name, sector: stock.relatedSectors?.[0] ?? 'Unknown',
      buyDate: new Date().toISOString(), buyPrice, quantity, positionSize,
      systemSignal: stock.type === 'STRONG_BUY' ? 'STRONG_BUY' : stock.type === 'BUY' ? 'BUY' : stock.type === 'SELL' || stock.type === 'STRONG_SELL' ? 'SELL' : 'NEUTRAL',
      recommendation: gateScores.final >= 200 ? '풀 포지션' : gateScores.final >= 150 ? '절반 포지션' : '관망',
      gate1Score: gateScores.g1, gate2Score: gateScores.g2, gate3Score: gateScores.g3, finalScore: gateScores.final,
      conditionScores, followedSystem, status: 'OPEN', currentPrice: stock.currentPrice, unrealizedPct: 0,
      preMortems: preMortems ?? [],
      peakPrice: buyPrice,
      // ADR-0018: 자기학습 데이터 무결성 — v2 schema
      conditionSources,
      evaluationSnapshot,
      schemaVersion: 2,
      // ADR-0019: snapshot 양방향 링크
      recommendationSnapshotId: linkedSnapshot?.id,
    };
    setTradeRecords((prev: TradeRecord[]) => [...prev, newTrade]);
  };

  const closeTrade = (tradeId: string, sellPrice: number, sellReason: TradeRecord['sellReason']) => {
    const trade = tradeRecords.find((t: TradeRecord) => t.id === tradeId);
    // ADR-0021 (PR-D): 손실 거래 자동 분류 — 매도 시점 macroEnv.vkospi 캡처.
    const macroEnvSnapshot = useGlobalIntelStore.getState().macroEnv;

    setTradeRecords((prev: TradeRecord[]) => prev.map((t: TradeRecord) => {
      if (t.id !== tradeId) return t;
      const returnPct = ((sellPrice - t.buyPrice) / t.buyPrice) * 100;
      const holdingDays = Math.round((Date.now() - new Date(t.buyDate).getTime()) / (1000 * 60 * 60 * 24));

      // ADR-0021: returnPct < 0 일 때만 lossReason 자동 분류 진입.
      // 사용자 수동 override 가 이미 있으면 (lossReasonAuto=false) 보존.
      let lossMeta: Pick<TradeRecord, 'lossReason' | 'lossReasonAuto' | 'lossReasonClassifiedAt'> = {};
      const userManualSet = t.lossReason && t.lossReasonAuto === false;
      if (returnPct < 0 && !userManualSet) {
        const reason = classifyLossReason({
          returnPct: parseFloat(returnPct.toFixed(2)),
          holdingDays,
          buyPrice: t.buyPrice,
          sellPrice,
          conditionScores: t.conditionScores,
          vkospiAtBuy: t.evaluationSnapshot?.vkospiAtBuy,
          vkospiAtSell:
            typeof macroEnvSnapshot?.vkospi === 'number' && macroEnvSnapshot.vkospi > 0
              ? macroEnvSnapshot.vkospi
              : undefined,
          sellReason,
        });
        lossMeta = {
          lossReason: reason,
          lossReasonAuto: true,
          lossReasonClassifiedAt: new Date().toISOString(),
        };
      }

      return {
        ...t,
        sellDate: new Date().toISOString(),
        sellPrice,
        sellReason,
        returnPct: parseFloat(returnPct.toFixed(2)),
        holdingDays,
        status: 'CLOSED' as const,
        ...lossMeta,
      };
    }));

    if (trade) {
      const returnPctClose = ((sellPrice - trade.buyPrice) / trade.buyPrice) * 100;
      // ADR-0019 (PR-B): 연결된 snapshot 이 있으면 CLOSED 전이.
      // 매수 시점에 snapshot 이 없었어도 무영향 (markClosed 가 no-op).
      useRecommendationSnapshotStore.getState().markClosed(tradeId, returnPctClose);
    }

    if (trade && trade.conditionScores && Object.keys(trade.conditionScores).length > 0) {
      const returnPct = ((sellPrice - trade.buyPrice) / trade.buyPrice) * 100;
      const holdingDays = Math.round((Date.now() - new Date(trade.buyDate).getTime()) / (1000 * 60 * 60 * 24));
      const { accumulate } = useAttributionStore.getState();
      runAttributionAnalysis(trade.conditionScores, returnPct, accumulate);
      void pushAttributionToServer({
        tradeId: trade.id,
        stockCode: trade.stockCode,
        stockName: trade.stockName,
        closedAt: new Date().toISOString(),
        returnPct: parseFloat(returnPct.toFixed(2)),
        isWin: returnPct > 0,
        conditionScores: trade.conditionScores,
        holdingDays,
        sellReason: sellReason ?? undefined,
      });

      // 손절(returnPct < 0) 시 반실패 패턴 DB에 스냅샷 저장
      if (returnPct < 0) {
        const macroEnv = useGlobalIntelStore.getState().macroEnv;
        void pushFailurePatternToServer(
          trade,
          parseFloat(returnPct.toFixed(2)),
          macroEnv?.vkospi ?? null,
          null,  // rsPercentile: 현재 TradeRecord에 미포함
        );
      }
    }
  };

  const deleteTrade = (tradeId: string) => {
    setTradeRecords((prev: TradeRecord[]) => prev.filter((t: TradeRecord) => t.id !== tradeId));
  };

  const updateTradeMemo = (tradeId: string, memo: string) => {
    setTradeRecords((prev: TradeRecord[]) => prev.map((t: TradeRecord) => t.id === tradeId ? { ...t, memo } : t));
  };

  const triggerPreMortem = (tradeId: string, preMortemId: string) => {
    setTradeRecords((prev: TradeRecord[]) => prev.map((t: TradeRecord) => {
      if (t.id !== tradeId) return t;
      const preMortems = (t.preMortems ?? []).map((pm: PreMortemItem) =>
        pm.id === preMortemId ? { ...pm, triggered: true, triggeredAt: new Date().toISOString() } : pm
      );
      return { ...t, preMortems };
    }));
  };

  const handleAddSector = (sector: string) => {
    if (!subscribedSectors.includes(sector)) { setSubscribedSectors([...subscribedSectors, sector]); toast.success(`${sector} 섹터가 구독되었습니다.`); }
  };

  const handleRemoveSector = (sector: string) => {
    setSubscribedSectors(subscribedSectors.filter((s: string) => s !== sector)); toast.success(`${sector} 섹터 구독이 해제되었습니다.`);
  };

  // Evolution weights auto-update
  useEffect(() => {
    const closed = tradeRecords.filter((t: TradeRecord) => t.status === 'CLOSED');
    if (closed.length >= 10) {
      const condPerf = computeConditionPerformance(closed);
      const weights: Record<number, number> = {};
      condPerf.forEach((c: { conditionId: number; totalTrades: number; evolutionWeight: number }) => {
        if (c.totalTrades >= 10 && c.evolutionWeight !== 1.0) weights[c.conditionId] = c.evolutionWeight;
      });
      if (Object.keys(weights).length > 0) saveEvolutionWeights(weights);
    }
  }, [tradeRecords]);

  return { toggleWatchlist, recordTrade, closeTrade, deleteTrade, updateTradeMemo, triggerPreMortem, handleAddSector, handleRemoveSector };
}
