import React from 'react';
import {
  TrendingUp, TrendingDown, Bookmark, Star, Award, History, Plus, Zap,
  AlertTriangle, Copy, FileText, Search, ExternalLink, Flame, Target,
  ShieldCheck, Clock, Newspaper, BarChart3, ChevronRight, Cloud, Crown,
  Activity,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../ui/cn';
import { ConfidenceBadge } from '../common/ConfidenceBadge';
import { SignalBadge } from '../../ui/badge';
import { PriceEditCell } from '../common/PriceEditCell';
import { isMarketOpenFor, nextOpenAtFor, formatNextOpenKst } from '../../utils/marketTime';
import type { StockRecommendation } from '../../services/stockService';
import type { NewsFrequencyScore } from '../../types/quant';
import type { ConditionId } from '../../types/quant';
import type { View } from '../../stores/useSettingsStore';
import { buildShadowTrade } from '../../services/autoTrading';

export interface WatchlistCardProps {
  stock: StockRecommendation;
  idx: number;
  view: string;
  lastUsedMode: string;
  isWatched: (code: string) => boolean;
  copiedCode: string | null;
  onCopy: (name: string, code: string) => void;
  newsFrequencyScores: NewsFrequencyScore[];
  dartAlerts: { corp_name: string; stock_code: string; report_nm: string; rcept_dt: string; sentiment: string }[];
  syncingStock: string | null;
  kisBalance: number;
  onDeepAnalysis: (stock: StockRecommendation) => void;
  onDetailStock: (stock: StockRecommendation) => void;
  onToggleWatchlist: (stock: StockRecommendation) => void;
  onAddToBacktest: (stock: StockRecommendation) => void;
  onSetTradeRecord: (stock: StockRecommendation) => void;
  onAddShadowTrade: (trade: any) => void;
  onSetView: (view: View) => void;
  onSyncPrice: (stock: StockRecommendation) => Promise<StockRecommendation | null>;
  onManualPriceUpdate: (stock: StockRecommendation, newPrice: number) => void;
}

export function WatchlistCard({
  stock,
  idx,
  view,
  lastUsedMode,
  isWatched,
  copiedCode,
  onCopy,
  newsFrequencyScores,
  dartAlerts,
  syncingStock,
  kisBalance,
  onDeepAnalysis,
  onDetailStock,
  onToggleWatchlist,
  onAddToBacktest,
  onSetTradeRecord,
  onAddShadowTrade,
  onSetView,
  onSyncPrice,
  onManualPriceUpdate,
}: WatchlistCardProps) {
  const isAllGatesPassed =
    stock.gateEvaluation?.isPassed === true ||
    (stock.gateEvaluation?.gate1Passed === true &&
      stock.gateEvaluation?.gate2Passed === true &&
      stock.gateEvaluation?.gate3Passed === true);

  return (
    <motion.div
      key={stock.code}
      id={`stock-${stock.code}`}
      data-stock-code={stock.code}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: idx * 0.05 }}
      onClick={() => onDetailStock(stock)}
      className={cn(
        "glass-3d card-3d rounded-2xl sm:rounded-3xl p-0 transition-all duration-500 relative overflow-hidden flex flex-col h-full group border-theme-border hover:border-white/20 cursor-pointer",
        stock.peakPrice > 0 && Math.round((stock.currentPrice / stock.peakPrice - 1) * 100) <= -30
          ? "!border-red-500/40 shadow-[0_0_40px_rgba(239,68,68,0.15)]"
          : isAllGatesPassed
            ? "!border-yellow-400/60 shadow-[0_0_40px_rgba(250,204,21,0.2)]"
            : "shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
      )}
    >
      {/* All-Gates-Passed Golden Banner */}
      {isAllGatesPassed && (
        <div className="bg-gradient-to-r from-yellow-500/90 to-amber-400/90 backdrop-blur-md text-[10px] font-black text-black py-2 px-4 flex items-center justify-center gap-2 z-20 uppercase tracking-[0.2em]">
          <Crown className="w-3.5 h-3.5" />
          BEST · 전 Gate 통과
        </div>
      )}

      {/* 관심종목 추가 시점 대비 등락 배지 */}
      {view === 'WATCHLIST' && stock.watchedPrice && stock.watchedPrice > 0 && (() => {
        const diff = stock.currentPrice - stock.watchedPrice;
        const pct = ((diff / stock.watchedPrice) * 100);
        const isUp = diff >= 0;
        return (
          <div className={cn(
            "flex items-center justify-between px-5 py-3 text-[11px] font-black uppercase tracking-widest",
            isUp ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
          )}>
            <div className="flex items-center gap-2">
              {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              <span>추가 대비</span>
              <span className="text-base font-black">
                {isUp ? '+' : ''}{pct.toFixed(2)}%
              </span>
            </div>
            <div className="flex flex-col items-end text-[9px] opacity-60">
              <span>추가가 ₩{stock.watchedPrice.toLocaleString()}</span>
              <span>{stock.watchedAt}</span>
            </div>
          </div>
        );
      })()}

      {/* Risk Alert Badge */}
      {stock.peakPrice > 0 && Math.round((stock.currentPrice / stock.peakPrice - 1) * 100) <= -30 && (
        <div className="bg-red-500/90 backdrop-blur-md text-[10px] font-black text-white py-2 px-4 flex items-center justify-center gap-2 z-20 animate-pulse uppercase tracking-[0.2em]">
          <AlertTriangle className="w-3.5 h-3.5" />
          Risk Alert: -30% Rule Exceeded
        </div>
      )}

      {/* Mode Badge */}
      {lastUsedMode === 'EARLY_DETECT' && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-blue-500/20 border border-blue-500/30 px-2 py-1 rounded-lg backdrop-blur-sm">
          <Activity className="w-2.5 h-2.5 text-blue-400" />
          <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">선행</span>
        </div>
      )}
      {lastUsedMode === 'MOMENTUM' && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-orange-500/20 border border-orange-500/30 px-2 py-1 rounded-lg backdrop-blur-sm">
          <Zap className="w-2.5 h-2.5 text-orange-400 fill-current" />
          <span className="text-[9px] font-black text-orange-400 uppercase tracking-widest">모멘텀</span>
        </div>
      )}
      {lastUsedMode === 'QUANT_SCREEN' && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-emerald-500/20 border border-emerald-500/30 px-2 py-1 rounded-lg backdrop-blur-sm">
          <Activity className="w-2.5 h-2.5 text-emerald-400" />
          <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">정량발굴</span>
        </div>
      )}

      {/* News Frequency Contrarian Badge */}
      {(() => {
        const nfs = newsFrequencyScores.find(n => n.code === stock.code);
        if (!nfs) return null;
        const phaseColors: Record<string, string> = {
          SILENT: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
          EARLY: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400',
          GROWING: 'bg-amber-500/20 border-amber-500/30 text-amber-400',
          CROWDED: 'bg-orange-500/20 border-orange-500/30 text-orange-400',
          OVERHYPED: 'bg-red-500/20 border-red-500/30 text-red-400',
        };
        const phaseLabels: Record<string, string> = {
          SILENT: '미인지', EARLY: '초기', GROWING: '관심↑', CROWDED: '과밀', OVERHYPED: '과열',
        };
        return (
          <div className={`absolute top-3 right-3 z-10 flex items-center gap-1 border px-2 py-1 rounded-lg backdrop-blur-sm ${phaseColors[nfs.phase] || ''}`}>
            <Newspaper className="w-2.5 h-2.5" />
            <span className="text-[9px] font-black uppercase tracking-widest">
              뉴스 {phaseLabels[nfs.phase] || nfs.phase} ({nfs.score})
            </span>
          </div>
        );
      })()}

      {/* Card Header */}
      <div className="p-5 sm:p-8 pb-4 sm:pb-6 bg-gradient-to-b from-white/[0.03] to-transparent">
        {/* Name and Code Row */}
        <div className="flex flex-col mb-4 sm:mb-6 gap-3 min-w-0">
          <div className="relative p-4 sm:p-6 bg-white/[0.03] border border-white/10 rounded-2xl sm:rounded-xl sm:rounded-2xl overflow-hidden group/name-area shadow-[inset_0_0_20px_rgba(255,255,255,0.02)]">
            <div className="absolute -top-12 -left-12 w-40 h-40 bg-orange-500/5 blur-[80px] rounded-full group-hover/name-area:bg-orange-500/15 transition-all duration-700" />
            <div className="absolute -bottom-12 -right-12 w-40 h-40 bg-blue-500/5 blur-[80px] rounded-full group-hover/name-area:bg-blue-500/15 transition-all duration-700" />

            <div className="relative flex flex-col min-w-0">
              <div className="flex items-start justify-between gap-2 sm:gap-3 min-w-0 mb-2">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
                  <div className="relative group/copy min-w-0">
                    <h4
                      onClick={(e) => { e.stopPropagation(); onCopy(stock.name, stock.code); }}
                      className="text-lg sm:text-2xl lg:text-3xl font-black tracking-tighter text-white group-hover:text-orange-500 transition-all duration-300 leading-tight cursor-pointer flex items-center gap-2 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)] break-keep"
                      title="종목명 복사"
                    >
                      {stock.name}
                      <Copy className="w-4 h-4 opacity-0 group-hover/copy:opacity-50 transition-opacity shrink-0" />
                    </h4>
                    <AnimatePresence>
                      {copiedCode === stock.code && (
                        <motion.span
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="absolute -top-10 left-0 text-[10px] font-black text-green-400 uppercase tracking-widest bg-green-500/20 backdrop-blur-md px-2 py-1 rounded-lg border border-green-500/30 z-30"
                        >
                          Copied!
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <span className="text-[10px] sm:text-[12px] font-black text-white/60 bg-white/10 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl border border-white/20 tracking-[0.15em] uppercase shrink-0 shadow-lg backdrop-blur-sm">
                    {stock.code}
                  </span>
                  {dartAlerts.some(a => a.stock_code.replace(/^A/, '') === stock.code) && (
                    <div
                      className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border bg-amber-500/20 text-amber-400 border-amber-500/30 shadow-lg backdrop-blur-md flex items-center gap-1 shrink-0"
                      title={dartAlerts.filter(a => a.stock_code.replace(/^A/, '') === stock.code).map(a => a.report_nm).join(', ')}
                    >
                      <FileText className="w-3 h-3" />
                      DART
                    </div>
                  )}
                  {stock.gate && (
                    <div className={cn(
                      "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border shadow-lg backdrop-blur-md shrink-0",
                      stock.gate === 1 ? "bg-red-500/20 text-red-400 border-red-500/30" :
                      stock.gate === 2 ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                      "bg-green-500/20 text-green-400 border-green-500/30"
                    )}>
                      Gate {stock.gate}
                    </div>
                  )}
                  {isAllGatesPassed && (
                    <div className="flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border shadow-lg backdrop-blur-md shrink-0 bg-yellow-400/20 text-yellow-400 border-yellow-400/40">
                      <Crown className="w-3 h-3" />
                      BEST
                    </div>
                  )}
                </div>

                {stock.aiConvictionScore && (
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-0.5">Score</span>
                    <span className={cn(
                      "text-lg sm:text-xl font-black tracking-tighter font-num",
                      stock.aiConvictionScore.totalScore >= 80 ? "text-orange-500" :
                      stock.aiConvictionScore.totalScore >= 60 ? "text-blue-400" : "text-white/60"
                    )}>
                      {stock.aiConvictionScore.totalScore}
                    </span>
                  </div>
                )}
              </div>

              {stock.chartPattern && (
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex items-center gap-2 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20 backdrop-blur-md">
                    <TrendingUp className={cn("w-3.5 h-3.5",
                      (stock.chartPattern.type || '').includes('BULLISH') ? "text-green-400" : "text-red-400"
                    )} />
                    <span className="text-[10px] sm:text-[11px] font-black text-blue-400 uppercase tracking-[0.1em]">
                      Pattern: {stock.chartPattern.name}
                    </span>
                  </div>
                </div>
              )}
              {stock.visualReport?.summary && (
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex items-center gap-2 bg-orange-500/10 px-3 py-1 rounded-full border border-orange-500/20 backdrop-blur-md">
                    <Zap className="w-3.5 h-3.5 text-orange-500 animate-pulse" />
                    <span className="text-[10px] sm:text-[11px] font-black text-orange-400 uppercase tracking-[0.1em] break-keep">{stock.visualReport.summary}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeepAnalysis(stock);
            }}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 hover:border-orange-500/50 rounded-xl sm:rounded-2xl text-[10px] sm:text-[11px] font-black text-orange-500 transition-all uppercase tracking-[0.2em] active:scale-[0.98] shadow-[0_0_20px_rgba(249,115,22,0.05)] hover:shadow-[0_0_25px_rgba(249,115,22,0.15)] group/deep"
          >
            <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 group-hover/deep:scale-110 transition-transform" />
            Deep Analysis
          </button>
        </div>

        {/* 3-Gate Visualization Bar (Idea 2) */}
        {stock.aiConvictionScore && (() => {
          const factors = stock.aiConvictionScore.factors || [];
          const total = stock.aiConvictionScore.totalScore;
          // Distribute factors across 3 gates: first ~33%, next ~33%, rest
          const g1Count = Math.max(1, Math.ceil(factors.length / 3));
          const g2Count = Math.max(1, Math.ceil(factors.length / 3));
          const g1 = factors.slice(0, g1Count).reduce((sum, f) => sum + f.score, 0);
          const g2 = factors.slice(g1Count, g1Count + g2Count).reduce((sum, f) => sum + f.score, 0);
          const g3 = factors.slice(g1Count + g2Count).reduce((sum, f) => sum + f.score, 0);
          const g1Max = g1Count * 10;
          const g2Max = g2Count * 10;
          const g3Max = Math.max(1, factors.length - g1Count - g2Count) * 10;
          return (
            <div className="mb-4 sm:mb-6">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-black text-white/30 uppercase tracking-widest">Gate Score</span>
                <span className="text-[11px] font-black text-white/70 font-num">
                  {total}/100
                </span>
              </div>
              <div className="gate-bar">
                <div
                  className="gate-bar-g1 rounded-l-full"
                  style={{ width: `${Math.min(g1 / g1Max * 33.3, 33.3)}%` }}
                  title={`G1: ${g1}/${g1Max}`}
                />
                <div
                  className="gate-bar-g2"
                  style={{ width: `${Math.min(g2 / g2Max * 33.3, 33.3)}%` }}
                  title={`G2: ${g2}/${g2Max}`}
                />
                <div
                  className="gate-bar-g3 rounded-r-full"
                  style={{ width: `${Math.min(g3 / g3Max * 33.4, 33.4)}%` }}
                  title={`G3: ${g3}/${g3Max}`}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[8px] font-black font-num" style={{ color: 'var(--gate-1)' }}>
                  G1 {g1}/{g1Max}
                </span>
                <span className="text-[8px] font-black font-num" style={{ color: 'var(--gate-2)' }}>
                  G2 {g2}/{g2Max}
                </span>
                <span className="text-[8px] font-black font-num" style={{ color: 'var(--gate-3)' }}>
                  G3 {g3}/{g3Max}
                </span>
              </div>
            </div>
          );
        })()}

        {/* Signal and Action Row */}
        <div className="flex justify-between items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="flex flex-wrap gap-2 sm:gap-3 items-center min-w-0">
            {/* Signal Badge (Idea 3: Pulsing Dot + Color Glow) */}
            <SignalBadge signal={stock.type || 'NEUTRAL'} />

            {stock.isLeadingSector && (
              <span className="bg-orange-500 text-white text-[9px] sm:text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest shadow-[0_4px_15px_rgba(249,115,22,0.4)] flex items-center gap-1 sm:gap-1.5 shrink-0 whitespace-nowrap">
                <Star className="w-2.5 h-2.5 sm:w-3 sm:h-3 fill-current" />
                Leading
              </span>
            )}
            {stock.isSectorTopPick && (
              <span className="bg-blue-500 text-white text-[9px] sm:text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest shadow-[0_4px_15px_rgba(59,130,246,0.4)] flex items-center gap-1 sm:gap-1.5 shrink-0 whitespace-nowrap">
                <Award className="w-2.5 h-2.5 sm:w-3 sm:h-3 fill-current" />
                Top Pick
              </span>
            )}
            <span className="text-[9px] sm:text-[10px] font-black text-white/50 bg-white/10 px-2.5 py-1 rounded-full border border-white/10 uppercase tracking-widest backdrop-blur-md truncate max-w-[100px] sm:max-w-none">
              {stock.relatedSectors?.[0] || 'Market'}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onAddToBacktest(stock); }}
              className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border border-white/10 bg-white/5 text-white/30 hover:text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/5 active:scale-90 shadow-sm"
              title="Add to Backtest"
            >
              <History className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleWatchlist(stock); }}
              className={cn(
                "p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border active:scale-90 shadow-sm",
                isWatched(stock.code)
                  ? "bg-orange-500 text-white border-orange-400 shadow-[0_8px_20px_rgba(249,115,22,0.4)]"
                  : "bg-white/5 border-white/10 text-white/30 hover:text-white/70 hover:bg-white/10"
              )}
            >
              <Bookmark className={cn("w-4 h-4 sm:w-4.5 sm:h-4.5", isWatched(stock.code) && "fill-current")} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSetTradeRecord(stock);
              }}
              className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border border-white/10 bg-white/5 text-white/30 hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-emerald-500/5 active:scale-90 shadow-sm"
              title="매수 기록"
            >
              <Plus className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </button>
            {(stock.type === 'STRONG_BUY' || stock.type === 'BUY') && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const totalAssets = kisBalance;
                  const price = stock.currentPrice || stock.entryPrice || 0;
                  // 실제 퀀트 엔진 평가 결과 사용, 없으면 보수적 기본값
                  const ge = stock.gateEvaluation;
                  const positionSize = ge?.positionSize ?? (stock.type === 'STRONG_BUY' ? 20 : 10);
                  const stopLossPct = price > 0 && stock.stopLoss > 0
                    ? ((stock.stopLoss - price) / price) * 100
                    : -8;
                  const rrr = price > 0 && stock.stopLoss > 0 && stock.targetPrice > 0
                    ? (stock.targetPrice - price) / (price - stock.stopLoss)
                    : 2;
                  const signal = {
                    positionSize,
                    rrr: Math.max(0.5, rrr),
                    lastTrigger: stock.type === 'STRONG_BUY',
                    recommendation: ge?.recommendation ?? (stock.type === 'STRONG_BUY' ? '풀 포지션' : '절반 포지션'),
                    profile: { stopLoss: Math.min(-1, stopLossPct) },
                  } as any;
                  const trade = buildShadowTrade(signal, stock.code, stock.name, price, totalAssets);
                  onAddShadowTrade(trade);
                  onSetView('AUTO_TRADE');
                }}
                className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 active:scale-90 shadow-sm"
                title="Shadow Trading 등록"
              >
                <Zap className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
              </button>
            )}
          </div>
        </div>

        {/* External Links & Market Heat */}
        <div className="flex items-center justify-between mb-6 sm:mb-8 py-3 sm:py-4 border-y border-white/5 bg-white/[0.02] rounded-xl sm:rounded-2xl px-3 sm:px-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <Flame className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500 shrink-0" />
              <div className="flex gap-0.5 sm:gap-1 overflow-hidden">
                {[...Array(10)].map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "w-1 sm:w-1.5 h-3 sm:h-4 rounded-full transition-all duration-500 shrink-0",
                      i < stock.hotness ? "bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.6)]" : "bg-white/10"
                    )}
                  />
                ))}
              </div>
              <span className="text-[9px] sm:text-[11px] font-black text-white/40 ml-1 sm:ml-2 tracking-widest uppercase truncate">Heat</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <a
              href={(() => {
                const cleanCode = String(stock.code).replace(/[^0-9]/g, '');
                return cleanCode.length === 6
                  ? `https://finance.naver.com/item/main.naver?code=${cleanCode}`
                  : `https://search.naver.com/search.naver?query=${encodeURIComponent(stock.name + ' 주가 차트')}`;
              })()}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 sm:gap-2.5 px-3 py-1.5 sm:px-4 sm:py-2 bg-white/5 hover:bg-orange-500 hover:text-white border border-white/10 rounded-lg sm:rounded-xl transition-all group/link shadow-sm active:scale-95"
            >
              <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest">Chart</span>
              <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
            </a>
          </div>
        </div>

        {/* Automated Tranche Plan Section */}
        {stock.tranchePlan && (
          <div className="mb-6 sm:mb-8 bg-orange-500/5 p-4 rounded-2xl border border-orange-500/10 shadow-inner">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-orange-500" />
              <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Automated Tranche Plan</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: '1', data: stock.tranchePlan.tranche1 },
                { id: '2', data: stock.tranchePlan.tranche2 },
                { id: '3', data: stock.tranchePlan.tranche3 },
              ].map((t) => (
                <div key={t.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-black text-white/20 uppercase tracking-widest">T{t.id}</span>
                    <span className="text-[9px] font-black text-orange-500/70">{t.data?.size || 0}%</span>
                  </div>
                  <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                    <div className="text-[9px] font-black text-white/60 truncate" title={t.data?.trigger || ''}>
                      {t.data?.trigger ? t.data.trigger.split(' (')[0] : '-'}
                    </div>
                    <div className="text-[7px] font-bold text-white/20 uppercase tracking-tighter truncate">
                      {t.data?.trigger?.includes('(') ? t.data.trigger.split('(')[1].replace(')', '') : 'Trigger'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Technical Health Section */}
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2 mb-6 sm:mb-8">
          <div className={cn(
            "rounded-xl sm:rounded-2xl p-1.5 sm:p-2 border flex flex-col items-center justify-center gap-0.5 sm:gap-1 group/stat transition-all shadow-sm min-w-0 h-14 sm:h-16",
            stock.confidenceScore && stock.confidenceScore >= 90 ? "bg-green-500/10 border-green-500/20" : "bg-white/5 border-white/5"
          )}>
            <span className="text-[6px] sm:text-[7px] font-black text-white/20 uppercase tracking-widest truncate w-full text-center">Conf.</span>
            <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
              <Zap className={cn("w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0", stock.confidenceScore && stock.confidenceScore >= 90 ? "text-green-400 fill-current" : "text-white/20")} />
              <span className={cn("text-[9px] sm:text-[10px] font-black tracking-tighter truncate", stock.confidenceScore && stock.confidenceScore >= 90 ? "text-green-400" : "text-white/70")}>
                {stock.confidenceScore}%
              </span>
            </div>
          </div>
          <div className={cn(
            "rounded-xl sm:rounded-2xl p-1.5 sm:p-2 border flex flex-col items-center justify-center gap-0.5 sm:gap-1 group/stat transition-all shadow-sm min-w-0 h-14 sm:h-16",
            stock.momentumRank && stock.momentumRank <= 5 ? "bg-red-500/10 border-red-500/20" : "bg-white/5 border-white/5"
          )}>
            <span className="text-[6px] sm:text-[7px] font-black text-white/20 uppercase tracking-widest truncate w-full text-center">Mom.</span>
            <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
              <TrendingUp className={cn("w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0", stock.momentumRank && stock.momentumRank <= 5 ? "text-red-400" : "text-white/20")} />
              <span className={cn("text-[9px] sm:text-[10px] font-black tracking-tighter truncate", stock.momentumRank && stock.momentumRank <= 5 ? "text-red-400" : "text-white/70")}>
                {stock.momentumRank}%
              </span>
            </div>
          </div>
          <div className={cn(
            "rounded-xl sm:rounded-2xl p-1.5 sm:p-2 border flex flex-col items-center justify-center gap-0.5 sm:gap-1 group/stat transition-all shadow-sm min-w-0 h-14 sm:h-16",
            stock.ichimokuStatus === 'ABOVE_CLOUD' ? "bg-blue-500/10 border-blue-500/20" : "bg-white/5 border-white/5"
          )}>
            <span className="text-[6px] sm:text-[7px] font-black text-white/20 uppercase tracking-widest truncate w-full text-center">Ichi.</span>
            <div className="flex items-center justify-center gap-0.5 sm:gap-1 min-w-0 w-full">
              <Cloud className={cn("w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0", stock.ichimokuStatus === 'ABOVE_CLOUD' ? "text-blue-400" : "text-white/20")} />
              <span className={cn("text-[7px] sm:text-[8px] font-black text-center tracking-tight leading-tight truncate", stock.ichimokuStatus === 'ABOVE_CLOUD' ? "text-blue-400" : "text-white/70")}>
                {stock.ichimokuStatus?.split('_')[0] || 'N/A'}
              </span>
            </div>
          </div>
          <div className={cn(
            "rounded-xl sm:rounded-2xl p-1.5 sm:p-2 border flex flex-col items-center justify-center gap-0.5 sm:gap-1 group/stat transition-all shadow-sm min-w-0 h-14 sm:h-16",
            stock.isLeadingSector ? "bg-orange-500/10 border-orange-500/20" : "bg-white/5 border-white/5"
          )}>
            <span className="text-[6px] sm:text-[7px] font-black text-white/20 uppercase tracking-widest truncate w-full text-center">Sector</span>
            <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
              <Crown className={cn("w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0", stock.isLeadingSector ? "text-orange-400" : "text-white/20")} />
              <span className={cn("text-[9px] sm:text-[10px] font-black tracking-tighter truncate", stock.isLeadingSector ? "text-orange-400" : "text-white/70")}>
                {stock.isLeadingSector ? 'LEAD' : 'MAIN'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Price Strategy Section */}
      <div className="bg-white/[0.03] border-y border-white/10 p-5 sm:p-8 py-5 sm:py-7 relative">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-5 gap-3">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-orange-500 rounded-full" />
            <span className="text-[10px] sm:text-[11px] font-black text-white/30 uppercase tracking-[0.2em] sm:tracking-[0.25em]">Price Strategy</span>
          </div>
          <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 sm:gap-1">
            {(() => {
              // 장중이면 LIVE(주황) · 장외면 CLOSED(파랑) — 가격이 stale 캐시일 때
              // "LIVE" 라벨을 그대로 띄워 사용자에게 잘못된 신뢰를 주는 문제 해소.
              // PR-31 (PR-25 후속): 자동매매 quota 와 무관하게 사용자 카드 시각 표기 정합성.
              const open = isMarketOpenFor(stock.code);
              let nextOpenLabel = '';
              try { nextOpenLabel = formatNextOpenKst(nextOpenAtFor(stock.code)); } catch { /* noop */ }
              return (
                <div
                  className={cn(
                    "flex items-center gap-2 sm:gap-2.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg sm:rounded-xl border shadow-[0_0_15px_rgba(249,115,22,0.1)] transition-all",
                    open
                      ? "bg-orange-500/10 border-orange-500/20 group-hover:bg-orange-500/20"
                      : "bg-blue-500/10 border-blue-500/20 group-hover:bg-blue-500/15"
                  )}
                  title={open ? '장중 실시간' : `장외 — 다음 개장 ${nextOpenLabel}`}
                >
                  <div className="flex items-center gap-1.5 mr-1">
                    {open ? (
                      <>
                        <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-orange-500 animate-pulse shadow-[0_0_8px_rgba(249,115,22,0.8)]" />
                        <span className="text-[7px] sm:text-[8px] font-black text-orange-500 uppercase tracking-widest">LIVE</span>
                      </>
                    ) : (
                      <>
                        <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-blue-400/80" />
                        <span className="text-[7px] sm:text-[8px] font-black text-blue-300 uppercase tracking-widest">장외</span>
                      </>
                    )}
                  </div>
                  <PriceEditCell
                    stockCode={stock.code}
                    currentPrice={stock.currentPrice}
                    syncingStock={syncingStock}
                    onManualUpdate={(newPrice) => onManualPriceUpdate(stock, newPrice)}
                    onSync={() => onSyncPrice(stock)}
                  />
                </div>
              );
            })()}
            <div className="flex items-center gap-2 mt-1">
              {stock.priceUpdatedAt && (
                <span className="text-[7px] sm:text-[8px] font-black text-white/20 uppercase tracking-widest flex items-center gap-1">
                  <Clock className="w-2 h-2" />
                  {stock.priceUpdatedAt}
                </span>
              )}
              {stock.financialUpdatedAt && (
                <span className="text-[7px] sm:text-[8px] font-black text-blue-400/40 uppercase tracking-widest flex items-center gap-1">
                  <ShieldCheck className="w-2 h-2" />
                  DART: {stock.financialUpdatedAt}
                </span>
              )}
              {stock.dataSourceType === 'REALTIME' ? (
                <span className="text-[7px] font-black text-green-500/50 uppercase tracking-[0.1em] flex items-center gap-1">
                  <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
                  Verified Real-time
                </span>
              ) : (
                <span className="text-[7px] font-black text-orange-500/50 uppercase tracking-[0.1em] flex items-center gap-1">
                  <div className="w-1 h-1 bg-orange-500 rounded-full" />
                  AI Estimated
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <div className="bg-blue-500/5 rounded-2xl sm:rounded-3xl p-3 sm:p-5 border border-blue-500/10 flex flex-col items-center justify-center gap-1.5 sm:gap-2 group/price hover:bg-blue-500/10 transition-all shadow-sm min-w-0">
            <span className="text-[7px] sm:text-[9px] font-black text-blue-400/50 uppercase tracking-widest truncate w-full text-center">Entry</span>
            <div className="flex flex-col items-center min-w-0">
              <div className="flex items-baseline gap-0.5 sm:gap-1 min-w-0">
                <span className="text-[8px] sm:text-[10px] font-black text-blue-400/30 uppercase shrink-0">1st</span>
                <span className="text-xs sm:text-base font-black text-white tracking-tighter truncate font-num">
                  {stock.entryPrice && stock.entryPrice > 0
                    ? `₩${stock.entryPrice?.toLocaleString() || '0'}`
                    : stock.currentPrice > 0
                      ? `₩${stock.currentPrice?.toLocaleString() || '0'}*`
                      : '-'}
                </span>
              </div>
              {stock.entryPrice2 && stock.entryPrice2 > 0 && (
                <div className="flex items-baseline gap-1 opacity-60">
                  <span className="text-[7px] sm:text-[9px] font-black text-blue-400/30 uppercase shrink-0">2nd</span>
                  <span className="text-[10px] sm:text-sm font-black text-white/60 tracking-tighter truncate">₩{stock.entryPrice2?.toLocaleString() || '0'}</span>
                </div>
              )}
            </div>
          </div>
          <div className="bg-green-500/5 rounded-2xl sm:rounded-3xl p-3 sm:p-5 border border-green-500/10 flex flex-col items-center justify-center gap-1.5 sm:gap-2 group/price hover:bg-green-500/10 transition-all shadow-sm min-w-0">
            <span className="text-[7px] sm:text-[9px] font-black text-green-400/50 uppercase tracking-widest truncate w-full text-center">Target</span>
            <div className="flex flex-col items-center min-w-0">
              <div className="flex items-baseline gap-0.5 sm:gap-1 min-w-0">
                <span className="text-[8px] sm:text-[10px] font-black text-green-400/30 uppercase shrink-0">1st</span>
                <span className="text-xs sm:text-base font-black text-green-400 tracking-tighter truncate font-num">
                  {stock.targetPrice && stock.targetPrice > 0
                    ? `₩${stock.targetPrice.toLocaleString()}`
                    : stock.currentPrice > 0
                      ? `₩${Math.round(stock.currentPrice * 1.20).toLocaleString()}*`
                      : '-'}
                </span>
              </div>
              {stock.targetPrice2 && stock.targetPrice2 > 0 && (
                <div className="flex items-baseline gap-1 opacity-60">
                  <span className="text-[7px] sm:text-[9px] font-black text-green-400/30 uppercase shrink-0">2nd</span>
                  <span className="text-[10px] sm:text-sm font-black text-green-400/60 tracking-tighter truncate">₩{stock.targetPrice2.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
          <div className="bg-red-500/5 rounded-2xl sm:rounded-3xl p-3 sm:p-5 border border-red-500/10 flex flex-col items-center justify-center gap-1 sm:gap-1.5 group/price hover:bg-red-500/10 transition-all shadow-sm min-w-0">
            <span className="text-[7px] sm:text-[9px] font-black text-red-400/50 uppercase tracking-widest truncate w-full text-center">Stop</span>
            <span className="text-xs sm:text-base font-black text-red-400 tracking-tighter truncate font-num">
              {stock.stopLoss && stock.stopLoss > 0
                ? `₩${stock.stopLoss.toLocaleString()}`
                : stock.currentPrice > 0
                  ? `₩${Math.round(stock.currentPrice * 0.93).toLocaleString()}*`
                  : '-'}
            </span>
          </div>
        </div>
      </div>

      {/* Footer Section */}
      <div className="p-5 sm:p-8 pt-5 sm:pt-7 flex-1 flex flex-col justify-between">
        <div className="space-y-6 sm:space-y-8">
          {/* Economic Moat */}
          <div className="flex items-start gap-4 sm:gap-5 group/moat">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 shadow-sm group-hover/moat:bg-blue-500/20 transition-all">
              <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[9px] sm:text-[10px] font-black text-white/20 uppercase tracking-[0.15em] sm:tracking-[0.2em] block mb-1.5 sm:mb-2">Economic Moat</span>
              <div className="space-y-1.5 sm:space-y-2">
                <span className={cn(
                  "text-[9px] sm:text-[10px] font-black px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-lg sm:rounded-xl shadow-sm inline-block",
                  stock.economicMoat?.type !== 'NONE' ? "bg-blue-500 text-white" : "bg-white/10 text-white/40"
                )}>
                  {stock.economicMoat?.type || 'NONE'}
                </span>
                <p className="text-[11px] sm:text-[12px] text-white/50 font-bold italic leading-relaxed break-words">
                  {stock.economicMoat?.description}
                </p>
              </div>
            </div>
          </div>

          {/* Catalyst Analysis */}
          <div className="flex items-start gap-4 sm:gap-5 group/catalyst">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0 shadow-sm group-hover/catalyst:bg-yellow-500/20 transition-all">
              <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-400" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[9px] sm:text-[10px] font-black text-white/20 uppercase tracking-[0.15em] sm:tracking-[0.2em] block mb-1.5 sm:mb-2">Catalyst Analysis</span>
              <div className="space-y-1.5 sm:space-y-2">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-[9px] sm:text-[10px] font-black px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-lg sm:rounded-xl shadow-sm inline-block",
                    stock.checklist?.catalystAnalysis ? "bg-yellow-500 text-black" : "bg-white/10 text-white/40"
                  )}>
                    {stock.checklist?.catalystAnalysis ? 'PASSED' : 'PENDING'}
                  </span>
                  {stock.catalystSummary && (
                    <span className="text-[10px] sm:text-[11px] font-black text-yellow-400/80 truncate">
                      {stock.catalystSummary}
                    </span>
                  )}
                </div>
                <p className="text-[11px] sm:text-[12px] text-white/50 font-bold italic leading-relaxed break-words">
                  {stock.catalystDetail?.description || '발굴된 촉매제가 없습니다.'}
                </p>
              </div>
            </div>
          </div>

          {/* Valuation */}
          <div className="flex items-start gap-4 sm:gap-5 group/val">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0 shadow-sm group-hover/val:bg-orange-500/20 transition-all">
              <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-orange-400" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[9px] sm:text-[10px] font-black text-white/20 uppercase tracking-[0.15em] sm:tracking-[0.2em] block mb-1.5 sm:mb-2">Valuation Matrix</span>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <div className="bg-white/5 p-2 sm:p-2.5 rounded-lg sm:rounded-xl border border-white/5 shadow-inner min-w-0">
                  <span className="text-[7px] sm:text-[9px] font-black text-white/10 uppercase block mb-0.5 sm:mb-1 tracking-tighter truncate">P/E</span>
                  <span className="text-xs sm:text-sm font-black text-white/80 truncate block font-num">
                    {stock.valuation?.per && stock.valuation.per > 0 ? `${stock.valuation.per.toFixed(1)}x` : 'N/A'}
                  </span>
                </div>
                <div className="bg-white/5 p-2 sm:p-2.5 rounded-lg sm:rounded-xl border border-white/5 shadow-inner min-w-0">
                  <span className="text-[7px] sm:text-[9px] font-black text-white/10 uppercase block mb-0.5 sm:mb-1 tracking-tighter truncate">P/B</span>
                  <span className="text-xs sm:text-sm font-black text-white/80 truncate block font-num">
                    {stock.valuation?.pbr && stock.valuation.pbr > 0 ? `${stock.valuation.pbr.toFixed(2)}x` : 'N/A'}
                  </span>
                </div>
                <div className="bg-white/5 p-2 sm:p-2.5 rounded-lg sm:rounded-xl border border-white/5 shadow-inner min-w-0">
                  <span className="text-[7px] sm:text-[9px] font-black text-white/10 uppercase block mb-0.5 sm:mb-1 tracking-tighter truncate">EPS</span>
                  <span className={cn(
                    "text-xs sm:text-sm font-black truncate block font-num",
                    (stock.valuation?.epsGrowth ?? 0) > 0 ? "text-green-400" :
                    (stock.valuation?.epsGrowth ?? 0) < 0 ? "text-red-400" : "text-white/50"
                  )}>
                    {(stock.valuation?.epsGrowth ?? 0) > 0 ? '+' : ''}{stock.valuation?.epsGrowth ?? 0}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Latest News Section */}
          {stock.latestNews && stock.latestNews.length > 0 && (
            <div className="flex items-start gap-4 sm:gap-5 group/news">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0 shadow-sm group-hover/news:bg-orange-500/20 transition-all">
                <Newspaper className="w-5 h-5 sm:w-6 sm:h-6 text-orange-400" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[9px] sm:text-[10px] font-black text-white/20 uppercase tracking-[0.15em] sm:tracking-[0.2em] block mb-1.5 sm:mb-2">Latest News</span>
                <div className="space-y-2">
                  {(stock.latestNews || []).slice(0, 5).map((news, i) => (
                    <a
                      key={i}
                      href={`https://www.google.com/search?q=${encodeURIComponent((news.headline || '') + ' ' + (stock.name || ''))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex flex-col gap-1 p-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl transition-all group/news-item cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] sm:text-[12px] font-bold text-white/80 group-hover/news-item:text-orange-400 transition-colors line-clamp-2 leading-tight">
                          {news.headline}
                        </span>
                        <ExternalLink className="w-3 h-3 text-white/20 shrink-0" />
                      </div>
                      <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">{news.date}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
