/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { Toaster } from 'sonner';
import { AnimatePresence, motion } from 'motion/react';
import { MarketPage } from './pages/MarketPage';
import { ManualInputPage } from './pages/ManualInputPage';
import { AutoTradePage } from './pages/AutoTradePage';
import { TradeJournalPage } from './pages/TradeJournalPage';
import { ScreenerPage } from './pages/ScreenerPage';
import { SubscriptionPage } from './pages/SubscriptionPage';
import { BacktestPage } from './pages/BacktestPage';
import { DiscoverWatchlistPage } from './pages/DiscoverWatchlistPage';
import { WalkForwardView } from './components/common/WalkForwardView';
import { StockDetailModal } from './components/analysis/StockDetailModal';
import { SettingsModal } from './components/common/SettingsModal';
import { MasterChecklistModal } from './components/common/MasterChecklistModal';
import { TradeRecordModal } from './components/trading/TradeRecordModal';
import { MarketTicker } from './components/market/MarketTicker';
import { MarketRegimeBanner } from './components/market/MarketRegimeBanner';
import { MarketNeutralPanel } from './components/market/MarketNeutralPanel';
import { StickyMiniHeader } from './components/common/StickyMiniHeader';
import { FloatingActionButton } from './components/common/FloatingActionButton';
import { SectorRotationPanel } from './components/sector/SectorRotationPanel';
import { Sidebar } from './layout/Sidebar';
import { BottomNav } from './layout/BottomNav';
import { PageContainer } from './layout/PageContainer';
import { AppFooter } from './layout/AppFooter';

// -- Zustand Stores --
import { useSettingsStore, useGlobalIntelStore, useAnalysisStore } from './stores';

// -- Centralized Config --
import { buildPageTitle, THEME_BODY_CLASSES, PAGE_TRANSITION, SECTOR_PANEL_VIEWS } from './config';

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
    document.title = buildPageTitle(view);
  }, [view]);

  // -- Theme Application --
  useEffect(() => {
    const body = document.body;
    body.classList.remove(...THEME_BODY_CLASSES.map(c => c));
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
                <motion.div
                  key={view}
                  initial={PAGE_TRANSITION.initial}
                  animate={PAGE_TRANSITION.animate}
                  exit={PAGE_TRANSITION.exit}
                  transition={PAGE_TRANSITION.transition}
                >
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
                </motion.div>
              </AnimatePresence>

              {/* Footer */}
              <AppFooter />
            </PageContainer>
          </div>

          {/* Sector Rotation Side Panel — Desktop only (Idea 4) */}
          {(SECTOR_PANEL_VIEWS as readonly string[]).includes(view) && (
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
