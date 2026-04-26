/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MarketPage } from './MarketPage';
import { ManualInputPage } from './ManualInputPage';
import { AutoTradePage } from './AutoTradePage';
import { TradeJournalPage } from './TradeJournalPage';
import { ScreenerPage } from './ScreenerPage';
import { SubscriptionPage } from './SubscriptionPage';
import { BacktestPage } from './BacktestPage';
import { DiscoverWatchlistPage } from './DiscoverWatchlistPage';
import { PortfolioExtractPage } from './PortfolioExtractPage';
import { RecommendationHistoryPage } from './RecommendationHistoryPage';
import { MacroIntelligencePage } from './MacroIntelligencePage';
import { WalkForwardView } from '../components/common/WalkForwardView';
import { SectionErrorBoundary } from '../components/common/SectionErrorBoundary';
import { FloatingActionButton } from '../components/common/FloatingActionButton';
import { useSettingsStore } from '../stores';
import { PAGE_TRANSITION } from '../config';
import { useQuantRecommendations } from '../hooks/useQuantRecommendations';
import { usePortfolioState } from '../hooks/usePortfolioState';
import { useStockSync } from '../hooks/useStockSync';
import { usePortfolioOps } from '../hooks/usePortfolioOps';
import { useStockSearch } from '../hooks/useStockSearch';
import { useTradeOps } from '../hooks/useTradeOps';
import { useReportExport } from '../hooks/useReportExport';
import { useCopiedCode } from '../hooks/useCopiedCode';
import { useFloatingActions } from '../hooks/useFloatingActions';

interface PageRouterProps {
  onFetchMarketOverview: (force?: boolean) => Promise<void>;
}

/**
 * Renders the current view with page-level transition animation and owns
 * every page-action hook (each must live in a single place to preserve state
 * and effect wiring). The floating action button is rendered here so it can
 * share the same `useStockSearch` / `useReportExport` instances.
 */
export function PageRouter({ onFetchMarketOverview }: PageRouterProps) {
  const { view } = useSettingsStore();

  const {
    displayList, filteredRecommendations, allPatterns,
    averageHitRate, strongBuyHitRate,
  } = useQuantRecommendations();
  const { kisBalance, dartAlerts } = usePortfolioState();

  const { handleSyncPrice, handleManualPriceUpdate, handleSyncAll } = useStockSync();
  const {
    addToBacktest, removeFromBacktest, updateWeight, reorderPortfolioItems,
    applyAIRecommendedWeights, savePortfolio, selectPortfolio, deletePortfolio,
    updatePortfolio, runBacktest, handleFileUpload,
  } = usePortfolioOps();
  const {
    fetchStocks, handleMarketSearch, handleScreener, handleFetchNewsScores, loadingNews,
  } = useStockSearch();
  const {
    toggleWatchlist, recordTrade, closeTrade, deleteTrade, updateTradeMemo,
    triggerPreMortem, handleAddSector, handleRemoveSector,
  } = useTradeOps();
  const {
    generatePDF, handleExportDeepAnalysisPDF, sendEmail, analysisReportRef,
  } = useReportExport();
  const { copiedCode, handleCopy } = useCopiedCode();

  const floatingActions = useFloatingActions({ fetchStocks, generatePDF, loadingNews });

  return (
    <>
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={PAGE_TRANSITION.initial}
          animate={PAGE_TRANSITION.animate}
          exit={PAGE_TRANSITION.exit}
          transition={PAGE_TRANSITION.transition}
        >
          <SectionErrorBoundary sectionName={view}>
            {view === 'MARKET' ? (
              <MarketPage onFetchMarketOverview={onFetchMarketOverview} />
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
            ) : view === 'PORTFOLIO_EXTRACT' ? (
              <PortfolioExtractPage />
            ) : view === 'RECOMMENDATION_HISTORY' ? (
              <RecommendationHistoryPage />
            ) : view === 'MACRO_INTEL' ? (
              <MacroIntelligencePage />
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
                onGeneratePDF={generatePDF}
                onExportDeepAnalysisPDF={handleExportDeepAnalysisPDF}
                onSendEmail={sendEmail}
                onRecordTrade={recordTrade}
              />
            )}
          </SectionErrorBoundary>
        </motion.div>
      </AnimatePresence>

      <FloatingActionButton {...floatingActions} />
    </>
  );
}
