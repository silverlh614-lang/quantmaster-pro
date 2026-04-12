/**
 * Idea 7: Desktop → slide-in detail panel (list context preserved)
 *         Mobile  → bottom-up modal (full screen)
 */
import React, { useEffect, useState } from 'react';
import {
  X, TrendingUp, TrendingDown, Target, ShieldCheck, Zap, Brain, BarChart3,
  Newspaper, Activity, ArrowUpRight, ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StockRecommendation } from '../services/stockService';
import { SignalBadge } from '../ui/badge';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { debugWarn } from '../utils/debug';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface StockDetailModalProps {
  stock: StockRecommendation | null;
  onClose: () => void;
}

export const StockDetailModal: React.FC<StockDetailModalProps> = ({ stock, onClose }) => {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!stock) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [stock, onClose]);

  if (!stock) {
    debugWarn('StockDetailModal: stock is null - will not render');
    return null;
  }

  const content = (
    <>
      {/* Header */}
      <div className="p-5 sm:p-6 border-b border-theme-border flex items-start justify-between gap-4 bg-gradient-to-b from-[var(--bg-surface)] to-transparent sticky top-0 z-10 backdrop-blur-xl">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h2 className="text-xl sm:text-2xl font-black text-theme-text tracking-tighter">{stock.name}</h2>
            <span className="text-[11px] font-num text-theme-text-muted bg-theme-surface px-2 py-0.5 rounded-lg border border-theme-border">{stock.code}</span>
            <SignalBadge signal={stock.type || 'NEUTRAL'} />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-2xl font-black text-theme-text font-num">{'\u20A9'}{stock.currentPrice?.toLocaleString()}</span>
            {stock.isLeadingSector && (
              <span className="text-[9px] font-black bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-md border border-amber-500/20 uppercase tracking-widest">
                Leading
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl bg-theme-surface hover:bg-white/10 text-theme-text-muted hover:text-theme-text transition-all border border-transparent hover:border-theme-border shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
        {/* 3-Gate Bar */}
        {stock.aiConvictionScore && (() => {
          const factors = stock.aiConvictionScore.factors || [];
          const total = stock.aiConvictionScore.totalScore;
          const g1Count = Math.max(1, Math.ceil(factors.length / 3));
          const g2Count = Math.max(1, Math.ceil(factors.length / 3));
          const g1 = factors.slice(0, g1Count).reduce((sum: number, f: { score: number }) => sum + f.score, 0);
          const g2 = factors.slice(g1Count, g1Count + g2Count).reduce((sum: number, f: { score: number }) => sum + f.score, 0);
          const g3 = factors.slice(g1Count + g2Count).reduce((sum: number, f: { score: number }) => sum + f.score, 0);
          const g1Max = g1Count * 10;
          const g2Max = g2Count * 10;
          const g3Max = Math.max(1, factors.length - g1Count - g2Count) * 10;
          return (
            <div className="glass-3d rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest">Gate Score</span>
                <span className="text-sm font-black text-theme-text font-num">{total}/100</span>
              </div>
              <div className="gate-bar h-3">
                <div className="gate-bar-g1 rounded-l-full" style={{ width: `${Math.min(g1 / g1Max * 33.3, 33.3)}%` }} />
                <div className="gate-bar-g2" style={{ width: `${Math.min(g2 / g2Max * 33.3, 33.3)}%` }} />
                <div className="gate-bar-g3 rounded-r-full" style={{ width: `${Math.min(g3 / g3Max * 33.4, 33.4)}%` }} />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-[9px] font-black font-num" style={{ color: 'var(--gate-1)' }}>G1 {g1}/{g1Max}</span>
                <span className="text-[9px] font-black font-num" style={{ color: 'var(--gate-2)' }}>G2 {g2}/{g2Max}</span>
                <span className="text-[9px] font-black font-num" style={{ color: 'var(--gate-3)' }}>G3 {g3}/{g3Max}</span>
              </div>
            </div>
          );
        })()}

        {/* AI Analysis */}
        <div className="glass-3d rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-black text-theme-text uppercase tracking-tight">AI 분석</h3>
          </div>
          <p className="text-sm text-theme-text-secondary leading-relaxed whitespace-pre-wrap">{stock.reason}</p>
        </div>

        {/* Price Strategy */}
        <div className="grid grid-cols-3 gap-3">
          <div className="glass-3d rounded-xl p-4 border-blue-500/20 text-center">
            <span className="text-[9px] font-black text-blue-400/60 uppercase tracking-widest block mb-1">Entry</span>
            <span className="text-sm font-black text-theme-text font-num">
              {'\u20A9'}{stock.entryPrice?.toLocaleString() || stock.currentPrice?.toLocaleString() || '-'}
            </span>
          </div>
          <div className="glass-3d rounded-xl p-4 border-green-500/20 text-center">
            <span className="text-[9px] font-black text-green-400/60 uppercase tracking-widest block mb-1">Target</span>
            <span className="text-sm font-black text-green-400 font-num">{'\u20A9'}{stock.targetPrice?.toLocaleString() || '-'}</span>
          </div>
          <div className="glass-3d rounded-xl p-4 border-red-500/20 text-center">
            <span className="text-[9px] font-black text-red-400/60 uppercase tracking-widest block mb-1">Stop</span>
            <span className="text-sm font-black text-red-400 font-num">{'\u20A9'}{stock.stopLoss?.toLocaleString() || '-'}</span>
          </div>
        </div>

        {/* Checklist Summary */}
        {stock.checklist && (
          <div className="glass-3d rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="w-4 h-4 text-green-400" />
              <h4 className="text-sm font-black text-theme-text uppercase tracking-tight">검증 현황</h4>
              <span className="ml-auto text-sm font-black text-green-400 font-num">
                {Math.round((Object.values(stock.checklist).filter(Boolean).length / 27) * 100)}%
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden bg-white/5">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-700"
                style={{ width: `${(Object.values(stock.checklist).filter(Boolean).length / 27) * 100}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <div className="text-center">
                <span className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">Gate 1</span>
                <span className="text-[10px] font-black text-green-400">PASS</span>
              </div>
              <div className="text-center">
                <span className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">Gate 2</span>
                <span className="text-[10px] font-black text-green-400">PASS</span>
              </div>
              <div className="text-center">
                <span className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">Gate 3</span>
                <span className="text-[10px] font-black text-blue-400">IN PROGRESS</span>
              </div>
            </div>
          </div>
        )}

        {/* Fundamentals */}
        <div className="glass-3d rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-blue-400" />
            <h4 className="text-sm font-black text-theme-text uppercase tracking-tight">펀더멘털</h4>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border border-theme-border" style={{ background: 'var(--bg-surface)' }}>
              <span className="text-[9px] text-theme-text-muted font-black uppercase block mb-1">PER</span>
              <span className="text-sm font-black text-theme-text font-num">{stock.valuation?.per || 'N/A'}x</span>
            </div>
            <div className="p-3 rounded-lg border border-theme-border" style={{ background: 'var(--bg-surface)' }}>
              <span className="text-[9px] text-theme-text-muted font-black uppercase block mb-1">PBR</span>
              <span className="text-sm font-black text-theme-text font-num">{stock.valuation?.pbr || 'N/A'}x</span>
            </div>
            <div className="p-3 rounded-lg border border-theme-border" style={{ background: 'var(--bg-surface)' }}>
              <span className="text-[9px] text-theme-text-muted font-black uppercase block mb-1">부채비율</span>
              <span className="text-sm font-black text-theme-text font-num">{stock.valuation?.debtRatio || 'N/A'}%</span>
            </div>
            <div className="p-3 rounded-lg border border-theme-border" style={{ background: 'var(--bg-surface)' }}>
              <span className="text-[9px] text-theme-text-muted font-black uppercase block mb-1">시가총액</span>
              <span className="text-sm font-black text-theme-text font-num">{stock.marketCap ? `${(stock.marketCap / 10000).toFixed(1)}조` : 'N/A'}</span>
            </div>
          </div>
        </div>

        {/* News */}
        {stock.latestNews && stock.latestNews.length > 0 && (
          <div className="glass-3d rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Newspaper className="w-4 h-4 text-orange-400" />
              <h4 className="text-sm font-black text-theme-text uppercase tracking-tight">최신 뉴스</h4>
            </div>
            <div className="space-y-2">
              {stock.latestNews.slice(0, 5).map((news, i) => (
                <a
                  key={i}
                  href={`https://www.google.com/search?q=${encodeURIComponent((news.headline || '') + ' ' + stock.name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 p-3 rounded-lg border border-theme-border hover:bg-theme-surface transition-all group/news"
                  style={{ background: 'var(--bg-surface)' }}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-theme-text-secondary group-hover/news:text-orange-400 transition-colors line-clamp-2 leading-snug">
                      {news.headline}
                    </span>
                    <span className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block mt-1">{news.date}</span>
                  </div>
                  <ExternalLink className="w-3 h-3 text-theme-text-muted shrink-0 mt-0.5" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-5 border-t border-theme-border flex items-center gap-3 shrink-0" style={{ background: 'var(--bg-elevated)' }}>
        <button
          onClick={onClose}
          className="flex-1 py-3 bg-theme-surface hover:bg-white/10 text-theme-text-secondary font-black rounded-xl border border-theme-border transition-all active:scale-95 text-sm"
        >
          닫기
        </button>
        <a
          href={(() => {
            const cleanCode = String(stock.code).replace(/[^0-9]/g, '');
            return cleanCode.length === 6
              ? `https://finance.naver.com/item/main.naver?code=${cleanCode}`
              : `https://search.naver.com/search.naver?query=${encodeURIComponent(stock.name + ' 주가')}`;
          })()}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 text-white font-black rounded-xl shadow-[0_8px_20px_rgba(249,115,22,0.3)] transition-all active:scale-95 text-sm text-center flex items-center justify-center gap-2"
        >
          <ArrowUpRight className="w-4 h-4" />
          네이버 차트
        </a>
      </div>
    </>
  );

  return (
    <AnimatePresence>
      {stock && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className={cn(
              'fixed inset-0 z-[94]',
              isDesktop ? 'bg-black/40' : 'bg-black/70 backdrop-blur-sm'
            )}
          />

          {isDesktop ? (
            /* Desktop: Slide-in Panel from Right (Idea 7) */
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 z-[95] flex flex-col"
              style={{
                width: 'min(520px, calc(100vw - var(--sidebar-width)))',
                background: 'var(--bg-elevated)',
                borderLeft: '1px solid var(--card-border)',
                boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
              }}
            >
              {content}
            </motion.div>
          ) : (
            /* Mobile: Full-screen Modal */
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed inset-0 z-[95] flex flex-col"
              style={{ background: 'var(--bg-app)' }}
            >
              {content}
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  );
};
