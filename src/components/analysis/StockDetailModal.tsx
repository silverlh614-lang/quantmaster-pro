// @responsibility analysis StockDetailModal component
/**
 * Idea 7: Desktop slide-in detail panel (list context preserved)
 *         Mobile bottom-up modal (full screen)
 */
import React, { useEffect, useState } from 'react';
import {
  X, Target, ShieldCheck, Brain, BarChart3,
  Newspaper, ArrowUpRight, ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StockRecommendation } from '../../services/stockService';
import { SignalBadge } from '../../ui/badge';
import { cn } from '../../ui/cn';
import { debugWarn } from '../../utils/debug';
import { GateStatusWidget } from './GateStatusWidget';
import { TranchePlanCard } from './TranchePlanCard';
import { PriceDisplay } from '../common/PriceDisplay';

interface StockDetailModalProps {
  stock: StockRecommendation | null;
  onClose: () => void;
}

type ConvictionSegment = {
  label: string;
  score: number;
  max: number;
  width: number;
  className: string;
  rounded: string;
};

function useDesktopBreakpoint(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isDesktop;
}

function useEscapeClose(enabled: boolean, onClose: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, onClose]);
}

function formatWon(value?: number): string {
  return value && value > 0 ? `₩${value.toLocaleString()}` : '-';
}

function fallbackPrice(value: number | undefined, multiplier: number): string {
  return value && value > 0 ? `₩${Math.round(value * multiplier).toLocaleString()}*` : '-';
}

function naverFinanceUrl(stock: StockRecommendation): string {
  const cleanCode = String(stock.code).replace(/[^0-9]/g, '');
  return cleanCode.length === 6
    ? `https://finance.naver.com/item/main.naver?code=${cleanCode}`
    : `https://search.naver.com/search.naver?query=${encodeURIComponent(stock.name + ' 주가')}`;
}

function checklistProgress(checklist: StockRecommendation['checklist']): number {
  return Object.values(checklist).filter(Boolean).length;
}

