/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { Toaster } from 'sonner';
import { AnimatePresence } from 'motion/react';
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
import { MarketRegimeBanner } from './components/MarketRegimeBanner';
import { MarketNeutralPanel } from './components/MarketNeutralPanel';
import { AppHeader } from './layout/AppHeader';
import { AppFooter } from './layout/AppFooter';
import { PageContainer } from './layout/PageContainer';

// ── Zustand Stores ─────────────────────────────────────────────────────────
import { useSettingsStore, useGlobalIntelStore, useAnalysisStore } from './stores';

// ── Domain Hooks ───────────────────────────────────────────────────────────
import { useMarketData } from './hooks/useMarketData';
import { useQuantRecommendations } from './hooks/useQuantRecommendations';
import { usePortfolioState } from './hooks/usePortfolioState';

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
  // ── Domain Hooks ──────────────────────────────────────────────────────────
  const { marketOverview, loadingMarket, handleFetchMarketOverview } = useMarketData();
  const {
    displayList, filteredRecommendations, allPatterns,
    averageHitRate, strongBuyHitRate,
  } = useQuantRecommendations();
  const { kisBalance, dartAlerts } = usePortfolioState();

  // ── Store Subscriptions ──────────────────────────────────────────────────
  const { selectedDetailStock, setSelectedDetailStock } = useAnalysisStore();
  const { view, theme, fontSize } = useSettingsStore();

  const bearRegimeResult = useGlobalIntelStore(s => s.bearRegimeResult);
  const vkospiTriggerResult = useGlobalIntelStore(s => s.vkospiTriggerResult);
  const inverseGate1Result = useGlobalIntelStore(s => s.inverseGate1Result);
  const marketNeutralResult = useGlobalIntelStore(s => s.marketNeutralResult);

  // ── Custom Hooks ────────────────────────────────────────────────────────
  const { handleSyncPrice, handleManualPriceUpdate, handleSyncAll } = useStockSync();
  const { addToBacktest, removeFromBacktest, updateWeight, reorderPortfolioItems, applyAIRecommendedWeights, savePortfolio, selectPortfolio, deletePortfolio, updatePortfolio, runBacktest, handleFileUpload } = usePortfolioOps();
  const { fetchStocks, handleMarketSearch, handleScreener, handleFetchNewsScores, loadingNews } = useStockSearch();
  const { toggleWatchlist, recordTrade, closeTrade, deleteTrade, updateTradeMemo, handleAddSector, handleRemoveSector } = useTradeOps();
  const { generatePDF, handleExportDeepAnalysisPDF, handleGenerateSummary, sendEmail, analysisReportRef } = useReportExport();
  const { copiedCode, handleCopy } = useCopiedCode();
  useDebugWatchers();
  useAllGlobalIntel();

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

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-theme-bg text-theme-text font-sans selection:bg-orange-500/30 selection:text-white antialiased overflow-x-hidden">
      <Toaster position="top-center" expand={false} richColors theme="dark" />

      <div className="max-w-screen-2xl mx-auto relative overflow-x-hidden">
        {/* ── Global Modals ── */}
        <MasterChecklistModal />
        <SettingsModal />
        <TradeRecordModal onRecordTrade={recordTrade} />

        {/* ── Header ── */}
        <AppHeader />

        {/* ── Gate -1 Market Regime Banner (아이디어 1, 4) ── */}
        <MarketRegimeBanner
          bearRegimeResult={bearRegimeResult}
          vkospiTriggerResult={vkospiTriggerResult}
          inverseGate1Result={inverseGate1Result}
        />

        {/* ── Market Neutral 모드 패널 (아이디어 9) ── */}
        <MarketNeutralPanel marketNeutralResult={marketNeutralResult} />

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
