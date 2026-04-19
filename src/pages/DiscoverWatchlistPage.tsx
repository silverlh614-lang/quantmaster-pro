import React from 'react';
import {
  RefreshCw, AlertTriangle, X, ChevronRight, HelpCircle,
  History, Zap, Radar, Search, Globe, Download, Mail,
  Bookmark, TrendingUp, TrendingDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../ui/cn';
import { Card } from '../ui/card';
import { Section } from '../ui/section';
import { Skeleton } from '../ui/skeleton';
import { Stack } from '../layout/Stack';
import { DeepAnalysisModal } from '../components/analysis/DeepAnalysisModal';
import { WatchlistHeader } from '../components/watchlist/WatchlistHeader';
import { WatchlistFilterPanel } from '../components/watchlist/WatchlistFilterPanel';
import { WatchlistCard } from '../components/watchlist/WatchlistCard';
import { GatePyramidVisualization } from '../components/analysis/GatePyramidVisualization';
import { useWatchlistFilters } from '../hooks/useWatchlistFilters';
import { useWatchlistData } from '../hooks/useWatchlistData';
import type { StockRecommendation } from '../services/stockService';
import type { ConditionId } from '../types/quant';

function scrollToStock(code: string) {
  const element = document.getElementById(`stock-${code}`);
  if (element) {
    const headerOffset = 100;
    const elementPosition = element.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
    window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
  }
}

function WatchlistSummaryHeader({
  items,
  onBackToDiscover,
}: {
  items: StockRecommendation[];
  onBackToDiscover: () => void;
}) {
  const total = items.length;
  const stats = items.reduce(
    (acc, s) => {
      const base = s.watchedPrice ?? 0;
      const curr = s.currentPrice ?? 0;
      if (base > 0 && curr > 0) {
        const rate = ((curr - base) / base) * 100;
        acc.sum += rate;
        acc.valid += 1;
        if (rate > 0) acc.gainers += 1;
        else if (rate < 0) acc.losers += 1;
        else acc.flat += 1;
      }
      return acc;
    },
    { sum: 0, valid: 0, gainers: 0, losers: 0, flat: 0 },
  );
  const avgReturn = stats.valid > 0 ? stats.sum / stats.valid : 0;
  const avgPositive = avgReturn >= 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-3d rounded-3xl border border-blue-500/25 bg-gradient-to-br from-blue-500/[0.08] via-indigo-500/[0.04] to-transparent p-6 sm:p-8 shadow-[0_20px_60px_rgba(37,99,235,0.12)]"
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
            <Bookmark className="w-6 h-6 sm:w-7 sm:h-7 text-blue-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] sm:text-xs font-black text-blue-300/80 uppercase tracking-[0.25em]">My Watchlist</span>
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-theme-text tracking-tighter">나의 관심 목록</h2>
            <p className="text-xs sm:text-sm font-bold text-theme-text-muted mt-1">
              내가 추가한 종목만 모아서 실시간 변동을 추적합니다.
            </p>
          </div>
        </div>
        <button
          onClick={onBackToDiscover}
          className="self-start md:self-auto px-4 py-2 rounded-xl border border-theme-border bg-theme-surface text-xs font-black text-theme-text-secondary hover:text-theme-text hover:border-orange-500/40 transition-colors uppercase tracking-widest"
        >
          종목 탐색으로
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-6">
        <div className="rounded-2xl border border-theme-border bg-theme-card p-4">
          <div className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest mb-1">총 종목</div>
          <div className="text-2xl font-black text-theme-text font-num">{total}</div>
        </div>
        <div className="rounded-2xl border border-theme-border bg-theme-card p-4">
          <div className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest mb-1">평균 수익률</div>
          <div className={cn("text-2xl font-black font-num", avgPositive ? "text-green-400" : "text-red-400")}>
            {stats.valid > 0 ? `${avgPositive ? '+' : ''}${avgReturn.toFixed(2)}%` : '-'}
          </div>
        </div>
        <div className="rounded-2xl border border-green-500/20 bg-green-500/[0.06] p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3 text-green-400" />
            <span className="text-[10px] font-black text-green-400/80 uppercase tracking-widest">상승</span>
          </div>
          <div className="text-2xl font-black text-green-400 font-num">{stats.gainers}</div>
        </div>
        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingDown className="w-3 h-3 text-red-400" />
            <span className="text-[10px] font-black text-red-400/80 uppercase tracking-widest">하락</span>
          </div>
          <div className="text-2xl font-black text-red-400 font-num">{stats.losers}</div>
        </div>
      </div>
    </motion.section>
  );
}