function ModalHeader({
  stock,
  onClose,
}: {
  stock: StockRecommendation;
  onClose: () => void;
}) {
  return (
    <div className="p-5 sm:p-6 border-b border-theme-border flex items-start justify-between gap-4 bg-gradient-to-b from-[var(--bg-surface)] to-transparent sticky top-0 z-10 backdrop-blur-xl">
      <div className="min-w-0">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h2 className="text-xl sm:text-2xl font-black text-theme-text tracking-tighter">{stock.name}</h2>
          <span className="text-[11px] font-num text-theme-text-muted bg-theme-surface px-2 py-0.5 rounded-lg border border-theme-border">{stock.code}</span>
          <SignalBadge signal={stock.type || 'NEUTRAL'} />
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {/* 가격 정본 SSOT — usePriceCanon hook 단일 통로. */}
          <PriceDisplay
            code={stock.code}
            variant="detail"
            showBadge={false}
            showTrendIcon={false}
            fallbackKisPrice={stock.dataSourceType === 'REALTIME' ? stock.currentPrice : null}
          />
          {stock.isLeadingSector && <LeadingBadge />}
        </div>
      </div>
      <button
        onClick={onClose}
        className="p-2 rounded-xl bg-theme-surface hover:bg-white/10 text-theme-text-muted hover:text-theme-text transition-all border border-transparent hover:border-theme-border shrink-0"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

function LeadingBadge() {
  return (
    <span className="text-[9px] font-black bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-md border border-amber-500/20 uppercase tracking-widest">
      Leading
    </span>
  );
}

function buildConvictionSegments(stock: StockRecommendation): ConvictionSegment[] {
  const factors = stock.aiConvictionScore?.factors || [];
  const firstCount = Math.max(1, Math.ceil(factors.length / 3));
  const secondCount = Math.max(1, Math.ceil(factors.length / 3));
  const thirdCount = Math.max(1, factors.length - firstCount - secondCount);
  const first = factors.slice(0, firstCount).reduce((sum, f) => sum + f.score, 0);
  const second = factors.slice(firstCount, firstCount + secondCount).reduce((sum, f) => sum + f.score, 0);
  const third = factors.slice(firstCount + secondCount).reduce((sum, f) => sum + f.score, 0);

  return [
    { label: 'G1', score: first, max: firstCount * 10, width: 33.3, className: 'gate-bar-g1', rounded: 'rounded-l-full' },
    { label: 'G2', score: second, max: secondCount * 10, width: 33.3, className: 'gate-bar-g2', rounded: '' },
    { label: 'G3', score: third, max: thirdCount * 10, width: 33.4, className: 'gate-bar-g3', rounded: 'rounded-r-full' },
  ];
}

function AiConvictionCard({ stock }: { stock: StockRecommendation }) {
  if (!stock.aiConvictionScore) return null;

  const segments = buildConvictionSegments(stock);
  return (
    <div className="glass-3d rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest">AI Conviction</span>
        <span className="text-sm font-black text-theme-text font-num">{stock.aiConvictionScore.totalScore}/100</span>
      </div>
      <div className="text-[10px] text-orange-300/60 mb-2">
        Gemini conviction score is diagnostic and is not an auto-trading entry rule.
      </div>
      <div className="gate-bar h-3">
        {segments.map(segment => (
          <div
            key={segment.label}
            className={cn(segment.className, segment.rounded)}
            style={{ width: `${Math.min((segment.score / segment.max) * segment.width, segment.width)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1.5">
        {segments.map((segment, idx) => (
          <span key={segment.label} className="text-[9px] font-black font-num" style={{ color: `var(--gate-${idx + 1})` }}>
            {segment.label} {segment.score}/{segment.max}
          </span>
        ))}
      </div>
    </div>
  );
}

function AiAnalysisCard({ stock }: { stock: StockRecommendation }) {
  return (
    <div className="glass-3d rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-black text-theme-text uppercase tracking-tight">AI Analysis</h3>
      </div>
      <p className="text-sm text-theme-text-secondary leading-relaxed whitespace-pre-wrap">{stock.reason}</p>
    </div>
  );
}

function PriceStrategyGrid({ stock }: { stock: StockRecommendation }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <PriceBox tone="blue" label="Entry" value={formatWon(stock.entryPrice) !== '-' ? formatWon(stock.entryPrice) : fallbackPrice(stock.currentPrice, 1)} />
      <PriceBox tone="green" label="Target" value={formatWon(stock.targetPrice) !== '-' ? formatWon(stock.targetPrice) : fallbackPrice(stock.currentPrice, 1.2)} />
      <PriceBox tone="red" label="Stop" value={formatWon(stock.stopLoss) !== '-' ? formatWon(stock.stopLoss) : fallbackPrice(stock.currentPrice, 0.93)} />
    </div>
  );
}

function PriceBox({
  tone,
  label,
  value,
}: {
  tone: 'blue' | 'green' | 'red';
  label: string;
  value: string;
}) {
  const toneClass = {
    blue: 'border-blue-500/20 text-blue-400/60 text-theme-text',
    green: 'border-green-500/20 text-green-400/60 text-green-400',
    red: 'border-red-500/20 text-red-400/60 text-red-400',
  }[tone];
  const [borderClass, labelClass, valueClass] = toneClass.split(' ');
  return (
    <div className={cn('glass-3d rounded-xl p-4 text-center', borderClass)}>
      <span className={cn('text-[9px] font-black uppercase tracking-widest block mb-1', labelClass)}>{label}</span>
      <span className={cn('text-sm font-black font-num', valueClass)}>{value}</span>
    </div>
  );
}

function ChecklistSummary({ stock }: { stock: StockRecommendation }) {
  if (!stock.checklist) return null;

  const passed = checklistProgress(stock.checklist);
  const pct = (passed / 27) * 100;
  return (
    <div className="glass-3d rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-green-400" />
        <h4 className="text-sm font-black text-theme-text uppercase tracking-tight">Checklist Progress</h4>
        <span className="ml-auto text-sm font-black text-green-400 font-num">{Math.round(pct)}%</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden bg-white/5">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <GateMiniStatus label="Gate 1" value="PASS" className="text-green-400" />
        <GateMiniStatus label="Gate 2" value="PASS" className="text-green-400" />
        <GateMiniStatus label="Gate 3" value="IN PROGRESS" className="text-blue-400" />
      </div>
    </div>
  );
}

function GateMiniStatus({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <div className="text-center">
      <span className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">{label}</span>
      <span className={cn('text-[10px] font-black', className)}>{value}</span>
    </div>
  );
}

function FundamentalsCard({ stock }: { stock: StockRecommendation }) {
  return (
    <div className="glass-3d rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-blue-400" />
        <h4 className="text-sm font-black text-theme-text uppercase tracking-tight">Fundamentals</h4>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FundamentalMetric label="PER" value={stock.valuation?.per && stock.valuation.per > 0 ? `${stock.valuation.per.toFixed(1)}x` : 'N/A'} />
        <FundamentalMetric label="PBR" value={stock.valuation?.pbr && stock.valuation.pbr > 0 ? `${stock.valuation.pbr.toFixed(2)}x` : 'N/A'} />
        <FundamentalMetric label="Debt Ratio" value={stock.valuation?.debtRatio && stock.valuation.debtRatio > 0 ? `${stock.valuation.debtRatio.toFixed(1)}%` : 'N/A'} />
        <FundamentalMetric label="Market Cap" value={stock.marketCap ? `${(stock.marketCap / 10000).toFixed(1)}T KRW` : 'N/A'} />
      </div>
    </div>
  );
}

function FundamentalMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg border border-theme-border" style={{ background: 'var(--bg-surface)' }}>
      <span className="text-[9px] text-theme-text-muted font-black uppercase block mb-1">{label}</span>
      <span className="text-sm font-black text-theme-text font-num">{value}</span>
    </div>
  );
}

function NewsCard({ stock }: { stock: StockRecommendation }) {
  if (!stock.latestNews || stock.latestNews.length === 0) return null;

  return (
    <div className="glass-3d rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Newspaper className="w-4 h-4 text-orange-400" />
        <h4 className="text-sm font-black text-theme-text uppercase tracking-tight">Latest News</h4>
      </div>
      <div className="space-y-2">
        {stock.latestNews.slice(0, 5).map((news, i) => (
          <NewsLink key={i} stock={stock} headline={news.headline} date={news.date} />
        ))}
      </div>
    </div>
  );
}

function NewsLink({
  stock,
  headline,
  date,
}: {
  stock: StockRecommendation;
  headline: string;
  date: string;
}) {
  return (
    <a
      href={`https://www.google.com/search?q=${encodeURIComponent((headline || '') + ' ' + stock.name)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-2 p-3 rounded-lg border border-theme-border hover:bg-theme-surface transition-all group/news"
      style={{ background: 'var(--bg-surface)' }}
    >
      <div className="flex-1 min-w-0">
        <span className="text-xs font-bold text-theme-text-secondary group-hover/news:text-orange-400 transition-colors line-clamp-2 leading-snug">
          {headline}
        </span>
        <span className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block mt-1">{date}</span>
      </div>
      <ExternalLink className="w-3 h-3 text-theme-text-muted shrink-0 mt-0.5" />
    </a>
  );
}

function ModalBody({ stock }: { stock: StockRecommendation }) {
  return (
    <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
      {stock.checklist && <GateStatusWidget stock={stock} />}
      <TranchePlanCard plan={stock.tranchePlan} />
      <AiConvictionCard stock={stock} />
      <AiAnalysisCard stock={stock} />
      <PriceStrategyGrid stock={stock} />
      <ChecklistSummary stock={stock} />
      <FundamentalsCard stock={stock} />
      <NewsCard stock={stock} />
    </div>
  );
}

function ModalFooter({
  stock,
  onClose,
}: {
  stock: StockRecommendation;
  onClose: () => void;
}) {
  return (
    <div className="p-5 border-t border-theme-border flex items-center gap-3 shrink-0" style={{ background: 'var(--bg-elevated)' }}>
      <button
        onClick={onClose}
        className="flex-1 py-3 bg-theme-surface hover:bg-white/10 text-theme-text-secondary font-black rounded-xl border border-theme-border transition-all active:scale-95 text-sm"
      >
        Close
      </button>
      <a
        href={naverFinanceUrl(stock)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 text-white font-black rounded-xl shadow-[0_8px_20px_rgba(249,115,22,0.3)] transition-all active:scale-95 text-sm text-center flex items-center justify-center gap-2"
      >
        <ArrowUpRight className="w-4 h-4" />
        Naver Chart
      </a>
    </div>
  );
}

function ModalContent({
  stock,
  onClose,
}: {
  stock: StockRecommendation;
  onClose: () => void;
}) {
  return (
    <>
      <ModalHeader stock={stock} onClose={onClose} />
      <ModalBody stock={stock} />
      <ModalFooter stock={stock} onClose={onClose} />
    </>
  );
}

function ModalFrame({
  isDesktop,
  children,
}: {
  isDesktop: boolean;
  children: React.ReactNode;
}) {
  return isDesktop ? (
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
      {children}
    </motion.div>
  ) : (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed inset-0 z-[95] flex flex-col"
      style={{ background: 'var(--bg-app)' }}
    >
      {children}
    </motion.div>
  );
}

function ModalBackdrop({
  isDesktop,
  onClose,
}: {
  isDesktop: boolean;
  onClose: () => void;
}) {
  return (
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
  );
}

export const StockDetailModal: React.FC<StockDetailModalProps> = ({ stock, onClose }) => {
  const isDesktop = useDesktopBreakpoint();
  useEscapeClose(Boolean(stock), onClose);

  if (!stock) {
    debugWarn('StockDetailModal: stock is null - will not render');
    return null;
  }

  return (
    <AnimatePresence>
      <ModalBackdrop isDesktop={isDesktop} onClose={onClose} />
      <ModalFrame isDesktop={isDesktop}>
        <ModalContent stock={stock} onClose={onClose} />
      </ModalFrame>
    </AnimatePresence>
  );
};
