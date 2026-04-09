/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { toast, Toaster } from 'sonner';
import { AnimatePresence } from 'motion/react';
import {
  getMarketOverview,
  syncMarketOverviewIndices,
  fetchCurrentPrice,
  StockRecommendation,
  MarketOverview,
} from './services/stockService';
import { MarketPage } from './pages/MarketPage';
import { ManualInputPage } from './pages/ManualInputPage';
import { AutoTradePage } from './pages/AutoTradePage';
import { TradeJournalPage } from './pages/TradeJournalPage';
import { ScreenerPage } from './pages/ScreenerPage';
import { SubscriptionPage } from './pages/SubscriptionPage';
import { BacktestPage } from './pages/BacktestPage';
import { DiscoverWatchlistPage } from './pages/DiscoverWatchlistPage';
import { WalkForwardView } from './components/WalkForwardView';
import { StockDetailModal } from './components/StockDetailModal';
import { SettingsModal } from './components/SettingsModal';
import { MasterChecklistModal } from './components/MasterChecklistModal';
import { TradeRecordModal } from './components/TradeRecordModal';
import { MarketTicker } from './components/MarketTicker';
import { resolveShadowTrade } from './services/autoTrading';
import { cn } from './ui/cn';
import { AppHeader } from './layout/AppHeader';
import { AppFooter } from './layout/AppFooter';
import { PageContainer } from './layout/PageContainer';
import type { TradeRecord } from './types/quant';

// ── Zustand Stores ─────────────────────────────────────────────────────────
import { useSettingsStore, useGlobalIntelStore, useRecommendationStore, useMarketStore, useTradeStore, useAnalysisStore, usePortfolioStore } from './stores';
import { useShadowTradeStore } from './stores/useShadowTradeStore';

// ── TanStack Query Hooks ───────────────────────────────────────────────────
import { useAllGlobalIntel } from './hooks';
import { useStockSync } from './hooks/useStockSync';
import { usePortfolioOps } from './hooks/usePortfolioOps';
import { useStockSearch } from './hooks/useStockSearch';
import { useTradeOps } from './hooks/useTradeOps';
import { useReportExport } from './hooks/useReportExport';
import { useCopiedCode } from './hooks/useCopiedCode';
import { useDebugWatchers } from './hooks/useDebugWatchers';

