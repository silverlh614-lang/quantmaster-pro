/**
 * @responsibility DISCOVER 탭 hero, 모드 필터, 추천 트리거, Top 3 주도주를 렌더한다.
 */
import React from 'react';
import {
  Search, RefreshCw, Info, Clock, Globe, AlertTriangle,
  TrendingUp, Zap, Activity, ArrowUpRight, Crown,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../ui/cn';
import { HeroChecklist } from '../trading/HeroChecklist';
import { ConfidenceBadge } from '../common/ConfidenceBadge';
import { OffHoursBanner } from '../common/OffHoursBanner';
import { RecommendationWarningsBanner } from '../common/RecommendationWarningsBanner';
import { MASTER_CHECKLIST_STEPS } from '../../constants/checklist';
import type { StockRecommendation, MarketContext, StockFilters } from '../../services/stockService';

export interface WatchlistHeaderProps {
  filters: StockFilters;
  setFilters: (filters: StockFilters | ((prev: StockFilters) => StockFilters)) => void;
  setShowMasterChecklist: (v: boolean) => void;
  onFetchStocks: () => void;
  loading: boolean;
  lastUpdated: string | null;
  marketContext: MarketContext | null | undefined;
  recommendations: StockRecommendation[];
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
  onDeepAnalysis,
}: WatchlistHeaderProps) {
  return (
    <>
      {/* 장외 시에만 표시 — 장중엔 null */}
      <OffHoursBanner className="mb-4 sm:mb-6" />

      {/* AI 추천 universe 발굴 경고 — Google Search 미설정/예산초과/실패 시 영구 표시 */}
      <RecommendationWarningsBanner className="mb-4 sm:mb-6" />

      {/* Hero Section — 시장 분석 카드 제거(ADR-0012) 후 풀폭으로 확장 */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-3 glass-gradient rounded-2xl sm:rounded-3xl p-6 sm:p-10 lg:p-14 relative overflow-hidden group"
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
    </>
  );
}
