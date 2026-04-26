// @responsibility useStockSync React hook
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { syncStockPrice, fetchCurrentPrice } from '../services/stockService';
import { applyTradingFieldFallbacks } from '../services/stock/enrichment';
import { useRecommendationStore, useMarketStore, useAnalysisStore, useSettingsStore, useTradeStore } from '../stores';
import { isMarketOpen } from '../utils/marketTime';
import type { StockRecommendation } from '../services/stockService';
import type { TradeRecord } from '../types/quant';

/**
 * ADR-0009 §3: 장중 5분, 장외 15분 폴링.
 * Yahoo 프록시·KIS 호출 부하를 장 마감 후 1/3 로 축소한다.
 */
function getCycleMs(): number {
  return isMarketOpen() ? 5 * 60 * 1000 : 15 * 60 * 1000;
}

export function useStockSync() {
  const {
    recommendations, setRecommendations,
    watchlist, setWatchlist,
  } = useRecommendationStore();
  const {
    syncStatus, setSyncStatus,
    syncingStock, setSyncingStock,
    nextSyncCountdown, setNextSyncCountdown,
  } = useMarketStore();
  const { setDeepAnalysisStock } = useAnalysisStore();
  const { view, autoSyncEnabled, setAutoSyncEnabled } = useSettingsStore();
  const { setTradeRecords } = useTradeStore();

  const watchlistRef = useRef(watchlist);
  const autoSyncEnabledRef = useRef(autoSyncEnabled);
  const syncingStockRef = useRef<string | null>(null);

  useEffect(() => { watchlistRef.current = watchlist; }, [watchlist]);
  useEffect(() => { autoSyncEnabledRef.current = autoSyncEnabled; }, [autoSyncEnabled]);

  const handleSyncPrice = async (stock: StockRecommendation): Promise<StockRecommendation | null> => {
    if (syncingStockRef.current) return null;
    syncingStockRef.current = stock.code;
    setSyncingStock(stock.code);
    try {
      toast.info(`${stock.name}의 실시간 가격, 뉴스 및 전략을 동기화 중입니다...`, { description: "최신 시장 데이터를 반영하여 목표가와 손절가를 재산출합니다.", duration: 3000 });
      const updatedStock = await syncStockPrice(stock);
      toast.success(`${stock.name} 동기화 완료`, { description: "최신 가격과 뉴스, 기술적 분석이 업데이트되었습니다.", duration: 2000 });
      setRecommendations((prev: StockRecommendation[]) => (prev || []).map(s => s.code === stock.code ? updatedStock : s));
      setWatchlist((prev: StockRecommendation[]) => (prev || []).map(s => s.code === stock.code ? updatedStock : s));
      setDeepAnalysisStock((prev: StockRecommendation | null) => prev?.code === stock.code ? updatedStock : prev);
      return updatedStock;
    } catch (err: any) {
      console.error('Sync failed:', err);
      if (!autoSyncEnabledRef.current) {
        toast.error(`${stock.name} 동기화 실패`, { description: err.message || '알 수 없는 오류가 발생했습니다.' });
      }
      return null;
    } finally {
      syncingStockRef.current = null;
      setSyncingStock(null);
    }
  };

  const handleManualPriceUpdate = (stock: StockRecommendation, newPrice: number) => {
    if (isNaN(newPrice) || newPrice <= 0) { toast.error("유효한 가격을 입력해주세요."); return; }
    // 새 현재가 기준으로 entryPrice/targetPrice/stopLoss 가 0 인 경우 퍼센트 기반 폴백 재계산.
    const fallback = applyTradingFieldFallbacks(
      { targetPrice: stock.targetPrice, targetPrice2: stock.targetPrice2,
        entryPrice: stock.entryPrice, stopLoss: stock.stopLoss },
      newPrice,
    );
    const updatedStock = {
      ...stock,
      currentPrice: newPrice,
      targetPrice:  fallback.targetPrice  ?? stock.targetPrice,
      targetPrice2: fallback.targetPrice2 ?? stock.targetPrice2,
      entryPrice:   fallback.entryPrice   ?? stock.entryPrice,
      stopLoss:     fallback.stopLoss     ?? stock.stopLoss,
      priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} (수동)`,
    };
    setRecommendations((prev: StockRecommendation[]) => (prev || []).map(s => s.code === stock.code ? updatedStock : s));
    setWatchlist((prev: StockRecommendation[]) => (prev || []).map(s => s.code === stock.code ? updatedStock : s));
    setDeepAnalysisStock((prev: StockRecommendation | null) => prev?.code === stock.code ? updatedStock : prev);
    toast.success(`${stock.name} 가격이 수동 업데이트되었습니다.`, { description: `새 가격: ₩${newPrice?.toLocaleString() || '0'}` });
  };

  const handleSyncAll = async () => {
    if (syncStatus.isSyncing) return;
    const stocksToSync = view === 'WATCHLIST' ? watchlist : recommendations;
    if (stocksToSync.length === 0) { toast.info("동기화할 종목이 없습니다."); return; }
    setSyncStatus({ isSyncing: true, total: stocksToSync.length, progress: 0 });
    toast.info(`${stocksToSync.length}개 종목의 실시간 데이터 동기화를 시작합니다.`);
    for (let i = 0; i < stocksToSync.length; i++) {
      const stock = stocksToSync[i];
      setSyncStatus({ currentStock: stock.name, progress: i + 1 });
      try { await handleSyncPrice(stock); await new Promise(resolve => setTimeout(resolve, 3000)); }
      catch (err) { console.error(`Sync failed for ${stock.name}:`, err); }
    }
    setSyncStatus({ isSyncing: false, currentStock: null, lastSyncTime: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) });
    toast.success("모든 종목의 동기화가 완료되었습니다.");
  };

  // Auto-sync cycle
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let countdownInterval: ReturnType<typeof setInterval>;
    const checkPriceAlerts = (stocks: StockRecommendation[]) => {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      stocks.forEach(stock => {
        if (stock.currentPrice <= stock.stopLoss) new Notification(`⚠️ 손절 알림: ${stock.name}`, { body: `현재가 ${stock.currentPrice.toLocaleString()}원이 손절가 ${stock.stopLoss.toLocaleString()}원에 도달했습니다.` });
        if (stock.currentPrice >= stock.targetPrice) new Notification(`🎯 목표 달성: ${stock.name}`, { body: `1차 목표가 ${stock.targetPrice.toLocaleString()}원 도달! 절반 익절을 고려하십시오.` });
      });
    };
    const runSyncCycle = async () => {
      if (!autoSyncEnabledRef.current || syncStatus.isSyncing) { timeoutId = setTimeout(runSyncCycle, 10000); return; }
      const currentWatchlist = [...watchlistRef.current];
      if (currentWatchlist.length === 0) { setNextSyncCountdown(60); timeoutId = setTimeout(runSyncCycle, 60000); return; }
      setSyncStatus({ isSyncing: true, total: currentWatchlist.length, progress: 0 });
      for (let i = 0; i < currentWatchlist.length; i++) {
        if (!autoSyncEnabledRef.current) break;
        const stock = currentWatchlist[i];
        setSyncStatus({ currentStock: stock.name, progress: i + 1 });
        try { const u = await handleSyncPrice(stock); if (u) checkPriceAlerts([u]); await new Promise(resolve => setTimeout(resolve, 5000)); }
        catch (err) { console.error(`Auto-sync failed for ${stock.name}:`, err); }
      }
      setTradeRecords((prev: TradeRecord[]) => prev.map((t: TradeRecord) => {
        if (t.status !== 'OPEN') return t;
        const synced = watchlistRef.current.find((s: StockRecommendation) => s.code === t.stockCode);
        const newPrice = synced?.currentPrice ?? t.currentPrice;
        if (!newPrice || newPrice === t.currentPrice) return t;
        return { ...t, currentPrice: newPrice, unrealizedPct: parseFloat(((newPrice - t.buyPrice) / t.buyPrice * 100).toFixed(2)), lastSyncAt: new Date().toISOString() };
      }));
      setSyncStatus({ isSyncing: false, currentStock: null, lastSyncTime: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) });
      const cycleMs = getCycleMs();
      setNextSyncCountdown(Math.floor(cycleMs / 1000));
      timeoutId = setTimeout(runSyncCycle, cycleMs);
    };
    if (autoSyncEnabled) {
      setNextSyncCountdown(60);
      countdownInterval = setInterval(() => { setNextSyncCountdown(Math.max(0, useMarketStore.getState().nextSyncCountdown - 1)); }, 1000);
      timeoutId = setTimeout(runSyncCycle, 1000);
    }
    return () => { clearTimeout(timeoutId); clearInterval(countdownInterval); };
  }, [autoSyncEnabled]);

  // Real-time price sync
  useEffect(() => {
    if (recommendations.length === 0) return;
    const syncPrices = async () => {
      const updatedRecommendations = await Promise.all(
        recommendations.map(async (stock) => {
          try { const currentPrice = await fetchCurrentPrice(stock.code); if (currentPrice && currentPrice !== stock.currentPrice) return { ...stock, currentPrice, priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (Auto)` }; } catch (e) { console.error(`Failed to sync price for ${stock.code}`, e); }
          return stock;
        })
      );
      const hasChanges = updatedRecommendations.some((s, i) => s.currentPrice !== recommendations[i].currentPrice);
      if (hasChanges) setRecommendations(updatedRecommendations);
    };
    syncPrices();
    // ADR-0009 §3: 장중 5분 / 장외 15분
    const interval = setInterval(syncPrices, getCycleMs());
    return () => clearInterval(interval);
  }, [recommendations.length]);

  // Expose syncBySelector to window
  useEffect(() => {
    (window as any).syncStocksBySelector = async (selector: string) => {
      const elements = document.querySelectorAll(selector);
      const codes = Array.from(elements).map(el => el.getAttribute('data-stock-code')).filter(Boolean) as string[];
      if (codes.length === 0) { toast.warning("선택된 종목이 없습니다."); return; }
      toast.info(`${codes.length}개 종목 동기화 시작...`);
      for (const code of codes) {
        const stock = (recommendations || []).find(r => r.code === code) || (watchlist || []).find(w => w.code === code);
        if (stock) { await handleSyncPrice(stock); await new Promise(resolve => setTimeout(resolve, 3000)); }
      }
    };
  }, [recommendations, watchlist]);

  return { handleSyncPrice, handleManualPriceUpdate, handleSyncAll };
}