export default function App() {
  // ── Zustand Store Subscriptions ──────────────────────────────────────────
  const {
    recommendations,
    watchlist,
    searchResults,
    filters,
    selectedType,
    selectedPattern,
    selectedSentiment,
    selectedChecklist,
    searchQuery, setSearchQuery,
    minPrice,
    maxPrice,
    sortBy,
    recommendationHistory,
    loading,
    lastUpdated,
  } = useRecommendationStore();

  const { tradeRecords } = useTradeStore();
  const { selectedDetailStock, setSelectedDetailStock } = useAnalysisStore();

  const {
    marketOverview, setMarketOverview,
    loadingMarket, setLoadingMarket,
    syncStatus,
  } = useMarketStore();

  const {
    view,
    theme,
    fontSize,
  } = useSettingsStore();

  const { addShadowTrade, updateShadowTrade, shadowTrades } = useShadowTradeStore();

  // ── Custom Hooks ────────────────────────────────────────────────────────
  const { handleSyncPrice, handleManualPriceUpdate, handleSyncAll } = useStockSync();
  const { addToBacktest, removeFromBacktest, updateWeight, reorderPortfolioItems, applyAIRecommendedWeights, savePortfolio, selectPortfolio, deletePortfolio, updatePortfolio, runBacktest, handleFileUpload } = usePortfolioOps();
  const { fetchStocks, handleMarketSearch, handleScreener, handleFetchNewsScores, loadingNews } = useStockSearch();
  const { toggleWatchlist, recordTrade, closeTrade, deleteTrade, updateTradeMemo, handleAddSector, handleRemoveSector } = useTradeOps();
  const { generatePDF, handleExportDeepAnalysisPDF, handleGenerateSummary, sendEmail, analysisReportRef } = useReportExport();
  const { copiedCode, handleCopy } = useCopiedCode();
  useDebugWatchers();
  useAllGlobalIntel();

  // ── KIS Balance ─────────────────────────────────────────────────────────
  const [kisBalance, setKisBalance] = useState<number>(100_000_000);
  useEffect(() => {
    fetch('/api/kis/balance')
      .then(res => res.json())
      .then(data => {
        const cash = Number(data.output2?.[0]?.dnca_tot_amt ?? data.output?.dnca_tot_amt ?? 0);
        if (cash > 0) setKisBalance(cash);
      })
      .catch((err) => console.error('[ERROR] KIS 잔고 조회 실패:', err));
  }, []);

  // ── DART Alerts ─────────────────────────────────────────────────────────
  const [dartAlerts, setDartAlerts] = useState<{ corp_name: string; stock_code: string; report_nm: string; rcept_dt: string; sentiment: string }[]>([]);
  useEffect(() => {
    const fetchDart = () => {
      fetch('/api/auto-trade/dart-alerts').then(r => r.json()).then(setDartAlerts).catch((err) => console.error('[ERROR] DART 알림 조회 실패:', err));
    };
    fetchDart();
    const interval = setInterval(fetchDart, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Computed Values ─────────────────────────────────────────────────────
  const averageHitRate = useMemo(() => {
    if (recommendationHistory.length === 0) return 0;
    return Math.round(recommendationHistory.reduce((acc, curr) => acc + curr.hitRate, 0) / recommendationHistory.length);
  }, [recommendationHistory]);

  const strongBuyHitRate = useMemo(() => {
    if (recommendationHistory.length === 0) return 68;
    const itemsWithStrongBuy = (recommendationHistory || []).filter(item => item.strongBuyHitRate !== undefined);
    if (itemsWithStrongBuy.length === 0) return 68;
    return Math.max(0, Math.round((itemsWithStrongBuy.reduce((acc, curr) => acc + (curr.strongBuyHitRate || 0), 0) / itemsWithStrongBuy.length) * 0.95));
  }, [recommendationHistory]);

  // ── Tab Title ───────────────────────────────────────────────────────────
  useEffect(() => {
    const viewLabels: Record<string, string> = {
      DISCOVER: '탐색', WATCHLIST: '관심 목록', SCREENER: '스크리너',
      SUBSCRIPTION: '섹터 구독', BACKTEST: '백테스트', MARKET: '시장 대시보드',
      WALK_FORWARD: '워크포워드', MANUAL_INPUT: '수동 퀀트', TRADE_JOURNAL: '매매일지',
    };
    document.title = `${viewLabels[view] ?? view} · QuantMaster Pro`;
  }, [view]);

  // ── Theme Application ───────────────────────────────────────────────────
  useEffect(() => {
    const body = document.body;
    body.classList.remove('theme-light', 'theme-dark', 'theme-high-contrast');
    if (theme !== 'dark') body.classList.add(`theme-${theme}`);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${(fontSize / 16) * 100}%`;
  }, [fontSize]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, []);

  // ── Watchlist Sync ──────────────────────────────────────────────────────
  const prevWatchlistCodesRef = useRef<string[]>([]);
  useEffect(() => {
    const currentCodes = (watchlist || []).map(s => s.code);
    const prevCodes = prevWatchlistCodesRef.current;
    prevWatchlistCodesRef.current = currentCodes;

    const added = (watchlist || []).filter(s => !prevCodes.includes(s.code));
    for (const stock of added) {
      fetch('/api/auto-trade/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: stock.code, name: stock.name,
          entryPrice: stock.entryPrice ?? stock.currentPrice ?? 0,
          stopLoss: stock.stopLoss ?? 0, targetPrice: stock.targetPrice ?? 0,
        }),
      }).catch((err) => console.error('[ERROR] 워치리스트 동기화 실패:', err));
    }

    const removed = prevCodes.filter(code => !currentCodes.includes(code));
    for (const code of removed) {
      fetch(`/api/auto-trade/watchlist/${code}`, { method: 'DELETE' }).catch((err) => console.error('[ERROR] 워치리스트 삭제 실패:', err));
    }
  }, [watchlist]);

  // ── Shadow Trade Resolution ─────────────────────────────────────────────
  useEffect(() => {
    const activeTrades = shadowTrades.filter(t => t.status === 'PENDING' || t.status === 'ACTIVE');
    if (activeTrades.length === 0) return;

    const resolveTrades = async () => {
      for (const trade of activeTrades) {
        try {
          const price = await fetchCurrentPrice(trade.stockCode);
          if (!price) continue;
          const updates = resolveShadowTrade(trade, price);
          if (updates && Object.keys(updates).length > 0) updateShadowTrade(trade.id, updates);
        } catch (e) {
          console.error(`[Shadow] ${trade.stockCode} resolve 실패:`, e);
        }
      }
    };

    resolveTrades();
    const interval = setInterval(resolveTrades, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [shadowTrades.filter(t => t.status === 'PENDING' || t.status === 'ACTIVE').length]);

  // ── Initial Market Sync ─────────────────────────────────────────────────
  useEffect(() => {
    const initialSync = async () => {
      const stored = localStorage.getItem('k-stock-market-overview');
      if (stored) {
        try {
          const overview = JSON.parse(stored) as MarketOverview;
          const updated = await syncMarketOverviewIndices(overview);
          setMarketOverview(updated);
        } catch (e) {
          console.error('Failed to parse stored market overview', e);
        }
      }
    };
    initialSync();
  }, []);

  const handleFetchMarketOverview = async (force = false) => {
    if (loadingMarket) return;

    if (!force && marketOverview) {
      const last = new Date(marketOverview.lastUpdated).getTime();
      const diff = (Date.now() - last) / (1000 * 60);
      if (diff < 5) return;
      if (diff < 30) {
        setLoadingMarket(true);
        try {
          const updated = await syncMarketOverviewIndices(marketOverview);
          setMarketOverview(updated);
          return;
        } catch (e) {
          console.error('Failed to sync indices, falling back to full fetch', e);
        } finally {
          setLoadingMarket(false);
        }
      }
    }

    setLoadingMarket(true);
    try {
      const data = await getMarketOverview();
      if (data) setMarketOverview(data);
    } catch (err: any) {
      console.error('Failed to fetch market overview:', err);
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || '';
      const status = errObj?.status || err?.status;
      const code = errObj?.code || err?.code;
      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');
      if (isRateLimit) toast.error('시장 개요 로드 실패: API 할당량 초과');
    } finally {
      setLoadingMarket(false);
    }
  };

  useEffect(() => {
    if (!marketOverview) return;
  }, [view]);

  // ── Filtered & Sorted Display List ──────────────────────────────────────
  const searchResultCodes = new Set((searchResults || []).map(s => s.code));

  const filteredRecommendations = [...(recommendations || []), ...(searchResults || [])].filter(stock => {
    const typeMatch = selectedType === 'ALL' || stock.type === selectedType;
    const patternMatch = selectedPattern === 'ALL' || (stock.patterns || []).includes(selectedPattern);
    const sentimentMatch = selectedSentiment === 'ALL' ||
      (selectedSentiment === 'RISK_ON' && (stock.marketSentiment?.iri ?? 0) < 2.0) ||
      (selectedSentiment === 'RISK_OFF' && (stock.marketSentiment?.iri ?? 0) >= 2.0);
    const checklistMatch = selectedChecklist.length === 0 ||
      selectedChecklist.every(item => stock.checklist?.[item as keyof typeof stock.checklist]);
    const minP = minPrice === '' ? 0 : parseInt(minPrice);
    const maxP = maxPrice === '' ? Infinity : parseInt(maxPrice);
    const priceMatch = (stock.currentPrice ?? 0) >= minP && (stock.currentPrice ?? 0) <= maxP;
    const searchMatch = searchResultCodes.has(stock.code) || searchQuery === '' ||
      (stock.name?.toLowerCase().includes(searchQuery?.toLowerCase() || '') ?? false) ||
      (stock.code?.includes(searchQuery || '') ?? false);
    return typeMatch && patternMatch && sentimentMatch && checklistMatch && searchMatch && priceMatch;
  });

  const allPatterns = Array.from(new Set((recommendations || []).flatMap(r => r.patterns || [])));

  const displayList = (() => {
    let list: StockRecommendation[] = [];
    if (view === 'DISCOVER') {
      list = filteredRecommendations;
    } else if (view === 'WATCHLIST') {
      list = (watchlist || []).filter(stock =>
        (stock.name?.toLowerCase().includes(searchQuery?.toLowerCase() || '') ?? false) ||
        (stock.code?.includes(searchQuery || '') ?? false)
      );
    } else {
      return [];
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'NAME') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'CODE') return (a.code || '').localeCompare(b.code || '');
      if (sortBy === 'PERFORMANCE') {
        const getPerf = (s: StockRecommendation) => {
          if (s.currentPrice > 0 && s.entryPrice && s.entryPrice > 0) return (s.currentPrice / s.entryPrice) - 1;
          if (s.peakPrice > 0) return (s.currentPrice / s.peakPrice) - 1;
          return -Infinity;
        };
        return getPerf(b) - getPerf(a);
      }
      return 0;
    });
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-theme-bg text-theme-text font-sans selection:bg-orange-500/30 selection:text-white antialiased">
      <Toaster position="top-center" expand={false} richColors theme="dark" />

      <div className="max-w-screen-2xl mx-auto relative">
        {/* ── Global Modals ── */}
        <MasterChecklistModal />
        <SettingsModal />
        <TradeRecordModal onRecordTrade={recordTrade} />

        {/* ── Header ── */}
        <AppHeader />

        {/* ── Market Ticker ── */}
        <MarketTicker
          data={marketOverview}
          loading={loadingMarket}
          onRefresh={() => handleFetchMarketOverview(true)}
        />

        {/* ── Main Content ── */}
        <PageContainer size="lg" className="no-print">
          <AnimatePresence mode="wait">
            {view === 'MARKET' ? (
              <MarketPage onFetchMarketOverview={handleFetchMarketOverview} />
            ) : view === 'MANUAL_INPUT' ? (
              <ManualInputPage />
            ) : view === 'AUTO_TRADE' ? (
              <AutoTradePage />
            ) : view === 'TRADE_JOURNAL' ? (
              <TradeJournalPage
                onCloseTrade={closeTrade}
                onDeleteTrade={deleteTrade}
                onUpdateMemo={updateTradeMemo}
              />
            ) : view === 'SCREENER' ? (
              <ScreenerPage onScreen={handleScreener} />
            ) : view === 'SUBSCRIPTION' ? (
              <SubscriptionPage
                onAddSector={handleAddSector}
                onRemoveSector={handleRemoveSector}
              />
            ) : view === 'BACKTEST' ? (
              <BacktestPage
                onRunBacktest={runBacktest}
                onFileUpload={handleFileUpload}
                onRemoveFromBacktest={removeFromBacktest}
                onUpdateWeight={updateWeight}
                onReorderPortfolioItems={reorderPortfolioItems}
                onApplyAIRecommendedWeights={applyAIRecommendedWeights}
                onSelectPortfolio={selectPortfolio}
                onSavePortfolio={savePortfolio}
                onDeletePortfolio={deletePortfolio}
                onUpdatePortfolio={updatePortfolio}
                onCopy={handleCopy}
                copiedCode={copiedCode}
              />
            ) : view === 'WALK_FORWARD' ? (
              <WalkForwardView />
            ) : (
              <DiscoverWatchlistPage
                displayList={displayList}
                filteredRecommendations={filteredRecommendations}
                allPatterns={allPatterns}
                averageHitRate={averageHitRate}
                strongBuyHitRate={strongBuyHitRate}
                loadingNews={loadingNews}
                dartAlerts={dartAlerts}
                kisBalance={kisBalance}
                analysisReportRef={analysisReportRef}
                onFetchStocks={fetchStocks}
                onSyncAll={handleSyncAll}
                onSyncPrice={handleSyncPrice}
                onManualPriceUpdate={handleManualPriceUpdate}
                onToggleWatchlist={toggleWatchlist}
                onAddToBacktest={addToBacktest}
                onMarketSearch={handleMarketSearch}
                onFetchNewsScores={handleFetchNewsScores}
                onGenerateSummary={handleGenerateSummary}
                onGeneratePDF={generatePDF}
                onExportDeepAnalysisPDF={handleExportDeepAnalysisPDF}
                onSendEmail={sendEmail}
                onRecordTrade={recordTrade}
              />
            )}
          </AnimatePresence>

          {/* ── Footer ── */}
          <AppFooter />
        </PageContainer>

        {/* ── Stock Detail Modal (global) ── */}
        <StockDetailModal
          stock={selectedDetailStock}
          onClose={() => setSelectedDetailStock(null)}
        />
      </div>
    </div>
  );
}