function formatCurrency(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `₩${Math.round(value).toLocaleString('ko-KR')}`;
}

function formatWatchDate(value?: string) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('ko-KR');
}

// ────────────────────────────────────────────────────────────────────────────

interface DiscoverWatchlistPageProps {
  displayList: StockRecommendation[];
  filteredRecommendations: StockRecommendation[];
  allPatterns: string[];
  averageHitRate: number;
  strongBuyHitRate: number;
  loadingNews: boolean;
  dartAlerts: { corp_name: string; stock_code: string; report_nm: string; rcept_dt: string; sentiment: string }[];
  kisBalance: number;
  analysisReportRef: React.RefObject<HTMLDivElement | null>;
  onFetchStocks: () => Promise<void>;
  onSyncAll: () => Promise<void>;
  onSyncPrice: (stock: StockRecommendation) => Promise<StockRecommendation | null>;
  onManualPriceUpdate: (stock: StockRecommendation, newPrice: number) => void;
  onToggleWatchlist: (stock: StockRecommendation) => void;
  onAddToBacktest: (stock: StockRecommendation) => void;
  onMarketSearch: () => Promise<void>;
  onFetchNewsScores: () => Promise<void>;
  onGenerateSummary: () => Promise<void>;
  onGeneratePDF: (shouldDownload?: boolean) => Promise<string | null>;
  onExportDeepAnalysisPDF: () => Promise<void>;
  onSendEmail: () => Promise<void>;
  onRecordTrade: (stock: StockRecommendation, buyPrice: number, quantity: number, positionSize: number, followedSystem: boolean, conditionScores: Record<ConditionId, number>, gateScores: { g1: number; g2: number; g3: number; final: number }, preMortems?: import('../types/quant').PreMortemItem[]) => void;
}

