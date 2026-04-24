import React from 'react';
import {
  Search, RefreshCw, Info, Clock, Globe, AlertTriangle, BarChart3,
  TrendingUp, TrendingDown, Sparkles, X, Zap, Star, Activity,
  ArrowUpRight, Crown, Layers, Flame, ArrowRight, Calendar,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { cn } from '../../ui/cn';
import { HeroChecklist } from '../trading/HeroChecklist';
import { ConfidenceBadge } from '../common/ConfidenceBadge';
import { OffHoursBanner } from '../common/OffHoursBanner';
import { MASTER_CHECKLIST_STEPS, getMarketPhaseInfo } from '../../constants/checklist';
import type { StockRecommendation, MarketContext, StockFilters } from '../../services/stockService';
import type { View } from '../../stores/useSettingsStore';

export interface WatchlistHeaderProps {
  filters: StockFilters;
  setFilters: (filters: StockFilters | ((prev: StockFilters) => StockFilters)) => void;
  setShowMasterChecklist: (v: boolean) => void;
  onFetchStocks: () => void;
  loading: boolean;
  lastUpdated: string | null;
  marketContext: MarketContext | null | undefined;
  recommendations: StockRecommendation[];
  searchResults: StockRecommendation[];
  isSummarizing: boolean;
  onGenerateSummary: () => Promise<void>;
  reportSummary: string | null;
  setReportSummary: (v: string | null) => void;
  setView: (v: View) => void;
  onDeepAnalysis: (stock: StockRecommendation) => void;
}

export function WatchlistHeader({
  filters,
  setFilters,
  setShowMasterChecklist,
  onFetchStocks,
  loading,
  lastUpdated,
  marketContext,
  recommendations,
  searchResults,
  isSummarizing,
  onGenerateSummary,
  reportSummary,
  setReportSummary,
  setView,
  onDeepAnalysis,
}: WatchlistHeaderProps) {
  return (
    <>
      {/* 장외 시에만 표시 — 장중엔 null */}
      <OffHoursBanner className="mb-4 sm:mb-6" />

      {/* Market Sentiment & Hero Section */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-2 glass-gradient rounded-2xl sm:rounded-3xl p-6 sm:p-10 lg:p-14 relative overflow-hidden group"
        >
          <div className="relative z-10">
            <h2 className="text-3xl sm:text-5xl lg:text-7xl font-bold mb-4 sm:mb-6 leading-[1.1] tracking-tight">
              <span className="text-gradient-blue">QuantMaster</span>{' '}
              <span className="text-gradient-accent">Pro</span>
            </h2>
            <p className="text-xs sm:text-sm lg:text-base font-bold text-theme-text-muted uppercase tracking-[0.15em] sm:tracking-[0.2em] mb-6 sm:mb-10">
              데이터와 사이클 기반 정밀 분석
            </p>
            <div className="relative group/info mb-10">
              <p className="text-theme-text-muted max-w-xl text-lg sm:text-xl font-medium leading-relaxed">
                AI 기반 <span className="text-theme-text border-b border-theme-border cursor-help font-bold" onClick={() => setShowMasterChecklist(true)}>27단계 마스터 체크리스트</span>를 통과한 주도주 포착 시스템.
              </p>
              <button
                onClick={() => setShowMasterChecklist(true)}
                className="absolute -right-8 top-0 p-2 text-theme-text-muted hover:text-blue-400 transition-colors"
              >
                <Info className="w-5 h-5" />
              </button>
            </div>

            <HeroChecklist steps={MASTER_CHECKLIST_STEPS} onShowChecklist={() => setShowMasterChecklist(true)} />

            <div className="flex flex-col gap-5 mb-12">
              {/* Filter Buttons Row */}
              <div className="flex flex-col gap-2 w-full">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full">
                  <button
                    onClick={() => setFilters(prev => ({ ...prev, mode: 'MOMENTUM' }))}
                    className={cn(
                      "flex flex-col items-start gap-1 px-4 sm:px-5 py-3 sm:py-4 rounded-xl transition-all border",
                      filters.mode === 'MOMENTUM'
                        ? "bg-orange-500/15 border-orange-500/30 shadow-lg shadow-orange-500/10"
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Zap className={cn("w-4 h-4", filters.mode === 'MOMENTUM' ? "text-orange-500 fill-current" : "text-white/40")} />
                      <span className={cn("text-xs sm:text-sm font-black", filters.mode === 'MOMENTUM' ? "text-orange-500" : "text-white/60")}>지금 살 종목</span>
                    </div>
                    <span className={cn("text-[10px] font-medium leading-tight", filters.mode === 'MOMENTUM' ? "text-orange-500/60" : "text-white/25")}>
                      강한 모멘텀과 수급이 집중되는 단기 매수 적기 종목
                    </span>
                  </button>
                  <button
                    onClick={() => setFilters(prev => ({ ...prev, mode: 'EARLY_DETECT' }))}
                    className={cn(
                      "flex flex-col items-start gap-1 px-4 sm:px-5 py-3 sm:py-4 rounded-xl transition-all border",
                      filters.mode === 'EARLY_DETECT'
                        ? "bg-blue-500/15 border-blue-500/30 shadow-lg shadow-blue-500/10"
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Activity className={cn("w-4 h-4", filters.mode === 'EARLY_DETECT' ? "text-blue-500 fill-current" : "text-white/40")} />
                      <span className={cn("text-xs sm:text-sm font-black", filters.mode === 'EARLY_DETECT' ? "text-blue-500" : "text-white/60")}>미리 살 종목</span>
                    </div>
                    <span className={cn("text-[10px] font-medium leading-tight", filters.mode === 'EARLY_DETECT' ? "text-blue-500/60" : "text-white/25")}>
                      급등 전 선행 신호가 포착된 에너지 응축 종목
                    </span>
                  </button>
                  <button
                    onClick={() => setFilters(prev => ({ ...prev, mode: 'QUANT_SCREEN' }))}
                    className={cn(
                      "flex flex-col items-start gap-1 px-4 sm:px-5 py-3 sm:py-4 rounded-xl transition-all border",
                      filters.mode === 'QUANT_SCREEN'
                        ? "bg-emerald-500/15 border-emerald-500/30 shadow-lg shadow-emerald-500/10"
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Activity className={cn("w-4 h-4", filters.mode === 'QUANT_SCREEN' ? "text-emerald-500 fill-current" : "text-white/40")} />
                      <span className={cn("text-xs sm:text-sm font-black", filters.mode === 'QUANT_SCREEN' ? "text-emerald-500" : "text-white/60")}>숨은 종목 발굴</span>
                    </div>
                    <span className={cn("text-[10px] font-medium leading-tight", filters.mode === 'QUANT_SCREEN' ? "text-emerald-500/60" : "text-white/25")}>
                      ROE, PER, 부채비율 등 정량 지표 기반 저평가 종목 스크리닝
                    </span>
                  </button>
                </div>
              </div>

              {/* Analysis Start Button */}
              <button
                onClick={onFetchStocks}
                disabled={loading}
                className={cn(
                  "btn-3d px-8 sm:px-12 py-4 sm:py-5 rounded-2xl font-black text-base sm:text-xl flex items-center gap-3 sm:gap-4 transition-all duration-300 w-full sm:w-auto justify-center border-t",
                  loading
                    ? "bg-gradient-to-br from-cyan-400 via-blue-500 to-blue-700 border-cyan-300/40 shadow-[0_12px_40px_rgba(59,130,246,0.5)] text-white animate-pulse"
                    : "bg-gradient-to-br from-orange-400 via-orange-500 to-orange-700 hover:from-orange-300 hover:via-orange-400 hover:to-orange-600 border-white/40 shadow-[0_12px_40px_rgba(249,115,22,0.4)] text-white"
                )}
              >
                {loading ? (
                  <RefreshCw className="w-6 h-6 sm:w-7 sm:h-7 animate-spin" />
                ) : (
                  <Search className="w-6 h-6 sm:w-7 sm:h-7" />
                )}
                <span className="tracking-tighter">{loading ? '분석 진행중...' : '주도주 분석 시작'}</span>
              </button>

              {/* Last Updated Info */}
              {lastUpdated && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-bold text-white/20 uppercase tracking-[0.2em] flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    Last Updated: {new Date(lastUpdated).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} (KST)
                  </p>
                  {marketContext?.dataSource && (
                    <p className="text-[10px] font-bold text-green-500/40 uppercase tracking-[0.1em] flex items-center gap-2">
                      <Globe className="w-2.5 h-2.5" />
                      Source: {marketContext.dataSource}
                    </p>
                  )}
                  {(() => {
                    const last = new Date(lastUpdated).getTime();
                    const now = new Date().getTime();
                    const diff = (now - last) / (1000 * 60);
                    if (diff > 30) {
                      return (
                        <p className="text-[10px] font-black text-orange-500/60 uppercase tracking-widest flex items-center gap-2 animate-pulse">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          Data may be stale. Please refresh for real-time analysis.
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Decorative gradient orbs */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/[0.08] blur-[120px] -mr-32 -mt-32" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/[0.06] blur-[100px] -ml-32 -mb-32" />
          <div className="absolute top-1/2 right-1/4 w-48 h-48 bg-cyan-500/[0.04] blur-[80px]" />
        </motion.div>

        {/* Market Sentiment Card */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass-gradient rounded-2xl sm:rounded-3xl p-10 flex flex-col justify-between group"
        >
          <div>
            <h3 className="text-xs font-black text-white/30 uppercase tracking-[0.2em] mb-10 flex items-center gap-3">
              <BarChart3 className="w-5 h-5" />
              Market Sentiment
            </h3>

            <div className="space-y-8">
              {!marketContext && (
                <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                    <BarChart3 className="w-7 h-7 text-white/20" />
                  </div>
                  <p className="text-sm font-bold text-white/25 uppercase tracking-widest">데이터 없음</p>
                  <p className="text-xs text-white/15 max-w-[200px] leading-relaxed">시장 분석을 실행하면<br />센티멘트 지표가 표시됩니다</p>
                </div>
              )}
              {marketContext && (
                <>
                  {marketContext.fearAndGreed && (
                    <div className="group/item">
                      <div className="flex justify-between items-end mb-3">
                        <span className="text-sm font-bold text-white/50 uppercase tracking-wide">Fear & Greed</span>
                        <span className={cn(
                          "text-3xl font-bold tracking-tight",
                          (marketContext.fearAndGreed.value || 0) < 70 ? "text-green-500" : "text-red-500"
                        )}>
                          {marketContext.fearAndGreed.value || 0}<span className="text-sm ml-1 opacity-50 font-medium">{marketContext.fearAndGreed.status || 'Neutral'}</span>
                        </span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden shadow-inner">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${marketContext.fearAndGreed.value || 0}%` }}
                          className={cn(
                            "h-full transition-all duration-1000",
                            (marketContext.fearAndGreed.value || 0) < 70 ? "bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]" : "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]"
                          )}
                        />
                      </div>
                    </div>
                  )}

                  <div className="group/item">
                    <div className="flex justify-between items-end mb-3">
                      <span className="text-sm font-bold text-white/50 uppercase tracking-wide">삼성 IRI</span>
                      <span className={cn(
                        "text-3xl font-bold tracking-tight",
                        (marketContext.iri || 0) < 2.0 ? "text-green-500" : "text-red-500"
                      )}>
                        {(marketContext.iri || 0).toFixed(1)}<span className="text-sm ml-1 opacity-50 font-medium">pt</span>
                      </span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden shadow-inner">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min((marketContext.iri || 0) * 25, 100)}%` }}
                        className={cn(
                          "h-full transition-all duration-1000",
                          (marketContext.iri || 0) < 2.0 ? "bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]" : "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]"
                        )}
                      />
                    </div>
                  </div>

                  <div className="group/item">
                    <div className="flex justify-between items-end mb-3">
                      <span className="text-sm font-bold text-white/50 uppercase tracking-wide">VKOSPI</span>
                      <span className={cn(
                        "text-3xl font-bold tracking-tight",
                        (marketContext.vkospi || 0) < 20 ? "text-green-500" : "text-red-500"
                      )}>
                        {(marketContext.vkospi || 0).toFixed(1)}<span className="text-sm ml-1 opacity-50 font-medium">%</span>
                      </span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden shadow-inner">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min((marketContext.vkospi || 0) * 2.5, 100)}%` }}
                        className={cn(
                          "h-full transition-all duration-1000",
                          (marketContext.vkospi || 0) < 20 ? "bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]" : "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]"
                        )}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="bg-white/[0.03] p-4 rounded-2xl border border-white/[0.05] hover:border-blue-500/10 transition-all">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-1">환율 (USD/KRW)</span>
                      <div className="text-xl font-black text-white tracking-tighter">
                        {(marketContext.exchangeRate?.value ?? 0) > 0 ? marketContext.exchangeRate!.value.toLocaleString() : <span className="text-sm text-white/20">—</span>}
                        {(marketContext.exchangeRate?.value ?? 0) > 0 && typeof marketContext.exchangeRate?.change === 'number' && marketContext.exchangeRate.change !== 0 && (
                          <span className={cn("text-[10px] ml-2", marketContext.exchangeRate.change > 0 ? "text-red-400" : "text-green-400")}>
                            {marketContext.exchangeRate.change > 0 ? '▲' : '▼'} {Math.abs(marketContext.exchangeRate.change)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="bg-white/[0.03] p-4 rounded-2xl border border-white/[0.05] hover:border-blue-500/10 transition-all">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-1">국채 10년물</span>
                      <div className="text-xl font-black text-white tracking-tighter">
                        {(marketContext.bondYield?.value ?? 0) > 0 ? `${marketContext.bondYield!.value}%` : <span className="text-sm text-white/20">—</span>}
                        {(marketContext.bondYield?.value ?? 0) > 0 && typeof marketContext.bondYield?.change === 'number' && marketContext.bondYield.change !== 0 && (
                          <span className={cn("text-[10px] ml-2", marketContext.bondYield.change > 0 ? "text-red-400" : "text-green-400")}>
                            {marketContext.bondYield.change > 0 ? '▲' : '▼'} {Math.abs(marketContext.bondYield.change)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {marketContext.globalMacro && (
                    <div className="grid grid-cols-2 gap-6">
                      <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-1">미 국채 10년물</span>
                        <div className="text-xl font-black text-white tracking-tighter">
                          {(marketContext.globalMacro.us10yYield ?? 0) > 0 ? `${marketContext.globalMacro.us10yYield}%` : <span className="text-sm text-white/20">—</span>}
                        </div>
                      </div>
                      <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-1">달러 인덱스</span>
                        <div className="text-xl font-black text-white tracking-tighter">
                          {(marketContext.globalMacro.dollarIndex ?? 0) > 0 ? marketContext.globalMacro.dollarIndex : <span className="text-sm text-white/20">—</span>}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="mt-8 space-y-4">
            <div className={cn(
              "p-5 rounded-2xl border-2 flex items-center justify-center gap-4 shadow-lg transition-all group-hover:scale-[1.05]",
              marketContext?.marketPhase === 'RISK_ON' || marketContext?.marketPhase === 'BULL' ? "bg-green-500/10 border-green-500/20 text-green-400 shadow-green-500/10" :
              marketContext?.marketPhase === 'RISK_OFF' || marketContext?.marketPhase === 'BEAR' ? "bg-red-500/10 border-red-500/20 text-red-400 shadow-red-500/10" :
              marketContext?.marketPhase === 'SIDEWAYS' ? "bg-blue-500/10 border-blue-500/20 text-blue-400 shadow-blue-500/10" :
              marketContext?.marketPhase === 'TRANSITION' ? "bg-purple-500/10 border-purple-500/20 text-purple-400 shadow-purple-500/10" :
              marketContext?.marketPhase === 'NEUTRAL' ? "bg-gray-500/10 border-gray-500/20 text-gray-400 shadow-gray-500/10" :
              "bg-white/5 border-white/10 text-white/60"
            )}>
              <div className={cn(
                "w-3 h-3 rounded-full animate-pulse",
                marketContext?.marketPhase === 'RISK_ON' || marketContext?.marketPhase === 'BULL' ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)]" :
                marketContext?.marketPhase === 'RISK_OFF' || marketContext?.marketPhase === 'BEAR' ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]" :
                marketContext?.marketPhase === 'SIDEWAYS' ? "bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]" :
                marketContext?.marketPhase === 'TRANSITION' ? "bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.8)]" :
                marketContext?.marketPhase === 'NEUTRAL' ? "bg-gray-500 shadow-[0_0_10px_rgba(156,163,175,0.8)]" :
                "bg-white/20"
              )} />
              <span className="text-sm font-black uppercase tracking-[0.1em]">
                System: {getMarketPhaseInfo(marketContext?.marketPhase || (marketContext?.iri && marketContext.iri < 2.0 ? 'RISK_ON' : 'RISK_OFF') || 'NEUTRAL').label}
              </span>
            </div>

            <button
              onClick={onGenerateSummary}
              disabled={isSummarizing || (!(recommendations || []).length && !(searchResults || []).length && !marketContext)}
              className={cn(
                "w-full btn-3d py-4 disabled:opacity-50 text-white text-sm font-black rounded-2xl transition-all duration-300 flex items-center justify-center gap-3 group/btn",
                isSummarizing
                  ? "bg-gradient-to-r from-cyan-500 to-blue-600 shadow-xl shadow-blue-500/30 animate-pulse"
                  : "bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-xl shadow-orange-500/20"
              )}
            >
              {isSummarizing ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Sparkles className="w-5 h-5 group-hover/btn:animate-pulse" />
              )}
              {isSummarizing ? '리포트 작성중...' : 'AI 시장분석'}
            </button>
          </div>
        </motion.div>
      </section>

      {/* Today's Top 3 Section */}
      {(recommendations || []).filter(s => (s.aiConvictionScore?.totalScore || 0) > 0 && Number.isFinite(Number(s.currentPrice)) && Number(s.currentPrice) > 0).length > 0 && (
        <section className="mb-16">
          <div className="flex items-center justify-between mb-8 px-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-orange-500/20 rounded-2xl flex items-center justify-center">
                <Crown className="w-6 h-6 text-orange-500" />
              </div>
              <div>
                <h3 className="text-2xl font-black text-theme-text tracking-tighter uppercase">오늘의 Top 3 주도주</h3>
                <p className="text-sm text-theme-text-muted font-bold">27단계 마스터 체크리스트를 가장 완벽하게 통과한 종목</p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-theme-surface rounded-xl border border-theme-border">
              <Activity className="w-4 h-4 text-green-400" />
              <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest">실시간 AI 랭킹 시스템 가동 중</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[...(recommendations || [])]
              .filter(s => (s.aiConvictionScore?.totalScore || 0) > 0 && Number.isFinite(Number(s.currentPrice)) && Number(s.currentPrice) > 0)
              .sort((a, b) => (b.aiConvictionScore?.totalScore || 0) - (a.aiConvictionScore?.totalScore || 0))
              .slice(0, 3)
              .map((stock, idx) => (
                <motion.div
                  key={stock.code}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  onClick={() => onDeepAnalysis(stock)}
                  className="glass-3d rounded-2xl sm:rounded-3xl p-8 border border-white/10 relative overflow-hidden group cursor-pointer hover:border-orange-500/50 transition-all"
                >
                  <div className="absolute top-0 right-0 p-6">
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl border shadow-2xl",
                      idx === 0 ? "bg-orange-500 border-orange-400 text-white" :
                      idx === 1 ? "bg-slate-400 border-slate-300 text-white" :
                      "bg-amber-700 border-amber-600 text-white"
                    )}>
                      {idx + 1}
                    </div>
                  </div>

                  <div className="mb-8">
                    <div className={cn(
                      "text-[10px] font-black uppercase tracking-[0.3em] mb-2",
                      (stock.type || '').includes('BUY') ? "text-red-500" : "text-blue-500"
                    )}>
                      {(stock.type || '').replace('_', ' ')}
                    </div>
                    <h4 className="text-2xl sm:text-3xl font-black text-theme-text tracking-tighter mb-1 truncate" title={stock.name}>{stock.name}</h4>
                    <div className="text-xs sm:text-sm font-black text-theme-text-muted uppercase tracking-widest truncate">{stock.code}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-8">
                    <div className="bg-theme-card rounded-2xl p-4 border border-theme-border">
                      <div className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest mb-1">AI Score</div>
                      <div className="text-2xl font-black text-orange-500">{stock.aiConvictionScore?.totalScore || 0}</div>
                    </div>
                    <div className="bg-theme-card rounded-2xl p-4 border border-theme-border">
                      <div className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest mb-1">Checklist</div>
                      <div className="text-2xl font-black text-theme-text">{Object.values(stock.checklist || {}).filter(Boolean).length}/27</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-green-400" />
                        <span className="text-lg font-black text-theme-text">₩{stock.currentPrice?.toLocaleString() || '0'}</span>
                        <ConfidenceBadge type={stock.dataSourceType || 'AI'} />
                      </div>
                      {(stock.priceUpdatedAt || stock.dataSource) && (
                        <div className="text-[8px] font-black text-theme-text-muted uppercase tracking-tighter mt-1">
                          {stock.priceUpdatedAt} {stock.dataSource && `via ${stock.dataSource}`}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-green-400 font-black text-sm">
                      <ArrowUpRight className="w-4 h-4" />
                      {(() => {
                        // Fix 2 — enrichStockWithRealData 가 이미 fallback 을 적용하므로
                        // 일반적으로 targetPrice 는 0 이 아니다. 그래도 안전하게 guard.
                        const tp = Number(stock.targetPrice) || 0;
                        const cp = Number(stock.currentPrice) || 0;
                        if (tp <= 0 || cp <= 0) return '—';
                        const upside = Math.round((tp / cp - 1) * 100);
                        return upside > 0 ? `+${upside}%` : `${upside}%`;
                      })()}
                    </div>
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-orange-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                </motion.div>
              ))}
          </div>
        </section>
      )}

      {/* Market Context Section */}
      {marketContext && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12"
        >
          <div className="glass-3d rounded-2xl sm:rounded-3xl p-8 border border-theme-border shadow-2xl relative overflow-hidden">
            <div className="flex flex-col lg:flex-row gap-8 items-center relative z-10">
              <div className="flex-1 space-y-6 w-full">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <div className="w-2 h-8 bg-orange-500 rounded-full" />
                  <h3 className="text-xl font-black text-theme-text uppercase tracking-tighter">실시간 시장 분석 (Market Context)</h3>
                  {marketContext.upcomingEvents && marketContext.upcomingEvents.some(e => e.impact === 'HIGH' && e.dDay <= 5) && (
                    <motion.div
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="w-full bg-red-500/10 border border-red-500/20 rounded-3xl p-6 flex flex-col md:flex-row items-center gap-6 relative overflow-hidden group mt-4"
                    >
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <AlertTriangle className="w-24 h-24 text-red-500" />
                      </div>
                      <div className="w-16 h-16 rounded-2xl bg-red-500/20 flex items-center justify-center shrink-0">
                        <Calendar className="w-8 h-8 text-red-500" />
                      </div>
                      <div className="flex-1 text-center md:text-left relative z-10">
                        <div className="flex items-center justify-center md:justify-start gap-2 mb-1">
                          <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">Critical Market Event Detected</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        </div>
                        <h3 className="text-xl font-black text-white mb-2">
                          {marketContext.upcomingEvents.find(e => e.impact === 'HIGH' && e.dDay <= 5)?.title} (D-{marketContext.upcomingEvents.find(e => e.impact === 'HIGH' && e.dDay <= 5)?.dDay})
                        </h3>
                        <p className="text-sm text-gray-400 font-medium max-w-xl">
                          {marketContext.upcomingEvents.find(e => e.impact === 'HIGH' && e.dDay <= 5)?.strategyAdjustment}
                        </p>
                      </div>
                      <button
                        onClick={() => setView('MARKET')}
                        className="px-6 py-3 bg-red-500 text-white text-sm font-black rounded-2xl hover:bg-red-600 transition-all flex items-center gap-2 shrink-0 relative z-10"
                      >
                        상세 분석 보기
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </motion.div>
                  )}
                  {marketContext.marketPhase && (
                    <div className={cn(
                      "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border-2 flex items-center gap-2 whitespace-nowrap shrink-0",
                      marketContext.marketPhase === 'RISK_ON' || marketContext.marketPhase === 'BULL' ? "bg-green-500/20 text-green-400 border-green-500/30" :
                      marketContext.marketPhase === 'RISK_OFF' || marketContext.marketPhase === 'BEAR' ? "bg-red-500/20 text-red-400 border-red-500/30" :
                      marketContext.marketPhase === 'SIDEWAYS' ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                      marketContext.marketPhase === 'TRANSITION' ? "bg-purple-500/20 text-purple-400 border-purple-500/30" :
                      marketContext.marketPhase === 'NEUTRAL' ? "bg-gray-500/20 text-gray-400 border-gray-500/30" :
                      "bg-white/10 text-white/60 border-white/20"
                    )} title={getMarketPhaseInfo(marketContext.marketPhase).description}>
                      {getMarketPhaseInfo(marketContext.marketPhase).label}
                      <Info className="w-3 h-3 opacity-50" />
                    </div>
                  )}
                </div>
                <p className="text-theme-text-secondary text-lg leading-relaxed font-black">
                  {marketContext.overallSentiment}
                </p>

                <div className="bg-theme-card p-4 rounded-2xl border border-theme-border">
                  <div className="flex items-center gap-2 mb-2">
                    <Info className="w-4 h-4 text-orange-500" />
                    <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest">Market Phase란?</span>
                  </div>
                  <p className="text-[11px] text-theme-text-secondary leading-relaxed font-medium">
                    현재 시장이 처한 <strong>'단계'</strong>를 의미합니다. {getMarketPhaseInfo(marketContext.marketPhase).description}
                    AI는 이 단계를 분석하여 각 종목에 대한 투자 비중과 전략을 동적으로 조절합니다.
                  </p>
                </div>

                {marketContext.activeStrategy && (
                  <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/20 px-6 py-4 rounded-3xl group/strategy hover:bg-orange-500/20 transition-all">
                    <div className="w-10 h-10 rounded-2xl bg-orange-500/20 flex items-center justify-center group-hover/strategy:scale-110 transition-transform">
                      <Zap className="w-5 h-5 text-orange-500" />
                    </div>
                    <div>
                      <span className="text-[10px] font-black text-orange-500/60 uppercase tracking-[0.2em] block mb-1">AI 동적 가중치 전략 (Dynamic Weighting)</span>
                      <p className="text-sm font-black text-white/80 leading-tight">
                        {marketContext.activeStrategy}
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-inner group hover:bg-white/[0.08] transition-all">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">KOSPI</span>
                        <span className="text-2xl font-black text-white tracking-tighter">{marketContext.kospi.index?.toLocaleString() || '0'}</span>
                      </div>
                      <div className={cn(
                        "px-3 py-1 rounded-full text-xs font-black flex items-center gap-1.5",
                        marketContext.kospi.change >= 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                      )}>
                        {marketContext.kospi.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {marketContext.kospi.changePercent}%
                      </div>
                    </div>
                    <p className="text-xs text-white/50 leading-relaxed font-bold">
                      {marketContext.kospi.analysis}
                    </p>
                  </div>

                  <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-inner group hover:bg-white/[0.08] transition-all">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">KOSDAQ</span>
                        <span className="text-2xl font-black text-white tracking-tighter">{marketContext.kosdaq.index?.toLocaleString() || '0'}</span>
                      </div>
                      <div className={cn(
                        "px-3 py-1 rounded-full text-xs font-black flex items-center gap-1.5",
                        marketContext.kosdaq.change >= 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                      )}>
                        {marketContext.kosdaq.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {marketContext.kosdaq.changePercent}%
                      </div>
                    </div>
                    <p className="text-xs text-white/50 leading-relaxed font-bold">
                      {marketContext.kosdaq.analysis}
                    </p>
                  </div>
                </div>

                {/* New Quant Features in Market Context */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {marketContext.sectorRotation && (
                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-inner group hover:bg-white/[0.08] transition-all">
                      <div className="flex items-center gap-2 mb-4">
                        <Layers className="w-4 h-4 text-blue-400" />
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">Sector Rotation</span>
                      </div>
                      <div className="space-y-3">
                        {(marketContext.sectorRotation?.topSectors || []).slice(0, 3).map((sector, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white/60">{sector.name}</span>
                            <span className="text-[10px] font-black text-blue-400 uppercase tracking-tighter">Rank {sector.rank}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {marketContext.euphoriaSignals && (
                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-inner group hover:bg-white/[0.08] transition-all">
                      <div className="flex items-center gap-2 mb-4">
                        <Flame className="w-4 h-4 text-orange-500" />
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">Euphoria Detector</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-3xl font-black text-white">{marketContext.euphoriaSignals.score}</div>
                        <div className="flex-1">
                          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className={cn(
                                "h-full transition-all duration-1000",
                                marketContext.euphoriaSignals.score > 70 ? "bg-red-500" : "bg-orange-500"
                              )}
                              style={{ width: `${marketContext.euphoriaSignals.score}%` }}
                            />
                          </div>
                          <p className="text-[10px] font-bold text-white/30 mt-2 uppercase tracking-widest">
                            {marketContext.euphoriaSignals.status}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {marketContext.regimeShiftDetector && (
                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-inner group hover:bg-white/[0.08] transition-all">
                      <div className="flex items-center gap-2 mb-4">
                        <Zap className="w-4 h-4 text-purple-400" />
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">Regime Shift</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-2xl flex items-center justify-center",
                          marketContext.regimeShiftDetector.isShiftDetected ? "bg-red-500/20 text-red-500" : "bg-green-500/20 text-green-500"
                        )}>
                          <Activity className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-white uppercase tracking-tight">
                            {marketContext.regimeShiftDetector.currentRegime}
                          </p>
                          <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">
                            {marketContext.regimeShiftDetector.isShiftDetected ? "Shift Detected" : "Stable Regime"}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {marketContext.globalEtfMonitoring && (
                  <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-inner group hover:bg-white/[0.08] transition-all">
                    <div className="flex items-center gap-2 mb-4">
                      <Globe className="w-4 h-4 text-indigo-400" />
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">Global ETF Monitoring</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {(marketContext.globalEtfMonitoring || []).map((etf, i) => (
                        <div key={i} className="flex flex-col gap-1">
                          <span className="text-[10px] font-black text-white/30 uppercase tracking-widest truncate">{etf.name || etf.symbol}</span>
                          {etf.symbol && <span className="text-[9px] text-white/20">{etf.symbol}</span>}
                          <div className="flex items-center gap-2">
                            {etf.price ? (
                              <span className="text-sm font-black text-white">₩{etf.price.toLocaleString()}</span>
                            ) : null}
                            <span className={cn("text-[10px] font-bold", (etf.change || 0) >= 0 ? "text-green-400" : "text-red-400")}>
                              {(etf.change || 0) >= 0 ? '+' : ''}{etf.change || 0}%
                            </span>
                          </div>
                          {etf.flow && (
                            <span className={cn("text-[9px] font-black uppercase tracking-widest", etf.flow === 'INFLOW' ? "text-green-400/60" : "text-red-400/60")}>
                              {etf.flow === 'INFLOW' ? '▲ 유입' : '▼ 유출'}
                            </span>
                          )}
                          {etf.implication && (
                            <span className="text-[9px] text-white/20 leading-tight">{etf.implication}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {marketContext.globalIndices && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white/5 rounded-2xl p-4 border border-white/10 shadow-inner">
                      <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">NASDAQ</span>
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-black text-white">{marketContext.globalIndices.nasdaq.index?.toLocaleString() || '0'}</span>
                        <span className={cn("text-[10px] font-black", marketContext.globalIndices.nasdaq.changePercent >= 0 ? "text-green-400" : "text-red-400")}>
                          {marketContext.globalIndices.nasdaq.changePercent >= 0 ? '+' : ''}{marketContext.globalIndices.nasdaq.changePercent}%
                        </span>
                      </div>
                    </div>
                    <div className="bg-white/5 rounded-2xl p-4 border border-white/10 shadow-inner">
                      <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">S&P 500</span>
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-black text-white">{marketContext.globalIndices.snp500.index?.toLocaleString() || '0'}</span>
                        <span className={cn("text-[10px] font-black", marketContext.globalIndices.snp500.changePercent >= 0 ? "text-green-400" : "text-red-400")}>
                          {marketContext.globalIndices.snp500.changePercent >= 0 ? '+' : ''}{marketContext.globalIndices.snp500.changePercent}%
                        </span>
                      </div>
                    </div>
                    <div className="bg-white/5 rounded-2xl p-4 border border-white/10 shadow-inner">
                      <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">DOW</span>
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-black text-white">{marketContext.globalIndices.dow.index?.toLocaleString() || '0'}</span>
                        <span className={cn("text-[10px] font-black", marketContext.globalIndices.dow.changePercent >= 0 ? "text-green-400" : "text-red-400")}>
                          {marketContext.globalIndices.dow.changePercent >= 0 ? '+' : ''}{marketContext.globalIndices.dow.changePercent}%
                        </span>
                      </div>
                    </div>
                    <div className="bg-white/5 rounded-2xl p-4 border border-white/10 shadow-inner">
                      <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">SOX (Semicon)</span>
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-black text-white">{marketContext.globalIndices.sox.index?.toLocaleString() || '0'}</span>
                        <span className={cn("text-[10px] font-black", marketContext.globalIndices.sox.changePercent >= 0 ? "text-green-400" : "text-red-400")}>
                          {marketContext.globalIndices.sox.changePercent >= 0 ? '+' : ''}{marketContext.globalIndices.sox.changePercent}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Decorative background */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/5 blur-[80px] -mr-20 -mt-20" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-500/5 blur-[60px] -ml-16 -mb-16" />
          </div>
        </motion.section>
      )}

      {/* AI Report Summary Section */}
      <AnimatePresence>
        {reportSummary && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-12 overflow-hidden"
          >
            <div className="glass-3d rounded-2xl sm:rounded-3xl p-8 border border-orange-500/20 shadow-2xl relative overflow-hidden bg-gradient-to-br from-orange-500/5 to-transparent">
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-orange-500 rounded-full" />
                    <h3 className="text-xl font-black text-theme-text uppercase tracking-tighter flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-orange-500" />
                      AI 시장분석
                    </h3>
                  </div>
                  <button
                    onClick={() => setReportSummary(null)}
                    className="p-2 hover:bg-theme-surface rounded-full transition-colors text-theme-text-muted hover:text-theme-text"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="prose prose-invert max-w-none">
                  <div className="text-theme-text-secondary text-lg leading-relaxed font-medium space-y-4">
                    <ReactMarkdown>{reportSummary}</ReactMarkdown>
                  </div>
                </div>
              </div>

              <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/10 blur-[80px] -mr-20 -mt-20 animate-pulse" />
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}
