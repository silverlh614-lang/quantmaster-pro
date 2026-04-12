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
import { StickyMiniHeader } from './components/StickyMiniHeader';
import { FloatingActionButton } from './components/FloatingActionButton';
import { SectorRotationPanel } from './components/SectorRotationPanel';
import { Sidebar } from './layout/Sidebar';
import { BottomNav } from './layout/BottomNav';
import { PageContainer } from './layout/PageContainer';
import { AppFooter } from './layout/AppFooter';

// -- Zustand Stores --
import { useSettingsStore, useGlobalIntelStore, useAnalysisStore } from './stores';

// -- Domain Hooks --
import { useMarketData } from './hooks/useMarketData';
import { useQuantRecommendations } from './hooks/useQuantRecommendations';
import { usePortfolioState } from './hooks/usePortfolioState';

// -- TanStack Query Hooks --
import { useAllGlobalIntel } from './hooks';
import { useStockSync } from './hooks/useStockSync';
import { usePortfolioOps } from './hooks/usePortfolioOps';
import { useStockSearch } from './hooks/useStockSearch';
import { useTradeOps } from './hooks/useTradeOps';
import { useReportExport } from './hooks/useReportExport';
import { useCopiedCode } from './hooks/useCopiedCode';
import { useDebugWatchers } from './hooks/useDebugWatchers';

export default function App() {
  // -- Domain Hooks --
  const { marketOverview, loadingMarket, handleFetchMarketOverview } = useMarketData();
  const {
    displayList, filteredRecommendations, allPatterns,
    averageHitRate, strongBuyHitRate,
  } = useQuantRecommendations();
  const { kisBalance, dartAlerts } = usePortfolioState();

  // -- Store Subscriptions --
  const { selectedDetailStock, setSelectedDetailStock } = useAnalysisStore();
  const { view, theme, fontSize } = useSettingsStore();

  const bearRegimeResult = useGlobalIntelStore(s => s.bearRegimeResult);
  const vkospiTriggerResult = useGlobalIntelStore(s => s.vkospiTriggerResult);
  const inverseGate1Result = useGlobalIntelStore(s => s.inverseGate1Result);
  const marketNeutralResult = useGlobalIntelStore(s => s.marketNeutralResult);

  // -- Custom Hooks --
  const { handleSyncPrice, handleManualPriceUpdate, handleSyncAll } = useStockSync();
  const { addToBacktest, removeFromBacktest, updateWeight, reorderPortfolioItems, applyAIRecommendedWeights, savePortfolio, selectPortfolio, deletePortfolio, updatePortfolio, runBacktest, handleFileUpload } = usePortfolioOps();
  const { fetchStocks, handleMarketSearch, handleScreener, handleFetchNewsScores, loadingNews } = useStockSearch();
  const { toggleWatchlist, recordTrade, closeTrade, deleteTrade, updateTradeMemo, triggerPreMortem, handleAddSector, handleRemoveSector } = useTradeOps();
  const { generatePDF, handleExportDeepAnalysisPDF, handleGenerateSummary, sendEmail, analysisReportRef } = useReportExport();
  const { copiedCode, handleCopy } = useCopiedCode();
  useDebugWatchers();
  useAllGlobalIntel();

  // -- Tab Title --
  useEffect(() => {
    const viewLabels: Record<string, string> = {
      DISCOVER: '탐색', WATCHLIST: '관심 목록', SCREENER: '스크리너',
      SUBSCRIPTION: '섹터 구독', BACKTEST: '백테스트', MARKET: '시장 대시보드',
      WALK_FORWARD: '워크포워드', MANUAL_INPUT: '수동 퀀트', TRADE_JOURNAL: '매매일지',
    };
    document.title = `${viewLabels[view] ?? view} \u00B7 QuantMaster Pro`;
  }, [view]);

  // -- Theme Application --
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

  // =========================================================================
  // RENDER — Sidebar + Main Content Layout
  // =========================================================================
  return (
    <div className="min-h-screen bg-theme-bg text-theme-text font-sans selection:bg-blue-500/30 selection:text-white antialiased overflow-x-hidden bg-gradient-mesh bg-dot-grid">
      <Toaster position="top-center" expand={false} richColors theme="dark" />

      {/* Global Modals */}
      <MasterChecklistModal />
      <SettingsModal />
      <TradeRecordModal onRecordTrade={recordTrade} />

      {/* Stock Detail Slide-in Panel (Idea 7) */}
      <StockDetailModal
        stock={selectedDetailStock}
        onClose={() => setSelectedDetailStock(null)}
      />

      {/* ===== Desktop Sidebar (Idea 1) ===== */}
      <Sidebar />

      {/* ===== Mobile Bottom Nav (Idea 1) ===== */}
      <BottomNav />

      {/* ===== Main Content Area ===== */}
      <div className="app-main">
        {/* Sticky Mini Header (Idea 8) */}
        <StickyMiniHeader />

        {/* Market Regime Banner — Compact (Idea 5) */}
        <MarketRegimeBanner
          bearRegimeResult={bearRegimeResult}
          vkospiTriggerResult={vkospiTriggerResult}
          inverseGate1Result={inverseGate1Result}
        />

        {/* Market Neutral Panel */}
        <MarketNeutralPanel marketNeutralResult={marketNeutralResult} />

        {/* Market Ticker */}
        <MarketTicker
          data={marketOverview}
          loading={loadingMarket}
          onRefresh={() => handleFetchMarketOverview(true)}
        />

        {/* Main Content + Sector Panel (Desktop) */}
        <div className="flex">
          {/* Page Content */}
          <div className="flex-1 min-w-0">
            <PageContainer size="full" className="no-print">
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
                    onTriggerPreMortem={triggerPreMortem}
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

              {/* Footer */}
              <AppFooter />
            </PageContainer>
          </div>

          {/* Sector Rotation Side Panel — Desktop only (Idea 4) */}
          {(view === 'DISCOVER' || view === 'WATCHLIST') && (
            <div className="hidden xl:block w-[260px] shrink-0 p-4 pt-6 sticky top-0 h-screen overflow-y-auto no-scrollbar">
              <SectorRotationPanel />
            </div>
          )}
        </div>
      </div>

      {/* Floating Action Button — Mobile only (Idea 9) */}
      <FloatingActionButton
        onRefresh={fetchStocks}
        onSearch={() => {
          const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="검색"]');
          searchInput?.focus();
        }}
        onExportPDF={() => generatePDF()}
        isRefreshing={loadingNews}
      />
    </div>
  );
}