export function DiscoverWatchlistPage({
  displayList, filteredRecommendations, allPatterns, averageHitRate,
  strongBuyHitRate, loadingNews, dartAlerts, kisBalance,
  analysisReportRef,
  onFetchStocks, onSyncAll, onSyncPrice, onManualPriceUpdate,
  onToggleWatchlist, onAddToBacktest, onMarketSearch, onFetchNewsScores,
  onGenerateSummary, onGeneratePDF, onExportDeepAnalysisPDF, onSendEmail,
  onRecordTrade
}: DiscoverWatchlistPageProps) {
  const {
    recommendations, watchlist, searchResults,
    loading, lastUpdated, error, setError, searchingSpecific,
    lastUsedMode, recommendationHistory,
    view, setView, autoSyncEnabled, setAutoSyncEnabled,
    setShowMasterChecklist, emailAddress, setEmailAddress,
    marketContext, syncStatus, syncingStock, nextSyncCountdown,
    deepAnalysisStock, setDeepAnalysisStock, setSelectedDetailStock,
    weeklyRsiValues, reportSummary, setReportSummary,
    isSummarizing, isGeneratingPDF, isExportingDeepAnalysis, isSendingEmail,
    setTradeRecordStock, setTradeFormData,
    newsFrequencyScores, addShadowTrade, copiedCode, handleCopy,
  } = useWatchlistData();

  const {
    filters, setFilters,
    selectedType, setSelectedType,
    selectedPattern, setSelectedPattern,
    selectedSentiment, setSelectedSentiment,
    selectedChecklist, setSelectedChecklist,
    searchQuery, setSearchQuery,
    minPrice, setMinPrice,
    maxPrice, setMaxPrice,
    sortBy, setSortBy,
    isFilterExpanded, setIsFilterExpanded,
    handleResetScreen,
    hasActiveFilters,
  } = useWatchlistFilters();

  const isWatched = React.useCallback(
    (code: string) => watchlist.some(s => s.code === code),
    [watchlist],
  );

  return (
    <Stack gap="lg">
      {/* Sync Status Bar */}
      <AnimatePresence>
        {syncStatus.isSyncing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Card variant="ghost" padding="md" className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6 !border-blue-500/10 !bg-blue-500/[0.03]">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-500/10 rounded-xl sm:rounded-2xl flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400 animate-spin" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-black text-theme-text uppercase tracking-widest mb-0.5">실시간 동기화 중</h4>
                  <p className="text-[10px] sm:text-xs text-theme-text-muted font-bold">
                    {syncStatus.currentStock} 분석 중... ({syncStatus.progress}/{syncStatus.total})
                  </p>
                </div>
              </div>
              <div className="flex-1 max-w-xs sm:max-w-md w-full">
                <div className="h-1.5 sm:h-2 bg-white/5 rounded-full overflow-hidden mb-1.5">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(syncStatus.progress / syncStatus.total) * 100}%` }}
                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 shadow-[0_0_15px_rgba(59,130,246,0.5)] transition-all duration-500"
                  />
                </div>
                <div className="flex justify-between text-micro">
                  <span>Progress</span>
                  <span>{Math.round((syncStatus.progress / syncStatus.total) * 100)}%</span>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Alert */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card variant="danger" padding="md" className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                <div className="w-9 h-9 sm:w-10 sm:h-10 bg-red-500/15 rounded-xl flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-red-400" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-red-400 uppercase tracking-widest mb-0.5">시스템 오류</h4>
                  <p className="text-xs sm:text-sm text-theme-text-secondary font-bold truncate">{error}</p>
                </div>
              </div>
              <button
                onClick={() => setError(null)}
                className="p-2 text-theme-text-muted hover:text-theme-text-secondary transition-colors shrink-0"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Market Sentiment & Hero / Top 3 / Market Context / AI Summary — DISCOVER 전용 */}
      {view === 'DISCOVER' && (
        <WatchlistHeader
          filters={filters}
          setFilters={setFilters}
          setShowMasterChecklist={setShowMasterChecklist}
          onFetchStocks={onFetchStocks}
          loading={loading}
          lastUpdated={lastUpdated}
          marketContext={marketContext}
          recommendations={recommendations}
          searchResults={searchResults}
          isSummarizing={isSummarizing}
          onGenerateSummary={onGenerateSummary}
          reportSummary={reportSummary}
          setReportSummary={setReportSummary}
          setView={setView}
          onDeepAnalysis={setDeepAnalysisStock}
        />
      )}

      {/* 관심목록 전용 헤더 — DISCOVER와 명확히 구분되는 컴팩트 섹션 */}
      {view === 'WATCHLIST' && (
        <WatchlistSummaryHeader
          items={watchlist}
          onBackToDiscover={() => setView('DISCOVER')}
        />
      )}

      {/* 3-Gate Pyramid Visualization — Signature QuantMaster UI */}
      {view === 'DISCOVER' && (
        <GatePyramidVisualization
          recommendations={recommendations}
          totalUniverse={recommendations.length}
        />
      )}

      <Section>
        {/* Search / Sort / Filter Panel */}
        <WatchlistFilterPanel
          view={view}
          loading={loading}
          loadingNews={loadingNews}
          searchingSpecific={searchingSpecific}
          recommendations={recommendations}
          searchResults={searchResults}
          allPatterns={allPatterns}
          filters={filters}
          setFilters={setFilters}
          selectedType={selectedType}
          setSelectedType={setSelectedType}
          selectedPattern={selectedPattern}
          setSelectedPattern={setSelectedPattern}
          selectedSentiment={selectedSentiment}
          setSelectedSentiment={setSelectedSentiment}
          selectedChecklist={selectedChecklist}
          setSelectedChecklist={setSelectedChecklist}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          minPrice={minPrice}
          setMinPrice={setMinPrice}
          maxPrice={maxPrice}
          setMaxPrice={setMaxPrice}
          sortBy={sortBy}
          setSortBy={setSortBy}
          isFilterExpanded={isFilterExpanded}
          setIsFilterExpanded={setIsFilterExpanded}
          hasActiveFilters={hasActiveFilters}
          handleResetScreen={handleResetScreen}
          onFetchStocks={onFetchStocks}
          onFetchNewsScores={onFetchNewsScores}
          onSyncAll={onSyncAll}
          onMarketSearch={onMarketSearch}
          autoSyncEnabled={autoSyncEnabled}
          setAutoSyncEnabled={setAutoSyncEnabled}
          nextSyncCountdown={nextSyncCountdown}
          syncStatus={syncStatus}
        />

        {view === 'WATCHLIST' && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="mb-8 sm:mb-10 rounded-3xl border border-blue-500/20 bg-gradient-to-b from-blue-500/[0.08] to-transparent p-4 sm:p-6 shadow-[0_20px_60px_rgba(37,99,235,0.15)]"
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
                </div>
                <span className="text-[11px] sm:text-xs font-black text-blue-200/80 uppercase tracking-[0.2em]">관심종목 전용 창</span>
              </div>
              <span className="text-[10px] sm:text-xs font-bold text-theme-text-muted">총 {displayList.length}개</span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
              <table className="w-full min-w-[760px]">
                <thead className="bg-white/5 border-b border-white/10">
                  <tr className="text-left">
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-theme-text-muted">종목</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-theme-text-muted">추가일</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-theme-text-muted">추가 금액</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-theme-text-muted">현재 금액</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-theme-text-muted">변동률</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-theme-text-muted">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {displayList.length > 0 ? (
                    displayList.map((stock) => {
                      const basePrice = stock.watchedPrice ?? 0;
                      const currentPrice = stock.currentPrice ?? 0;
                      const rate = basePrice > 0 ? ((currentPrice - basePrice) / basePrice) * 100 : 0;
                      const isPositive = rate >= 0;
                      return (
                        <tr key={`watch-window-${stock.code}`} className="border-b border-white/5 last:border-none">
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setSelectedDetailStock(stock)}
                              className="flex flex-col text-left hover:opacity-80 transition-opacity"
                            >
                              <span className="text-sm font-black text-theme-text">{stock.name}</span>
                              <span className="text-[11px] font-bold text-theme-text-muted">{stock.code}</span>
                            </button>
                          </td>
                          <td className="px-4 py-3 text-xs font-bold text-theme-text-secondary">{formatWatchDate(stock.watchedAt)}</td>
                          <td className="px-4 py-3 text-xs font-bold text-theme-text-secondary font-num">{formatCurrency(stock.watchedPrice)}</td>
                          <td className="px-4 py-3 text-xs font-bold text-theme-text-secondary font-num">{formatCurrency(stock.currentPrice)}</td>
                          <td className={cn(
                            "px-4 py-3 text-xs font-black font-num",
                            isPositive ? "text-green-400" : "text-red-400"
                          )}>
                            {basePrice > 0 ? `${isPositive ? '+' : ''}${rate.toFixed(2)}%` : '-'}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => onToggleWatchlist(stock)}
                              className="text-[11px] font-black px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                            >
                              제거
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm font-bold text-theme-text-muted">
                        관심 목록이 비어 있습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* Quick Navigation */}
        {view === 'DISCOVER' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 sm:mb-12 bg-white/5 rounded-[1.5rem] sm:rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-white/10 shadow-inner"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1.5 h-6 bg-orange-500 rounded-full shadow-[0_0_10px_rgba(249,115,22,0.5)]" />
              <span className="text-[10px] sm:text-xs font-black text-white/40 uppercase tracking-[0.2em]">종목 검색 퀵 네비게이션</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {displayList.map((stock) => (
                <button
                  key={`nav-${stock.code}`}
                  onClick={() => scrollToStock(stock.code)}
                  className="group flex items-center gap-2 sm:gap-3 bg-white/5 hover:bg-orange-500/10 border border-white/10 hover:border-orange-500/30 px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-xl sm:rounded-2xl transition-all active:scale-95"
                >
                  <span className="text-[10px] sm:text-xs font-black text-white group-hover:text-orange-500 transition-colors truncate max-w-[80px] sm:max-w-none">{stock.name}</span>
                  <span className="text-[8px] sm:text-[10px] font-black text-white/20 group-hover:text-orange-500/40 transition-colors">{stock.code}</span>
                  <ChevronRight className="w-3 h-3 text-white/10 group-hover:text-orange-500 transition-colors shrink-0" />
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Stats (DISCOVER view only) */}
        {view === 'DISCOVER' && (
          <div className="mb-8 grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white/5 p-6 rounded-xl sm:rounded-2xl border border-white/10 shadow-inner flex flex-col justify-center items-center gap-2 relative group/stat-1">
              <div className="flex items-center gap-1">
                <span className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.1em] sm:tracking-[0.2em] text-center">AI 추천 적중률 (최근 10회)</span>
                <HelpCircle className="w-3 h-3 text-white/10 cursor-help" />
              </div>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-black text-orange-500 tracking-tighter font-num">{averageHitRate}%</span>
                <div className={cn(
                  "mb-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest",
                  averageHitRate >= 85 ? "bg-green-500/20 text-green-400" : "bg-blue-500/20 text-blue-400"
                )}>
                  {averageHitRate >= 85 ? "Excellent" : "Stable"}
                </div>
              </div>
              <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 w-64 max-h-[250px] overflow-y-auto p-4 bg-theme-card backdrop-blur-xl border border-theme-border rounded-2xl opacity-0 group-hover/stat-1:opacity-100 transition-all duration-300 z-50 pointer-events-none shadow-2xl scale-95 group-hover/stat-1:scale-100 origin-top">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1 h-3 bg-orange-500 rounded-full" />
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">산출 기준</span>
                </div>
                <p className="text-[11px] text-white/60 leading-relaxed font-medium">
                  최근 10번의 추천 세션에서 선정된 종목들이 추천 시점 이후 <span className="text-orange-400">5거래일 이내에 +3% 이상의 수익률</span>을 기록한 비율의 평균입니다. 시스템의 전반적인 단기 예측 성공률을 나타냅니다.
                </p>
              </div>
            </div>

            <div className="bg-white/5 p-6 rounded-xl sm:rounded-2xl border border-white/10 shadow-inner flex flex-col justify-center items-center gap-2 relative group/stat-2">
              <div className="flex items-center gap-1">
                <span className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.1em] sm:tracking-[0.2em] text-center">Recent 30-day STRONG_BUY hit rate</span>
                <HelpCircle className="w-3 h-3 text-white/10 cursor-help" />
              </div>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-black text-indigo-400 tracking-tighter font-num">{strongBuyHitRate}%</span>
                <div className="mb-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest bg-indigo-500/20 text-indigo-400">
                  High Precision
                </div>
              </div>
              <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 w-64 max-h-[250px] overflow-y-auto p-4 bg-theme-card backdrop-blur-xl border border-theme-border rounded-2xl opacity-0 group-hover/stat-2:opacity-100 transition-all duration-300 z-50 pointer-events-none shadow-2xl scale-95 group-hover/stat-2:scale-100 origin-top">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1 h-3 bg-indigo-500 rounded-full" />
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">산출 기준</span>
                </div>
                <p className="text-[11px] text-white/60 leading-relaxed font-medium">
                  최근 30일간 <span className="text-indigo-400">AI 확신도(Conviction Score)가 85점 이상</span>인 '강력 매수' 종목들의 적중률입니다. 고확신도 종목에 대한 정밀도를 나타내며, 일반 추천보다 엄격한 기준으로 관리됩니다.
                </p>
              </div>
            </div>

            <div className="md:col-span-2 bg-white/5 p-6 rounded-xl sm:rounded-2xl border border-white/10 shadow-inner">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-white/30" />
                  <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">최근 추천 히스토리</span>
                </div>
                <span className="text-[9px] font-black text-white/10 uppercase tracking-widest">최근 10개 세션 저장됨</span>
              </div>
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                {recommendationHistory.length > 0 ? (
                  recommendationHistory.map((item, idx) => (
                    <div key={idx} className="flex-shrink-0 bg-white/5 p-3 rounded-2xl border border-white/5 min-w-[140px]">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[9px] font-black text-white/20">{item.date}</span>
                        <span className="text-[10px] font-black text-orange-500">{item.hitRate}%</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {item.stocks.slice(0, 2).map((s, i) => (
                          <span key={i} className="text-[9px] font-bold text-white/40 bg-white/5 px-1.5 py-0.5 rounded-md truncate max-w-[60px]">{s}</span>
                        ))}
                        {item.stocks.length > 2 && <span className="text-[9px] font-bold text-white/20">+{item.stocks.length - 2}</span>}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="w-full py-4 flex items-center justify-center border border-dashed border-white/5 rounded-2xl">
                    <span className="text-[10px] font-black text-white/10 uppercase tracking-widest italic">히스토리 데이터 없음</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stock List */}
        {view === 'DISCOVER' && (loading ? (
          <div
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
            role="status"
            aria-busy="true"
            aria-live="polite"
          >
            <span className="sr-only">종목을 불러오는 중입니다</span>
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} shape="rect" className="h-64 !rounded-3xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {displayList.length > 0 && view === 'DISCOVER' && (
              <div className={cn(
                "flex flex-wrap items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl border mb-4 backdrop-blur-sm",
                lastUsedMode === 'MOMENTUM'
                  ? "bg-orange-500/10 border-orange-500/20"
                  : "bg-blue-500/10 border-blue-500/20"
              )}>
                {lastUsedMode === 'MOMENTUM' ? (
                  <Zap className="w-4 h-4 text-orange-400 fill-current flex-shrink-0" />
                ) : (
                  <Radar className="w-4 h-4 text-blue-400 flex-shrink-0" />
                )}
                <span className={cn(
                  "text-xs font-black uppercase tracking-widest",
                  lastUsedMode === 'MOMENTUM' ? "text-orange-400" : "text-blue-400"
                )}>
                  {lastUsedMode === 'MOMENTUM' ? '지금 살 종목' : '미리 볼 종목'} 결과
                </span>
                <span className="text-xs text-white/30 font-bold">
                  — {displayList.length}개 종목
                </span>
                <span className="sm:ml-auto text-[10px] text-white/20 font-bold">
                  {lastUsedMode === 'MOMENTUM'
                    ? '현재 강한 모멘텀 · 수급 집중 종목'
                    : '급등 전 선행 신호 · 에너지 응축 종목'}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              <AnimatePresence mode="popLayout">
                {displayList.length > 0 ? (
                  displayList.map((stock, idx) => (
                    <WatchlistCard
                      key={stock.code}
                      stock={stock}
                      idx={idx}
                      view={view}
                      lastUsedMode={lastUsedMode}
                      isWatched={isWatched}
                      copiedCode={copiedCode}
                      onCopy={handleCopy}
                      newsFrequencyScores={newsFrequencyScores}
                      dartAlerts={dartAlerts}
                      syncingStock={syncingStock}
                      kisBalance={kisBalance}
                      onDeepAnalysis={setDeepAnalysisStock}
                      onDetailStock={setSelectedDetailStock}
                      onToggleWatchlist={onToggleWatchlist}
                      onAddToBacktest={onAddToBacktest}
                      onSetTradeRecord={(s) => {
                        setTradeRecordStock(s);
                        setTradeFormData({ buyPrice: String(s.currentPrice || ''), quantity: '', positionSize: '10', followedSystem: true });
                      }}
                      onAddShadowTrade={addShadowTrade}
                      onSetView={setView}
                      onSyncPrice={onSyncPrice}
                      onManualPriceUpdate={onManualPriceUpdate}
                    />
                  ))
                ) : (
                  <motion.div
                    key="empty-state"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="col-span-full py-24 text-center border-2 border-dashed border-white/5 rounded-2xl sm:rounded-3xl bg-white/[0.01]"
                  >
                    <div className="relative inline-block mb-6">
                      <div className="absolute inset-0 bg-orange-500/10 blur-2xl rounded-full animate-pulse" />
                      <Search className="w-16 h-16 text-white/10 relative z-10" />
                    </div>
                    <p className="text-white/40 font-black text-lg mb-6 uppercase tracking-widest">
                      {(recommendations || []).length === 0 ? '검색된 종목이 없습니다.' : '조건에 맞는 종목이 없습니다.'}
                    </p>
                    {searchQuery && (
                      <div className="flex flex-col items-center gap-4">
                        <p className="text-white/20 text-sm max-w-md mx-auto leading-relaxed">
                          현재 필터링된 리스트에는 해당 종목이 없습니다.<br />
                          전체 시장 데이터를 조회하시겠습니까?
                        </p>
                        <button
                          onClick={onMarketSearch}
                          disabled={searchingSpecific}
                          className={cn(
                            "px-8 py-4 text-white font-black rounded-2xl transition-all flex items-center gap-3 shadow-xl",
                            searchingSpecific
                              ? "bg-gradient-to-br from-cyan-400 via-blue-500 to-blue-700 shadow-blue-500/30 animate-pulse cursor-not-allowed"
                              : "btn-3d bg-orange-500 hover:bg-orange-600"
                          )}
                        >
                          {searchingSpecific ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Globe className="w-5 h-5" />}
                          {searchingSpecific ? '검색 중...' : `"${searchQuery}" 전체 시장에서 검색`}
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        ))}
      </Section>

      <DeepAnalysisModal
        stock={deepAnalysisStock}
        onClose={() => setDeepAnalysisStock(null)}
        analysisReportRef={analysisReportRef}
        weeklyRsiValues={weeklyRsiValues}
        onExportPDF={onExportDeepAnalysisPDF}
        isExporting={isExportingDeepAnalysis}
      />

      {/* Export Report Section */}
      <div className="mt-12 mb-8 px-4">
        <div className="max-w-2xl mx-auto glass-3d rounded-2xl border border-theme-border p-6 sm:p-8 shadow-xl relative overflow-hidden">
          <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="text-center sm:text-left flex-1 min-w-0">
              <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-[0.2em]">Export</span>
              </div>
              <h2 className="text-lg sm:text-xl font-black text-theme-text mb-2 tracking-tight uppercase break-keep">분석 리포트 내보내기</h2>
              <p className="text-xs text-theme-text-muted font-bold leading-relaxed">
                PDF 저장 또는 이메일 전송
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => onGeneratePDF()}
                disabled={isGeneratingPDF || loading}
                className={cn(
                  "flex items-center gap-3 px-5 py-3 rounded-xl transition-all duration-300 disabled:opacity-50 active:scale-95 group/btn border",
                  isGeneratingPDF
                    ? "bg-blue-500/20 border-blue-500/30"
                    : "bg-white/5 hover:bg-blue-500/20 border-theme-border hover:border-blue-500/30"
                )}
                title="PDF 리포트 다운로드"
              >
                <Download className={cn("w-5 h-5 transition-colors", isGeneratingPDF ? "animate-pulse text-blue-400" : "text-theme-text-muted group-hover/btn:text-blue-400")} />
                <span className={cn("text-sm font-black transition-colors", isGeneratingPDF ? "text-blue-400" : "text-theme-text group-hover/btn:text-blue-400")}>{isGeneratingPDF ? '생성중...' : 'PDF'}</span>
              </button>

              <button
                onClick={() => {
                  if (!emailAddress && !localStorage.getItem('k-stock-email')) {
                    const email = prompt('리포트를 전송할 이메일 주소를 입력해주세요:', 'silverlh614@gmail.com');
                    if (email) {
                      setEmailAddress(email);
                      setTimeout(() => onSendEmail(), 100);
                    }
                  } else {
                    onSendEmail();
                  }
                }}
                disabled={isSendingEmail || loading}
                className={cn(
                  "flex items-center gap-3 px-5 py-3 rounded-xl transition-all duration-300 disabled:opacity-50 active:scale-95 group/btn border",
                  isSendingEmail
                    ? "bg-green-500/20 border-green-500/30"
                    : "bg-white/5 hover:bg-green-500/20 border-theme-border hover:border-green-500/30"
                )}
                title="이메일로 전송"
              >
                <Mail className={cn("w-5 h-5 transition-colors", isSendingEmail ? "animate-pulse text-green-400" : "text-theme-text-muted group-hover/btn:text-green-400")} />
                <span className={cn("text-sm font-black transition-colors", isSendingEmail ? "text-green-400" : "text-theme-text group-hover/btn:text-green-400")}>{isSendingEmail ? '전송중...' : 'Email'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Stack>
  );
}
